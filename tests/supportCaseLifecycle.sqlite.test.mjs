import assert from "node:assert/strict";
import test from "node:test";
import { webcrypto } from "node:crypto";

import {
  fixture,
  driver,
  time
} from "./helpers/driverPlatformFixture.mjs";

import {
  postDriverSupportCase
} from "../src/core/driverSupportCaseService.js";

import {
  getAdminSupportCase,
  getAdminSupportCases,
  getDriverSupportCase,
  getDriverSupportCases,
  postAdminSupportCaseStatus,
  postAdminSupportMessage,
  postDriverSupportMessage,
  runSupportChatRetention,
  SUPPORT_CHAT_RETENTION_MS
} from "../src/core/supportCaseLifecycleService.js";


if (!globalThis.crypto) {
  globalThis.crypto =
    webcrypto;
}


const OWNER = {
  id:
    "staff_owner123",
  role:
    "admin"
};

const DISPATCHER = {
  id:
    "staff_dispatch123",
  role:
    "admin"
};

const OTHER_DRIVER = {
  id:
    "staff_driver456",
  role:
    "driver"
};


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
      ?,
      ?,
      ?,
      ?,
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
    id,
    login,
    login,
    role,
    "A".repeat(32),
    "B".repeat(43)
  );
}


function setup(
  t
) {
  const DB =
    fixture(t);

  insertStaff(
    DB,
    {
      id:
        OWNER.id,
      role:
        "admin",
      login:
        "owner-support"
    }
  );

  insertStaff(
    DB,
    {
      id:
        DISPATCHER.id,
      role:
        "admin",
      login:
        "dispatcher-support"
    }
  );

  insertStaff(
    DB,
    {
      id:
        OTHER_DRIVER.id,
      role:
        "driver",
      login:
        "other-driver"
    }
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
      '+79990000002',
      'approved',
      'verified',
      1,
      1
    )
  `).run(
    OTHER_DRIVER.id
  );

  DB.sqlite.prepare(`
    INSERT INTO staff_owner_binding (
      singleton,
      account_id,
      created_at
    )
    VALUES (1, ?, 1)
  `).run(
    OWNER.id
  );

  return DB;
}


async function createCase(
  DB,
  {
    orderId =
      null,
    key =
      "support-create-key",
    now =
      time
  } = {}
) {
  const result =
    await postDriverSupportCase(
      {
        DB
      },
      driver,
      {
        category:
          "vehicle",
        orderId
      },
      {
        idempotencyKey:
          key,
        requestId:
          "req_support_create",
        nowMs:
          now
      }
    );

  assert.equal(
    result.ok,
    true
  );

  return result.supportCase;
}


test(
  "driver lists and reads only own support cases",
  async t => {
    const DB =
      setup(t);

    const supportCase =
      await createCase(
        DB
      );


    const list =
      await getDriverSupportCases(
        {
          DB
        },
        driver
      );

    assert.equal(
      list.ok,
      true
    );

    assert.equal(
      list.supportCases.length,
      1
    );

    assert.equal(
      list.supportCases[0].id,
      supportCase.id
    );


    const detail =
      await getDriverSupportCase(
        {
          DB
        },
        driver,
        supportCase.id,
        {
          nowMs:
            time + 1
        }
      );

    assert.equal(
      detail.ok,
      true
    );

    assert.equal(
      detail.supportCase.driverId,
      driver.id
    );


    const denied =
      await getDriverSupportCase(
        {
          DB
        },
        OTHER_DRIVER,
        supportCase.id,
        {
          nowMs:
            time + 1
        }
      );

    assert.equal(
      denied.status,
      404
    );
  }
);


test(
  "driver support message requires revision and idempotency and stores no chat body in replay result",
  async t => {
    const DB =
      setup(t);

    const supportCase =
      await createCase(
        DB,
        {
          key:
            "support-message-create"
        }
      );


    const input = {
      body:
        "Нужна помощь с автомобилем",
      expectedRevision:
        1
    };

    const options = {
      idempotencyKey:
        "support-message-key",
      requestId:
        "req_support_message",
      nowMs:
        time + 10
    };


    const first =
      await postDriverSupportMessage(
        {
          DB
        },
        driver,
        supportCase.id,
        input,
        options
      );

    assert.equal(
      first.ok,
      true
    );

    assert.equal(
      first.supportCaseRevision,
      2
    );

    assert.equal(
      Object.hasOwn(
        first.message,
        "body"
      ),
      false
    );

    assert.equal(
      first.message.expiresAt -
        first.message.createdAt,
      SUPPORT_CHAT_RETENTION_MS
    );


    const row =
      DB.sqlite.prepare(`
        SELECT
          body,
          expires_at
        FROM chat_messages
        WHERE id = ?
      `).get(
        first.message.id
      );

    assert.equal(
      row.body,
      input.body
    );

    assert.equal(
      Number(
        row.expires_at
      ),
      first.message.expiresAt
    );


    const replay =
      await postDriverSupportMessage(
        {
          DB
        },
        driver,
        supportCase.id,
        input,
        options
      );

    assert.deepEqual(
      replay,
      first
    );


    const idem =
      DB.sqlite.prepare(`
        SELECT result_json
        FROM mutation_idempotency
        WHERE actor_account_id = ?
          AND operation =
            'driver.support.message.create'
      `).get(
        driver.id
      );

    assert.equal(
      String(
        idem.result_json
      ).includes(
        input.body
      ),
      false
    );


    const changedBody =
      await postDriverSupportMessage(
        {
          DB
        },
        driver,
        supportCase.id,
        {
          ...input,
          body:
            "Другой текст"
        },
        options
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
  "dispatcher requires support.manage and can reply after permission is granted",
  async t => {
    const DB =
      setup(t);

    const supportCase =
      await createCase(
        DB,
        {
          key:
            "support-dispatch-create"
        }
      );


    const denied =
      await getAdminSupportCases(
        {
          DB
        },
        DISPATCHER
      );

    assert.equal(
      denied.status,
      403
    );


    DB.sqlite.prepare(`
      INSERT INTO staff_permissions (
        account_id,
        permission,
        granted_by,
        created_at
      )
      VALUES (
        ?,
        'support.manage',
        ?,
        1
      )
    `).run(
      DISPATCHER.id,
      OWNER.id
    );


    const list =
      await getAdminSupportCases(
        {
          DB
        },
        DISPATCHER
      );

    assert.equal(
      list.ok,
      true
    );

    assert.equal(
      list.supportCases.length,
      1
    );


    const reply =
      await postAdminSupportMessage(
        {
          DB
        },
        DISPATCHER,
        supportCase.id,
        {
          body:
            "Принято в работу",
          expectedRevision:
            1
        },
        {
          idempotencyKey:
            "support-admin-reply",
          nowMs:
            time + 20
        }
      );

    assert.equal(
      reply.ok,
      true
    );

    assert.equal(
      reply.message.senderKind,
      "dispatcher"
    );

    assert.equal(
      reply.supportCaseRevision,
      2
    );


    const detail =
      await getAdminSupportCase(
        {
          DB
        },
        DISPATCHER,
        supportCase.id,
        {
          nowMs:
            time + 21
        }
      );

    assert.equal(
      detail.ok,
      true
    );

    assert.equal(
      detail.supportCase.messages.length,
      1
    );

    assert.equal(
      detail.supportCase.messages[0]
        .body,
      "Принято в работу"
    );
  }
);


test(
  "admin support status is revision-locked and never mutates linked order",
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
        driver_id,
        created_at,
        updated_at
      )
      VALUES (
        'order_support_123',
        'Test',
        '+79990000000',
        'Test route',
        '2030-01-01',
        'taken',
        ?,
        1,
        1
      )
    `).run(
      driver.id
    );


    const supportCase =
      await createCase(
        DB,
        {
          orderId:
            "order_support_123",
          key:
            "support-linked-create"
        }
      );


    const closed =
      await postAdminSupportCaseStatus(
        {
          DB
        },
        OWNER,
        supportCase.id,
        {
          status:
            "closed",
          expectedRevision:
            1
        },
        {
          idempotencyKey:
            "support-close-key",
          requestId:
            "req_support_close",
          nowMs:
            time + 30
        }
      );


    assert.equal(
      closed.ok,
      true
    );

    assert.equal(
      closed.supportCase.status,
      "closed"
    );

    assert.equal(
      closed.supportCase.revision,
      2
    );

    assert.equal(
      closed.supportCase.resolvedBy,
      OWNER.id
    );


    const order =
      DB.sqlite.prepare(`
        SELECT status, driver_id
        FROM orders
        WHERE id = 'order_support_123'
      `).get();

    assert.equal(
      order.status,
      "taken"
    );

    assert.equal(
      order.driver_id,
      driver.id
    );


    const replay =
      await postAdminSupportCaseStatus(
        {
          DB
        },
        OWNER,
        supportCase.id,
        {
          status:
            "closed",
          expectedRevision:
            1
        },
        {
          idempotencyKey:
            "support-close-key",
          requestId:
            "req_support_close",
          nowMs:
            time + 30
        }
      );

    assert.deepEqual(
      replay,
      closed
    );


    const driverMessage =
      await postDriverSupportMessage(
        {
          DB
        },
        driver,
        supportCase.id,
        {
          body:
            "Сообщение после закрытия",
          expectedRevision:
            2
        },
        {
          idempotencyKey:
            "support-closed-message",
          nowMs:
            time + 31
        }
      );

    assert.equal(
      driverMessage.status,
      409
    );

    assert.equal(
      driverMessage.code,
      "support_message_preconditions_failed"
    );
  }
);


