import assert from "node:assert/strict";
import test from "node:test";
import { webcrypto } from "node:crypto";

import {
  sqliteD1
} from "./helpers/sqliteD1.mjs";

import {
  transitionOrderTerminal
} from "../src/core/orderTerminalMutationService.js";

import {
  transitionTerminalOrder
} from "../src/core/orderTerminalMutationRepository.js";

if (!globalThis.crypto) {
  globalThis.crypto = webcrypto;
}

if (typeof globalThis.btoa !== "function") {
  globalThis.btoa =
    value =>
      Buffer.from(
        value,
        "binary"
      ).toString(
        "base64"
      );
}

const TIME =
  1800000000000;

const DRIVER = {
  id:
    "staff_driver123",
  role:
    "driver"
};

const ADMIN = {
  id:
    "staff_admin123",
  role:
    "admin"
};

const VEHICLE =
  "vehicle_12345678";


function insertStaff(
  DB,
  {
    id,
    role,
    login
  }
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
      ?, ?, ?, ?, 'active',
      'pbkdf2-sha256', 100000,
      ?, ?, 1, 1, 1
    )
  `).run(
    id,
    login,
    login,
    role,
    "A".repeat(32),
    "B".repeat(43)
  );
}


function setup(t) {
  const DB =
    sqliteD1();

  t.after(
    () =>
      DB.sqlite.close()
  );

  insertStaff(
    DB,
    {
      id:
        DRIVER.id,
      role:
        "driver",
      login:
        "driverterminal"
    }
  );

  insertStaff(
    DB,
    {
      id:
        ADMIN.id,
      role:
        "admin",
      login:
        "adminterminal"
    }
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

  DB.sqlite.prepare(`
    INSERT INTO driver_profiles (
      staff_account_id,
      normalized_phone,
      registration_status,
      identity_status,
      created_at,
      updated_at
    )
    VALUES (
      ?,
      '+79990000000',
      'approved',
      'verified',
      1,
      1
    )
  `).run(
    DRIVER.id
  );

  DB.sqlite.prepare(`
    INSERT INTO vehicles (
      id,
      driver_id,
      vin,
      plate,
      make,
      model,
      class,
      capacity,
      status,
      created_at,
      updated_at
    )
    VALUES (
      ?,
      ?,
      'TESTVIN0000000001',
      'A001AA',
      'Test',
      'Car',
      'comfort',
      4,
      'approved',
      1,
      1
    )
  `).run(
    VEHICLE,
    DRIVER.id
  );

  return DB;
}


function insertOrder(
  DB,
  {
    id,
    status,
    driverId =
      null,
    revision =
      1
  }
) {
  DB.sqlite.prepare(`
    INSERT INTO orders (
      id,
      quote_id,
      name,
      phone,
      route,
      from_place,
      to_place,
      trip_date,
      comment,
      tariff,
      distance_km,
      duration_minutes,
      price_rub,
      status,
      driver_id,
      created_at,
      updated_at,
      revision
    )
    VALUES (
      ?,
      NULL,
      'Иван',
      '+79990000001',
      'Нижний Новгород → Москва',
      'Нижний Новгород',
      'Москва',
      '2026-11-08',
      '',
      'comfort',
      436.8,
      325,
      24024,
      ?,
      ?,
      1,
      1,
      ?
    )
  `).run(
    id,
    status,
    driverId,
    revision
  );
}


function insertActiveAssignment(
  DB,
  {
    id,
    orderId,
    phase =
      "in_trip"
  }
) {
  DB.sqlite.prepare(`
    INSERT INTO order_assignments (
      id,
      order_id,
      driver_id,
      vehicle_id,
      state,
      revision,
      assigned_by,
      reason,
      created_at,
      revoked_at,
      phase,
      phase_updated_at
    )
    VALUES (
      ?,
      ?,
      ?,
      ?,
      'active',
      1,
      ?,
      'test assignment',
      1,
      NULL,
      ?,
      1
    )
  `).run(
    id,
    orderId,
    DRIVER.id,
    VEHICLE,
    ADMIN.id,
    phase
  );
}


function auditCount(
  DB,
  orderId
) {
  return Number(
    DB.sqlite.prepare(`
      SELECT count(*) AS n
      FROM audit_events
      WHERE target_type = 'order'
        AND target_id = ?
    `).get(
      orderId
    ).n
  );
}


test(
  "driver done requires idempotency and revision and completes assignment atomically",
  async t => {
    const DB =
      setup(t);

    insertOrder(
      DB,
      {
        id:
          "order_done_123",
        status:
          "in_progress",
        driverId:
          DRIVER.id
      }
    );

    insertActiveAssignment(
      DB,
      {
        id:
          "assignment_done_123",
        orderId:
          "order_done_123"
      }
    );

    const input = {
      status:
        "done",
      expectedRevision:
        1
    };

    const options = {
      idempotencyKey:
        "done-key-0001",
      requestId:
        "req_done_1",
      nowMs:
        TIME
    };

    const original =
      await transitionOrderTerminal(
        {
          DB
        },
        DRIVER,
        "order_done_123",
        input,
        options
      );

    assert.equal(
      original.ok,
      true
    );

    assert.deepEqual(
      original.order,
      {
        id:
          "order_done_123",
        status:
          "done",
        driverId:
          DRIVER.id,
        updatedAt:
          TIME,
        revision:
          2
      }
    );

    const order =
      DB.sqlite.prepare(`
        SELECT
          status,
          revision,
          last_terminal_claim_id
        FROM orders
        WHERE id = ?
      `).get(
        "order_done_123"
      );

    assert.equal(
      order.status,
      "done"
    );

    assert.equal(
      Number(
        order.revision
      ),
      2
    );

    assert.match(
      String(
        order.last_terminal_claim_id
      ),
      /^idem-claim_/
    );

    const assignment =
      DB.sqlite.prepare(`
        SELECT
          state,
          revision
        FROM order_assignments
        WHERE id = ?
      `).get(
        "assignment_done_123"
      );

    assert.equal(
      assignment.state,
      "completed"
    );

    assert.equal(
      Number(
        assignment.revision
      ),
      2
    );

    assert.equal(
      auditCount(
        DB,
        "order_done_123"
      ),
      1
    );

    const audit =
      DB.sqlite.prepare(`
        SELECT
          actor_account_id,
          action,
          outcome,
          request_id
        FROM audit_events
        WHERE target_type = 'order'
          AND target_id = ?
      `).get(
        "order_done_123"
      );

    assert.deepEqual(
      audit,
      {
        actor_account_id:
          DRIVER.id,
        action:
          "driver.order_completed",
        outcome:
          "success",
        request_id:
          "req_done_1"
      }
    );

    const replay =
      await transitionOrderTerminal(
        {
          DB
        },
        DRIVER,
        "order_done_123",
        input,
        options
      );

    assert.deepEqual(
      replay,
      original
    );

    assert.equal(
      auditCount(
        DB,
        "order_done_123"
      ),
      1
    );
  }
);


test(
  "admin canceled requires current revision, revokes assignment and replays without duplicate audit",
  async t => {
    const DB =
      setup(t);

    insertOrder(
      DB,
      {
        id:
          "order_cancel_123",
        status:
          "in_progress",
        driverId:
          DRIVER.id
      }
    );

    insertActiveAssignment(
      DB,
      {
        id:
          "assignment_cancel_123",
        orderId:
          "order_cancel_123"
      }
    );

    const input = {
      status:
        "canceled",
      expectedRevision:
        1
    };

    const options = {
      idempotencyKey:
        "cancel-key-0001",
      requestId:
        "req_cancel_1",
      nowMs:
        TIME + 10
    };

    const original =
      await transitionOrderTerminal(
        {
          DB
        },
        ADMIN,
        "order_cancel_123",
        input,
        options
      );

    assert.equal(
      original.ok,
      true
    );

    assert.equal(
      original.order.status,
      "canceled"
    );

    assert.equal(
      original.order.revision,
      2
    );

    const assignment =
      DB.sqlite.prepare(`
        SELECT
          state,
          revoked_at
        FROM order_assignments
        WHERE id = ?
      `).get(
        "assignment_cancel_123"
      );

    assert.equal(
      assignment.state,
      "revoked"
    );

    assert.equal(
      Number(
        assignment.revoked_at
      ),
      TIME + 10
    );

    assert.equal(
      auditCount(
        DB,
        "order_cancel_123"
      ),
      1
    );

    const replay =
      await transitionOrderTerminal(
        {
          DB
        },
        ADMIN,
        "order_cancel_123",
        input,
        options
      );

    assert.deepEqual(
      replay,
      original
    );

    assert.equal(
      auditCount(
        DB,
        "order_cancel_123"
      ),
      1
    );
  }
);


test(
  "terminal mutation rejects missing idempotency key and missing expected revision",
  async t => {
    const DB =
      setup(t);

    insertOrder(
      DB,
      {
        id:
          "order_required_123",
        status:
          "in_progress",
        driverId:
          DRIVER.id
      }
    );

    const noKey =
      await transitionOrderTerminal(
        {
          DB
        },
        DRIVER,
        "order_required_123",
        {
          status:
            "done",
          expectedRevision:
            1
        },
        {
          nowMs:
            TIME
        }
      );

    assert.equal(
      noKey.status,
      400
    );

    assert.equal(
      noKey.code,
      "idempotency_key_required"
    );

    const noRevision =
      await transitionOrderTerminal(
        {
          DB
        },
        DRIVER,
        "order_required_123",
        {
          status:
            "done"
        },
        {
          idempotencyKey:
            "done-key-0002",
          nowMs:
            TIME
        }
      );

    assert.equal(
      noRevision.status,
      400
    );

    assert.equal(
      noRevision.code,
      "invalid_revision"
    );
  }
);


test(
  "stale competing terminal mutation is persisted as conflict without a false success audit",
  async t => {
    const DB =
      setup(t);

    insertOrder(
      DB,
      {
        id:
          "order_race_123",
        status:
          "in_progress",
        driverId:
          DRIVER.id
      }
    );

    insertActiveAssignment(
      DB,
      {
        id:
          "assignment_race_123",
        orderId:
          "order_race_123"
      }
    );

    const first =
      await transitionOrderTerminal(
        {
          DB
        },
        DRIVER,
        "order_race_123",
        {
          status:
            "done",
          expectedRevision:
            1
        },
        {
          idempotencyKey:
            "done-race-key-1",
          requestId:
            "req_race_1",
          nowMs:
            TIME
        }
      );

    assert.equal(
      first.ok,
      true
    );

    const second =
      await transitionOrderTerminal(
        {
          DB
        },
        DRIVER,
        "order_race_123",
        {
          status:
            "done",
          expectedRevision:
            1
        },
        {
          idempotencyKey:
            "done-race-key-2",
          requestId:
            "req_race_2",
          nowMs:
            TIME + 1
        }
      );

    assert.equal(
      second.status,
      409
    );

    assert.equal(
      second.code,
      "order_terminal_preconditions_failed"
    );

    assert.equal(
      auditCount(
        DB,
        "order_race_123"
      ),
      1
    );

    const persisted =
      DB.sqlite.prepare(`
        SELECT
          state,
          http_status,
          result_code
        FROM mutation_idempotency
        WHERE actor_account_id = ?
          AND operation = 'driver.order.done'
        ORDER BY created_at ASC
      `).all(
        DRIVER.id
      );

    assert.equal(
      persisted.length,
      2
    );

    assert.equal(
      Number(
        persisted[1].http_status
      ),
      409
    );

    assert.equal(
      persisted[1].result_code,
      "order_terminal_preconditions_failed"
    );
  }
);


test(
  "same idempotency key cannot be reused with a different revision",
  async t => {
    const DB =
      setup(t);

    insertOrder(
      DB,
      {
        id:
          "order_reuse_123",
        status:
          "in_progress",
        driverId:
          DRIVER.id
      }
    );

    const first =
      await transitionOrderTerminal(
        {
          DB
        },
        DRIVER,
        "order_reuse_123",
        {
          status:
            "done",
          expectedRevision:
            1
        },
        {
          idempotencyKey:
            "done-reuse-key",
          nowMs:
            TIME
        }
      );

    assert.equal(
      first.ok,
      true
    );

    const changedBody =
      await transitionOrderTerminal(
        {
          DB
        },
        DRIVER,
        "order_reuse_123",
        {
          status:
            "done",
          expectedRevision:
            2
        },
        {
          idempotencyKey:
            "done-reuse-key",
          nowMs:
            TIME + 1
        }
      );

    assert.equal(
      changedBody.status,
      409
    );

    assert.equal(
      changedBody.code,
      "idempotency_key_reused"
    );
  }
);


test(
  "losing claim cannot mutate order or append audit",
  async t => {
    const DB =
      setup(t);

    insertOrder(
      DB,
      {
        id:
          "order_claim_123",
        status:
          "in_progress",
        driverId:
          DRIVER.id
      }
    );

    const common = {
      actorAccountId:
        DRIVER.id,
      orderId:
        "order_claim_123",
      expectedRevision:
        1,
      targetStatus:
        "done",
      currentDriverId:
        DRIVER.id,
      changedAt:
        TIME,
      requestId:
        "req_claim",
      idempotency: {
        operation:
          "driver.order.done",
        keyDigest:
          "K".repeat(43),
        requestDigest:
          "R".repeat(43),
        claimId:
          "claim_terminal_winner"
      }
    };

    const winner =
      await transitionTerminalOrder(
        {
          DB
        },
        {
          ...common,
          auditId:
            "audit_terminal_winner"
        }
      );

    assert.equal(
      winner.kind,
      "success"
    );

    const loser =
      await transitionTerminalOrder(
        {
          DB
        },
        {
          ...common,
          auditId:
            "audit_terminal_loser",
          idempotency: {
            ...common.idempotency,
            claimId:
              "claim_terminal_loser"
          }
        }
      );

    assert.equal(
      loser.kind,
      "existing_idempotency"
    );

    assert.equal(
      auditCount(
        DB,
        "order_claim_123"
      ),
      1
    );
  }
);


test(
  "audit insertion failure rolls back terminal state and idempotency claim",
  async t => {
    const DB =
      setup(t);

    insertOrder(
      DB,
      {
        id:
          "order_rollback_123",
        status:
          "in_progress",
        driverId:
          DRIVER.id
      }
    );

    DB.sqlite.exec(`
      CREATE TRIGGER fail_terminal_audit
      BEFORE INSERT ON audit_events
      WHEN NEW.action = 'driver.order_completed'
      BEGIN
        SELECT RAISE(
          ABORT,
          'terminal audit failure'
        );
      END;
    `);

    await assert.rejects(
      () =>
        transitionOrderTerminal(
          {
            DB
          },
          DRIVER,
          "order_rollback_123",
          {
            status:
              "done",
            expectedRevision:
              1
          },
          {
            idempotencyKey:
              "done-rollback-key",
            requestId:
              "req_rollback",
            nowMs:
              TIME
          }
        ),
      /terminal audit failure/
    );

    const order =
      DB.sqlite.prepare(`
        SELECT
          status,
          revision,
          last_terminal_claim_id
        FROM orders
        WHERE id = ?
      `).get(
        "order_rollback_123"
      );

    assert.equal(
      order.status,
      "in_progress"
    );

    assert.equal(
      Number(
        order.revision
      ),
      1
    );

    assert.equal(
      order.last_terminal_claim_id,
      null
    );

    assert.equal(
      Number(
        DB.sqlite.prepare(`
          SELECT count(*) AS n
          FROM mutation_idempotency
        `).get().n
      ),
      0
    );
  }
);
