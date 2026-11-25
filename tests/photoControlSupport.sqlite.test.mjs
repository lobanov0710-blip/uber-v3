import assert from "node:assert/strict";
import test from "node:test";

import {
  fixture,
  driver,
  vehicle,
  time
} from "./helpers/driverPlatformFixture.mjs";

import {
  requestVehiclePhotoCheck
} from "../src/core/vehiclePhotoControlService.js";

import {
  putDriverAvailability
} from "../src/core/driverAvailabilityService.js";

import {
  assignOrderByAdmin
} from "../src/core/orderAssignmentService.js";

import {
  postDriverSupportCase
} from "../src/core/driverSupportCaseService.js";


const ADMIN = {
  id:
    "staff_admin123",
  role:
    "admin"
};

const DAY_MS =
  24 * 60 * 60 * 1000;


function setup(t) {
  const DB =
    fixture(t);

  DB.sqlite.prepare(`
    INSERT INTO staff_accounts (
      id,
      login,
      display_name,
      role,
      status,
      password_algorithm,
      password_iterations,
      password_salt,
      password_hash,
      password_changed_at,
      created_at,
      updated_at
    )
    VALUES (
      ?,
      'photo-admin',
      'Photo Admin',
      'admin',
      'active',
      'pbkdf2-sha256',
      100000,
      ?,
      ?,
      1,
      1,
      1
    )
  `).run(
    ADMIN.id,
    "A".repeat(32),
    "B".repeat(43)
  );

  DB.sqlite.prepare(`
    INSERT INTO staff_owner_binding (
      singleton,
      account_id,
      created_at
    )
    VALUES (1, ?, 1)
  `).run(
    ADMIN.id
  );

  return DB;
}


function count(
  DB,
  table
) {
  return Number(
    DB.sqlite.prepare(
      `SELECT count(*) AS n FROM ${table}`
    ).get().n
  );
}


test(
  "monthly photo check creates 24h grace, audits once and replays idempotently",
  async t => {
    const DB =
      setup(t);

    const input = {
      kind:
        "monthly",
      reason:
        "Плановый ежемесячный фотоконтроль",
      expectedRevision:
        1
    };

    const options = {
      idempotencyKey:
        "photo-monthly-key",
      requestId:
        "req_photo_monthly",
      nowMs:
        time
    };

    const first =
      await requestVehiclePhotoCheck(
        {
          DB
        },
        ADMIN,
        vehicle,
        input,
        options
      );

    assert.equal(
      first.ok,
      true
    );

    assert.equal(
      first.photoCheck.kind,
      "monthly"
    );

    assert.equal(
      first.photoCheck.restrictionMode,
      "grace_period"
    );

    assert.equal(
      first.photoCheck.graceUntil -
        first.photoCheck.dueAt,
      DAY_MS
    );

    assert.equal(
      first.photoCheck.vehicleRevision,
      2
    );

    assert.equal(
      count(
        DB,
        "vehicle_photo_checks"
      ),
      1
    );

    assert.equal(
      count(
        DB,
        "audit_events"
      ),
      1
    );

    const replay =
      await requestVehiclePhotoCheck(
        {
          DB
        },
        ADMIN,
        vehicle,
        input,
        options
      );

    assert.deepEqual(
      replay,
      first
    );

    assert.equal(
      count(
        DB,
        "vehicle_photo_checks"
      ),
      1
    );

    assert.equal(
      count(
        DB,
        "audit_events"
      ),
      1
    );
  }
);


test(
  "monthly photo check allows on-line during grace and blocks after grace expires",
  async t => {
    const DB =
      setup(t);

    const photo =
      await requestVehiclePhotoCheck(
        {
          DB
        },
        ADMIN,
        vehicle,
        {
          kind:
            "monthly",
          reason:
            "Плановый контроль",
          expectedRevision:
            1
        },
        {
          idempotencyKey:
            "photo-grace-key",
          nowMs:
            time
        }
      );

    assert.equal(
      photo.ok,
      true
    );

    const duringGrace =
      await putDriverAvailability(
        {
          DB
        },
        driver,
        {
          activeVehicleId:
            vehicle,
          requestedState:
            "on_line",
          expectedRevision:
            1
        },
        {
          idempotencyKey:
            "availability-in-grace",
          nowMs:
            time + 1
        }
      );

    assert.equal(
      duringGrace.ok,
      true
    );

    const offline =
      await putDriverAvailability(
        {
          DB
        },
        driver,
        {
          activeVehicleId:
            null,
          requestedState:
            "off_line",
          expectedRevision:
            2
        },
        {
          idempotencyKey:
            "availability-offline-grace",
          nowMs:
            time + 2
        }
      );

    assert.equal(
      offline.ok,
      true
    );

    const afterGrace =
      await putDriverAvailability(
        {
          DB
        },
        driver,
        {
          activeVehicleId:
            vehicle,
          requestedState:
            "on_line",
          expectedRevision:
            3
        },
        {
          idempotencyKey:
            "availability-after-grace",
          nowMs:
            time + DAY_MS + 1
        }
      );

    assert.equal(
      afterGrace.status,
      422
    );

    assert.equal(
      afterGrace.code,
      "vehicle_photo_control_required"
    );
  }
);


