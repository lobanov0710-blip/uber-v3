import assert from "node:assert/strict";
import test from "node:test";
import { webcrypto } from "node:crypto";

import {
  fixture,
  driver,
  vehicle,
  time
} from "./helpers/driverPlatformFixture.mjs";

import {
  issueDriverPrivateUpload,
  completeDriverPrivateUpload
} from "../src/core/driverPrivateUploadService.js";

import {
  getAdminVehiclePhotoCheck,
  getDriverPhotoChecks,
  requestVehiclePhotoCheck,
  reviewAdminVehiclePhotoCheck,
  runMonthlyPhotoControlDueGeneration
} from "../src/core/vehiclePhotoControlService.js";

import {
  addOneCalendarMonthUtc,
  PHOTO_CONTROL_GRACE_MS
} from "../src/core/photoControlSchedule.js";

import {
  putDriverAvailability
} from "../src/core/driverAvailabilityService.js";

import {
  assignOrderByAdmin
} from "../src/core/orderAssignmentService.js";


if (!globalThis.crypto) {
  globalThis.crypto =
    webcrypto;
}


const ADMIN = {
  id:
    "staff_admin123",
  role:
    "admin"
};

const PHOTO_KINDS = [
  "left",
  "front",
  "right",
  "rear",
  "open_trunk",
  "rear_cabin",
  "front_cabin"
];


function insertAdmin(
  DB
) {
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
      'photo-lifecycle-admin',
      'Photo Lifecycle Admin',
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
}


function setup(
  t
) {
  const DB =
    fixture(t);

  insertAdmin(
    DB
  );

  return DB;
}


function bucket() {
  const objects =
    new Map();

  return {
    objects,

    async put(
      key,
      body,
      options
    ) {
      objects.set(
        key,
        {
          body:
            new Uint8Array(
              body
            ),
          options
        }
      );
    },

    async delete(
      key
    ) {
      objects.delete(
        key
      );
    }
  };
}


async function uploadCheckPhotos(
  DB,
  files,
  photoCheckId,
  baseTime
) {
  let offset =
    0;


  for (
    const kind of
      PHOTO_KINDS
  ) {
    const issued =
      await issueDriverPrivateUpload(
        {
          DB,
          DRIVER_PRIVATE_FILES:
            files,
          DRIVER_UPLOAD_MAX_BYTES:
            "1048576"
        },
        driver,
        {
          resourceType:
            "vehicle_photo",
          kind,
          vehicleId:
            vehicle,
          photoCheckId,
          contentType:
            "image/jpeg",
          contentLength:
            4
        },
        {
          nowMs:
            baseTime +
            offset
        }
      );


    assert.equal(
      issued.ok,
      true
    );


    const completed =
      await completeDriverPrivateUpload(
        {
          DB,
          DRIVER_PRIVATE_FILES:
            files
        },
        driver,
        issued.upload.id,
        {
          contentType:
            "image/jpeg",
          bodyBytes:
            new Uint8Array([
              1,
              2,
              3,
              4
            ]).buffer,
          requestId:
            `req_upload_${kind}`
        },
        {
          nowMs:
            baseTime +
            offset +
            1
        }
      );


    assert.equal(
      completed.ok,
      true
    );

    assert.equal(
      completed.resource
        .photoCheckId,
      photoCheckId
    );


    offset +=
      10;
  }
}


test(
  "calendar-month schedule clamps end-of-month deterministically",
  () => {
    assert.equal(
      addOneCalendarMonthUtc(
        Date.UTC(
          2026,
          0,
          31,
          12,
          30
        )
      ),
      Date.UTC(
        2026,
        1,
        28,
        12,
        30
      )
    );

    assert.equal(
      addOneCalendarMonthUtc(
        Date.UTC(
          2028,
          0,
          31,
          12,
          30
        )
      ),
      Date.UTC(
        2028,
        1,
        29,
        12,
        30
      )
    );
  }
);


