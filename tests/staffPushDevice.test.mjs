import assert from "node:assert/strict";

import {
  registerStaffPushDevice,
  unregisterStaffPushDevice
} from "../src/core/staffPushDeviceService.js";

import {
  upsertStaffPushDevice,
  deleteStaffPushDevice
} from "../src/core/staffPushDeviceRepository.js";


// ========================================
// CONSTANTS
// ========================================

const FIXED_NOW =
  1700000000000;

const INSTALLATION_ID =
  "11111111-2222-4333-8444-555555555555";

const FCM_TOKEN =
  "fcm:test-token_123-ABC";


// ========================================
// TEST RUNNER
// ========================================

async function test(
  name,
  fn
) {

  try {

    await fn();

    console.log(
      `✓ ${name}`
    );

  } catch (
    error
  ) {

    console.error(
      `✘ ${name}`
    );

    console.error(
      error
    );

    process.exitCode =
      1;
  }
}


// ========================================
// FIXED TIME
// ========================================

async function withNow(
  value,
  fn
) {

  const originalNow =
    Date.now;


  Date.now =
    () => value;


  try {

    return await fn();

  } finally {

    Date.now =
      originalNow;
  }
}


// ========================================
// FAKE D1
// ========================================

function createFakeDatabase(
  {
    runResults = []
  } = {}
) {

  const calls =
    [];

  const results =
    [
      ...runResults
    ];


  const db = {

    prepare(
      sql
    ) {

      const call = {
        sql,
        args:
          null
      };


      calls.push(
        call
      );


      const statement = {

        bind(
          ...args
        ) {

          call.args =
            args;

          return statement;
        },


        async run() {

          if (
            results.length > 0
          ) {

            return results.shift();
          }


          return {
            success:
              true,

            meta: {
              changes:
                1
            }
          };
        }
      };


      return statement;
    }
  };


  return {
    db,
    calls
  };
}


// ========================================
// AUTH RESULT
// ========================================

function authenticatedStaff() {

  return {
    ok:
      true,

    user: {
      id:
        "staff-1",

      role:
        "driver",

      sessionId:
        "session-1"
    },

    session: {
      id:
        "session-1",

      accountId:
        "staff-1",

      familyId:
        "family-1"
    }
  };
}


// ========================================
// REGISTER
// ========================================

await test(
  "push registration uses authoritative staff identity and session family",
  async () => {

    await withNow(
      FIXED_NOW,
      async () => {

        const {
          db,
          calls
        } =
          createFakeDatabase();


        const result =
          await registerStaffPushDevice(
            {
              DB:
                db
            },
            authenticatedStaff(),
            {
              installationId:
                INSTALLATION_ID,

              platform:
                "ANDROID",

              token:
                FCM_TOKEN,

              accountId:
                "client-controlled-account",

              sessionFamilyId:
                "client-controlled-family"
            }
          );


        assert.deepEqual(
          result,
          {
            ok:
              true
          }
        );


        assert.equal(
          calls.length,
          1
        );


        assert.match(
          calls[0].sql,
          /INSERT INTO staff_push_devices/i
        );


        assert.match(
          calls[0].sql,
          /ON CONFLICT/i
        );


        assert.deepEqual(
          calls[0].args,
          [
            INSTALLATION_ID,
            "staff-1",
            "family-1",
            "android",
            FCM_TOKEN,
            FIXED_NOW
          ]
        );
      }
    );
  }
);


// ========================================
// INVALID REGISTER INPUT
// ========================================

await test(
  "push registration rejects invalid installation id before D1",
  async () => {

    const {
      db,
      calls
    } =
      createFakeDatabase();


    const result =
      await registerStaffPushDevice(
        {
          DB:
            db
        },
        authenticatedStaff(),
        {
          installationId:
            "not-a-uuid",

          platform:
            "android",

          token:
            FCM_TOKEN
        }
      );


    assert.equal(
      result.ok,
      false
    );


    assert.equal(
      result.status,
      400
    );


    assert.equal(
      calls.length,
      0
    );
  }
);


await test(
  "push registration rejects whitespace inside FCM token",
  async () => {

    const {
      db,
      calls
    } =
      createFakeDatabase();


    const result =
      await registerStaffPushDevice(
        {
          DB:
            db
        },
        authenticatedStaff(),
        {
          installationId:
            INSTALLATION_ID,

          platform:
            "android",

          token:
            "invalid token"
        }
      );


    assert.equal(
      result.status,
      400
    );


    assert.equal(
      calls.length,
      0
    );
  }
);


// ========================================
// UNREGISTER
// ========================================

await test(
  "push unregister is scoped to authenticated staff account",
  async () => {

    const {
      db,
      calls
    } =
      createFakeDatabase(
        {
          runResults: [
            {
              success:
                true,

              meta: {
                changes:
                  0
              }
            }
          ]
        }
      );


    const result =
      await unregisterStaffPushDevice(
        {
          DB:
            db
        },
        authenticatedStaff(),
        {
          installationId:
            INSTALLATION_ID,

          accountId:
            "other-account"
        }
      );


    assert.deepEqual(
      result,
      {
        ok:
          true
      }
    );


    assert.equal(
      calls.length,
      1
    );


    assert.match(
      calls[0].sql,
      /DELETE FROM staff_push_devices/i
    );


    assert.deepEqual(
      calls[0].args,
      [
        INSTALLATION_ID,
        "staff-1"
      ]
    );
  }
);


// ========================================
// REPOSITORY INVARIANTS
// ========================================

await test(
  "repository rejects an upsert result which changed zero rows",
  async () => {

    const {
      db
    } =
      createFakeDatabase(
        {
          runResults: [
            {
              success:
                true,

              meta: {
                changes:
                  0
              }
            }
          ]
        }
      );


    await assert.rejects(
      () =>
        upsertStaffPushDevice(
          {
            DB:
              db
          },
          {
            installationId:
              INSTALLATION_ID,

            accountId:
              "staff-1",

            sessionFamilyId:
              "family-1",

            platform:
              "android",

            fcmToken:
              FCM_TOKEN,

            updatedAt:
              FIXED_NOW
          }
        ),
      /Invalid staff push device upsert result/
    );
  }
);


await test(
  "repository accepts idempotent delete with zero changed rows",
  async () => {

    const {
      db
    } =
      createFakeDatabase(
        {
          runResults: [
            {
              success:
                true,

              meta: {
                changes:
                  0
              }
            }
          ]
        }
      );


    const result =
      await deleteStaffPushDevice(
        {
          DB:
            db
        },
        "staff-1",
        INSTALLATION_ID
      );


    assert.deepEqual(
      result,
      {
        ok:
          true,

        changed:
          false
      }
    );
  }
);