test(
  "unplanned immediate photo check blocks new assignment server-side",
  async t => {
    const DB =
      setup(t);

    const photo =
      await requestVehiclePhotoCheck(
        {
          DB
        },
        ADMIN,
        vehicle,
        {
          kind:
            "complaint",
          reason:
            "Жалоба пассажира",
          restrictionMode:
            "immediate",
          expectedRevision:
            1
        },
        {
          idempotencyKey:
            "photo-complaint-key",
          nowMs:
            time
        }
      );

    assert.equal(
      photo.ok,
      true
    );

    DB.sqlite.prepare(`
      INSERT INTO orders (
        id,
        name,
        phone,
        route,
        trip_date,
        status,
        created_at,
        updated_at
      )
      VALUES (
        'order_photo_gate',
        'Test',
        '+79990000000',
        'Test route',
        '2030-01-01',
        'new',
        1,
        1
      )
    `).run();

    const assignment =
      await assignOrderByAdmin(
        {
          DB
        },
        ADMIN,
        "order_photo_gate",
        {
          driverId:
            driver.id,
          vehicleId:
            vehicle,
          reason:
            "Test assignment",
          expectedRevision:
            1
        },
        {
          idempotencyKey:
            "assignment-photo-blocked",
          nowMs:
            time + 1
        }
      );

    assert.equal(
      assignment.status,
      422
    );

    assert.equal(
      assignment.code,
      "vehicle_photo_control_required"
    );

    const order =
      DB.sqlite.prepare(`
        SELECT status, driver_id
        FROM orders
        WHERE id = 'order_photo_gate'
      `).get();

    assert.equal(
      order.status,
      "new"
    );

    assert.equal(
      order.driver_id,
      null
    );
  }
);


test(
  "driver support case is idempotent, audited and cannot cancel an order",
  async t => {
    const DB =
      setup(t);

    const input = {
      category:
        "vehicle"
    };

    const options = {
      idempotencyKey:
        "support-case-key",
      requestId:
        "req_support",
      nowMs:
        time
    };

    const first =
      await postDriverSupportCase(
        {
          DB
        },
        driver,
        input,
        options
      );

    assert.equal(
      first.ok,
      true
    );

    assert.equal(
      first.supportCase.status,
      "open"
    );

    assert.equal(
      first.supportCase.revision,
      1
    );

    assert.equal(
      count(
        DB,
        "support_cases"
      ),
      1
    );

    assert.equal(
      count(
        DB,
        "audit_events"
      ),
      1
    );

    const replay =
      await postDriverSupportCase(
        {
          DB
        },
        driver,
        input,
        options
      );

    assert.deepEqual(
      replay,
      first
    );

    assert.equal(
      count(
        DB,
        "support_cases"
      ),
      1
    );

    assert.equal(
      count(
        DB,
        "audit_events"
      ),
      1
    );
  }
);


test(
  "driver cannot create a support case linked to an inaccessible order",
  async t => {
    const DB =
      setup(t);

    DB.sqlite.prepare(`
      INSERT INTO orders (
        id,
        name,
        phone,
        route,
        trip_date,
        status,
        created_at,
        updated_at
      )
      VALUES (
        'order_other_123',
        'Other',
        '+79990000002',
        'Other route',
        '2030-01-01',
        'new',
        1,
        1
      )
    `).run();

    const result =
      await postDriverSupportCase(
        {
          DB
        },
        driver,
        {
          category:
            "route",
          orderId:
            "order_other_123"
        },
        {
          idempotencyKey:
            "support-other-order",
          nowMs:
            time
        }
      );

    assert.equal(
      result.status,
      404
    );

    assert.equal(
      result.code,
      "support_order_not_accessible"
    );

    assert.equal(
      count(
        DB,
        "support_cases"
      ),
      0
    );

    assert.equal(
      count(
        DB,
        "audit_events"
      ),
      0
    );
  }
);