test(
  "private control photos stay linked to their check and do not enter registration material set",
  async t => {
    const DB =
      setup(t);

    const files =
      bucket();


    const created =
      await requestVehiclePhotoCheck(
        {
          DB
        },
        ADMIN,
        vehicle,
        {
          kind:
            "manual",
          reason:
            "Контроль состояния автомобиля",
          restrictionMode:
            "immediate",
          expectedRevision:
            1
        },
        {
          idempotencyKey:
            "photo-lifecycle-create",
          nowMs:
            time
        }
      );


    assert.equal(
      created.ok,
      true
    );


    await uploadCheckPhotos(
      DB,
      files,
      created.photoCheck.id,
      time + 100
    );


    const linked =
      DB.sqlite.prepare(`
        SELECT
          COUNT(*) AS n
        FROM vehicle_photos
        WHERE photo_check_id = ?
      `).get(
        created.photoCheck.id
      );


    assert.equal(
      Number(
        linked.n
      ),
      7
    );


    const registration =
      DB.sqlite.prepare(`
        SELECT
          COUNT(*) AS n
        FROM vehicle_photos
        WHERE vehicle_id = ?
          AND photo_check_id IS NULL
      `).get(
        vehicle
      );


    assert.equal(
      Number(
        registration.n
      ),
      0
    );


    assert.equal(
      files.objects.size,
      7
    );
  }
);


test(
  "admin pass review updates next due, history and idempotent replay",
  async t => {
    const DB =
      setup(t);

    const files =
      bucket();


    const created =
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
            "photo-review-create",
          nowMs:
            time
        }
      );


    await uploadCheckPhotos(
      DB,
      files,
      created.photoCheck.id,
      time + 100
    );


    const driverOpen =
      await getDriverPhotoChecks(
        {
          DB
        },
        driver
      );


    assert.equal(
      driverOpen.ok,
      true
    );

    assert.equal(
      driverOpen.photoChecks
        .length,
      1
    );

    assert.equal(
      driverOpen.photoChecks[0]
        .uploadedKindCount,
      7
    );


    const adminRead =
      await getAdminVehiclePhotoCheck(
        {
          DB
        },
        ADMIN,
        vehicle,
        created.photoCheck.id
      );


    assert.equal(
      adminRead.ok,
      true
    );

    assert.equal(
      adminRead.photoCheck
        .photos.length,
      7
    );


    const reviewAt =
      time +
      1000;

    const input = {
      decision:
        "passed",
      expectedRevision:
        1,
      note:
        "Фотоконтроль пройден"
    };

    const options = {
      idempotencyKey:
        "photo-review-pass",
      requestId:
        "req_photo_review",
      nowMs:
        reviewAt
    };


    const reviewed =
      await reviewAdminVehiclePhotoCheck(
        {
          DB
        },
        ADMIN,
        vehicle,
        created.photoCheck.id,
        input,
        options
      );


    assert.equal(
      reviewed.ok,
      true
    );

    assert.equal(
      reviewed.photoCheck.result,
      "passed"
    );

    assert.equal(
      reviewed.photoCheck.revision,
      2
    );

    assert.equal(
      reviewed.photoCheck.nextDueAt,
      addOneCalendarMonthUtc(
        reviewAt
      )
    );


    const vehicleRow =
      DB.sqlite.prepare(`
        SELECT
          revision,
          last_photo_check_passed_at,
          next_photo_check_due_at
        FROM vehicles
        WHERE id = ?
      `).get(
        vehicle
      );


    assert.equal(
      Number(
        vehicleRow.revision
      ),
      3
    );

    assert.equal(
      Number(
        vehicleRow
          .last_photo_check_passed_at
      ),
      reviewAt
    );

    assert.equal(
      Number(
        vehicleRow
          .next_photo_check_due_at
      ),
      reviewed.photoCheck
        .nextDueAt
    );


    assert.equal(
      Number(
        DB.sqlite.prepare(`
          SELECT COUNT(*) AS n
          FROM vehicle_photo_check_reviews
          WHERE photo_check_id = ?
        `).get(
          created.photoCheck.id
        ).n
      ),
      1
    );


    const replay =
      await reviewAdminVehiclePhotoCheck(
        {
          DB
        },
        ADMIN,
        vehicle,
        created.photoCheck.id,
        input,
        options
      );


    assert.deepEqual(
      replay,
      reviewed
    );


    const after =
      await getDriverPhotoChecks(
        {
          DB
        },
        driver
      );


    assert.equal(
      after.photoChecks.length,
      0
    );
  }
);