test(
  "expired support chat is hidden and physically deleted with system audit",
  async t => {
    const DB =
      setup(t);

    const supportCase =
      await createCase(
        DB,
        {
          key:
            "support-retention-create"
        }
      );


    const sent =
      await postDriverSupportMessage(
        {
          DB
        },
        driver,
        supportCase.id,
        {
          body:
            "Временное сообщение",
          expectedRevision:
            1
        },
        {
          idempotencyKey:
            "support-retention-message",
          nowMs:
            time + 100
        }
      );


    assert.equal(
      sent.ok,
      true
    );


    const before =
      await runSupportChatRetention(
        {
          DB
        },
        {
          nowMs:
            sent.message.expiresAt -
            1
        }
      );

    assert.equal(
      before.deleted,
      0
    );


    const visible =
      await getDriverSupportCase(
        {
          DB
        },
        driver,
        supportCase.id,
        {
          nowMs:
            sent.message.expiresAt -
            1
        }
      );

    assert.equal(
      visible.supportCase
        .messages.length,
      1
    );


    const atExpiry =
      await getDriverSupportCase(
        {
          DB
        },
        driver,
        supportCase.id,
        {
          nowMs:
            sent.message.expiresAt
        }
      );

    assert.equal(
      atExpiry.supportCase
        .messages.length,
      0
    );


    const cleanup =
      await runSupportChatRetention(
        {
          DB
        },
        {
          nowMs:
            sent.message.expiresAt
        }
      );

    assert.equal(
      cleanup.deleted,
      1
    );

    assert.equal(
      cleanup.idempotencyDeleted,
      1
    );


    assert.equal(
      Number(
        DB.sqlite.prepare(`
          SELECT COUNT(*) AS n
          FROM mutation_idempotency
          WHERE actor_account_id = ?
            AND operation =
              'driver.support.message.create'
        `).get(
          driver.id
        ).n
      ),
      0
    );


    assert.equal(
      Number(
        DB.sqlite.prepare(`
          SELECT COUNT(*) AS n
          FROM chat_messages
          WHERE support_case_id = ?
        `).get(
          supportCase.id
        ).n
      ),
      0
    );


    const audit =
      DB.sqlite.prepare(`
        SELECT
          actor_account_id,
          action,
          target_type,
          target_id
        FROM audit_events
        WHERE action =
          'system.support_chat_retention_deleted'
      `).get();


    assert.equal(
      audit.actor_account_id,
      null
    );

    assert.equal(
      audit.action,
      "system.support_chat_retention_deleted"
    );

    assert.equal(
      audit.target_type,
      "support_chat_retention"
    );

    assert.equal(
      audit.target_id,
      "expired_batch"
    );
  }
);