test(
  "monthly generator materializes one audited due check and is retry-safe",
  async t => {
    const DB =
      setup(t);

    const dueAt =
      time +
      5000;


    DB.sqlite.prepare(`
      UPDATE vehicles
      SET
        next_photo_check_due_at = ?,
        last_photo_check_passed_at = ?,
        revision = revision + 1
      WHERE id = ?
    `).run(
      dueAt,
      time,
      vehicle
    );


    const early =
      await runMonthlyPhotoControlDueGeneration(
        {
          DB
        },
        {
          nowMs:
            dueAt - 1
        }
      );


    assert.equal(
      early.generated,
      0
    );


    const first =
      await runMonthlyPhotoControlDueGeneration(
        {
          DB
        },
        {
          nowMs:
            dueAt
        }
      );


    assert.equal(
      first.generated,
      1
    );


    const check =
      DB.sqlite.prepare(`
        SELECT
          kind,
          due_at,
          grace_until,
          result,
          restriction_mode,
          created_by
        FROM vehicle_photo_checks
        WHERE vehicle_id = ?
          AND due_at = ?
          AND kind = 'monthly'
      `).get(
        vehicle,
        dueAt
      );


    assert.equal(
      check.result,
      "pending"
    );

    assert.equal(
      check.restriction_mode,
      "grace_period"
    );

    assert.equal(
      Number(
        check.grace_until
      ),
      dueAt +
        PHOTO_CONTROL_GRACE_MS
    );

    assert.equal(
      check.created_by,
      null
    );


    const audit =
      DB.sqlite.prepare(`
        SELECT
          actor_account_id,
          action
        FROM audit_events
        WHERE action =
          'system.vehicle_photo_check_due'
      `).get();


    assert.equal(
      audit.actor_account_id,
      null
    );

    assert.equal(
      audit.action,
      "system.vehicle_photo_check_due"
    );


    const retry =
      await runMonthlyPhotoControlDueGeneration(
        {
          DB
        },
        {
          nowMs:
            dueAt + 1000
        }
      );


    assert.equal(
      retry.generated,
      0
    );

    assert.equal(
      Number(
        DB.sqlite.prepare(`
          SELECT COUNT(*) AS n
          FROM vehicle_photo_checks
          WHERE vehicle_id = ?
            AND kind = 'monthly'
            AND due_at = ?
        `).get(
          vehicle,
          dueAt
        ).n
      ),
      1
    );
  }
);


test(
  "overdue stored next-due blocks on-line even before cron materializes a row",
  async t => {
    const DB =
      setup(t);

    const dueAt =
      time;


    DB.sqlite.prepare(`
      UPDATE vehicles
      SET next_photo_check_due_at = ?
      WHERE id = ?
    `).run(
      dueAt,
      vehicle
    );


    const result =
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
            "overdue-before-cron",
          nowMs:
            dueAt +
            PHOTO_CONTROL_GRACE_MS +
            1
        }
      );


    assert.equal(
      result.status,
      422
    );

    assert.equal(
      result.code,
      "vehicle_photo_control_required"
    );
  }
);


test(
  "overdue stored next-due blocks a new assignment before cron materializes a row",
  async t => {
    const DB =
      setup(t);

    const dueAt =
      time;


    DB.sqlite.prepare(`
      UPDATE vehicles
      SET next_photo_check_due_at = ?
      WHERE id = ?
    `).run(
      dueAt,
      vehicle
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
        'order_due_gate',
        'Test',
        '+79990000000',
        'Test route',
        '2030-01-01',
        'new',
        1,
        1
      )
    `).run();


    const result =
      await assignOrderByAdmin(
        {
          DB
        },
        ADMIN,
        "order_due_gate",
        {
          driverId:
            driver.id,
          vehicleId:
            vehicle,
          reason:
            "Test",
          expectedRevision:
            1
        },
        {
          idempotencyKey:
            "assignment-overdue-before-cron",
          nowMs:
            dueAt +
            PHOTO_CONTROL_GRACE_MS +
            1
        }
      );


    assert.equal(
      result.status,
      422
    );

    assert.equal(
      result.code,
      "vehicle_photo_control_required"
    );
  }
);
