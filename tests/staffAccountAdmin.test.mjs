import assert from "node:assert/strict";

import {
  webcrypto
} from "node:crypto";

import {
  STAFF_PASSWORD_ITERATIONS
} from "../src/core/staffAuthCrypto.js";

import {
  listStaffAccounts,
  createDriverAccount,
  changeDriverStatus,
  resetDriverPassword
} from "../src/core/staffAccountAdminService.js";


// ========================================
// WEB CRYPTO
// ========================================

if (
  !globalThis.crypto
) {

  globalThis.crypto =
    webcrypto;
}


if (
  typeof globalThis.btoa !==
    "function"
) {

  globalThis.btoa =
    value =>
      Buffer
        .from(
          value,
          "binary"
        )
        .toString(
          "base64"
        );
}


if (
  typeof globalThis.atob !==
    "function"
) {

  globalThis.atob =
    value =>
      Buffer
        .from(
          value,
          "base64"
        )
        .toString(
          "binary"
        );
}


// ========================================
// CONSTANTS
// ========================================

const FIXED_NOW =
  1700000000000;


const PASSWORD =
  "Driver-Test-Password-123!";


const NEW_PASSWORD =
  "Driver-New-Password-456!";


const ADMIN_ACTOR = {
  id:
    "staff_admin_0001",

  role:
    "admin"
};


const DRIVER_ACTOR = {
  id:
    "staff_driver_0001",

  role:
    "driver"
};


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
// STAFF SUMMARY ROW
// ========================================

function staffRow(
  overrides = {}
) {

  return {
    id:
      "staff_driver_0001",

    login:
      "driver.one",

    display_name:
      "Driver One",

    role:
      "driver",

    status:
      "active",

    token_version:
      1,

    created_at:
      1000,

    updated_at:
      1000,

    ...overrides
  };
}


// ========================================
// FAKE D1
// ========================================

function createFakeDatabase(
  options = {}
) {

  const calls =
    [];


  const batchCalls =
    [];


  const firstResults =
    Array.isArray(
      options.firstResults
    )
      ? [
          ...options.firstResults
        ]
      : [];


  const allResults =
    Array.isArray(
      options.allResults
    )
      ? [
          ...options.allResults
        ]
      : [];


  const db = {

    prepare(
      sql
    ) {

      const call = {
        sql,
        args:
          []
      };


      calls.push(
        call
      );


      const statement = {

        __call:
          call,


        bind(
          ...args
        ) {

          call.args =
            args;

          return statement;
        },


        async first() {

          if (
            firstResults.length ===
              0
          ) {

            return null;
          }


          const value =
            firstResults.shift();


          if (
            typeof value ===
              "function"
          ) {

            return value(
              call
            );
          }


          return value;
        },


        async all() {

          if (
            allResults.length ===
              0
          ) {

            return {
              success:
                true,

              results:
                []
            };
          }


          const value =
            allResults.shift();


          if (
            typeof value ===
              "function"
          ) {

            return value(
              call
            );
          }


          return value;
        },


        async run() {

          return (
            options.runResult
            ??
            {
              success:
                true,

              meta: {
                changes:
                  1
              }
            }
          );
        }
      };


      return statement;
    },


    async batch(
      statements
    ) {

      batchCalls.push(
        statements.map(
          statement =>
            statement.__call
        )
      );


      if (
        options.batchError
      ) {

        throw options.batchError;
      }


      if (
        Array.isArray(
          options.batchResults
        )
      ) {

        return options.batchResults;
      }


      return statements.map(
        () => ({
          success:
            true,

          meta: {
            changes:
              1
          }
        })
      );
    }
  };


  return {
    db,
    calls,
    batchCalls
  };
}


// ========================================
// PASSWORD POLICY
// ========================================

await test(
  "staff admin uses current production PBKDF2 work factor",
  async () => {

    assert.equal(
      STAFF_PASSWORD_ITERATIONS,
      100000
    );
  }
);


// ========================================
// LIST
// ========================================

await test(
  "admin can list staff without password verifier fields",
  async () => {

    const {
      db,
      calls
    } =
      createFakeDatabase(
        {
          allResults: [
            {
              success:
                true,

              results: [
                staffRow({
                  id:
                    "staff_admin_0001",

                  login:
                    "superadm",

                  display_name:
                    "Nicko",

                  role:
                    "admin"
                }),

                staffRow()
              ]
            }
          ]
        }
      );


    const result =
      await listStaffAccounts(
        {
          DB:
            db
        },
        ADMIN_ACTOR
      );


    assert.equal(
      result.ok,
      true
    );


    assert.equal(
      result.status,
      200
    );


    assert.equal(
      result.count,
      2
    );


    assert.equal(
      result.staff.length,
      2
    );


    for (
      const account
      of result.staff
    ) {

      assert.equal(
        Object.hasOwn(
          account,
          "password"
        ),
        false
      );


      assert.equal(
        Object.hasOwn(
          account,
          "passwordHash"
        ),
        false
      );


      assert.equal(
        Object.hasOwn(
          account,
          "passwordSalt"
        ),
        false
      );


      assert.equal(
        Object.hasOwn(
          account,
          "passwordVerifier"
        ),
        false
      );
    }


    assert.doesNotMatch(
      calls[0].sql,
      /password_hash/i
    );


    assert.doesNotMatch(
      calls[0].sql,
      /password_salt/i
    );
  }
);


// ========================================
// DRIVER CANNOT LIST
// ========================================

await test(
  "driver cannot use staff account administration",
  async () => {

    const {
      db,
      calls
    } =
      createFakeDatabase();


    const result =
      await listStaffAccounts(
        {
          DB:
            db
        },
        DRIVER_ACTOR
      );


    assert.equal(
      result.ok,
      false
    );


    assert.equal(
      result.status,
      403
    );


    assert.equal(
      calls.length,
      0
    );
  }
);


// ========================================
// CREATE ADMIN IS IMPOSSIBLE
// ========================================

await test(
  "create endpoint rejects client-selected admin role",
  async () => {

    const {
      db,
      calls,
      batchCalls
    } =
      createFakeDatabase();


    const input = {
      login:
        "driver.two",

      displayName:
        "Driver Two",

      password:
        PASSWORD,

      role:
        "admin"
    };


    const result =
      await createDriverAccount(
        {
          DB:
            db
        },
        ADMIN_ACTOR,
        input
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


    assert.equal(
      batchCalls.length,
      0
    );
  }
);


// ========================================
// CREATE DRIVER
// ========================================

await test(
  "admin creates active driver with audit and no plaintext password in D1 calls",
  async () => {

    const {
      db,
      calls,
      batchCalls
    } =
      createFakeDatabase(
        {
          firstResults: [

            // Existing login lookup.
            null,

            // Created-account readback.
            call =>
              staffRow({
                id:
                  call.args[0],

                login:
                  "driver.two",

                display_name:
                  "Driver Two",

                role:
                  "driver",

                status:
                  "active",

                token_version:
                  1,

                created_at:
                  FIXED_NOW,

                updated_at:
                  FIXED_NOW
              })
          ],

          batchResults: [
            {
              success:
                true,

              meta: {
                changes:
                  1
              }
            },

            {
              success:
                true,

              meta: {
                changes:
                  1
              }
            }
          ]
        }
      );


    const input = {
      login:
        " DRIVER.TWO ",

      displayName:
        "Driver Two",

      password:
        PASSWORD
    };


    const result =
      await withNow(
        FIXED_NOW,
        () =>
          createDriverAccount(
            {
              DB:
                db
            },
            ADMIN_ACTOR,
            input
          )
      );


    assert.equal(
      result.ok,
      true
    );


    assert.equal(
      result.status,
      201
    );


    assert.equal(
      result.staff.login,
      "driver.two"
    );


    assert.equal(
      result.staff.role,
      "driver"
    );


    assert.equal(
      result.staff.status,
      "active"
    );


    assert.equal(
      result.staff.tokenVersion,
      1
    );


    assert.equal(
      input.password,
      null
    );


    assert.equal(
      batchCalls.length,
      1
    );


    assert.equal(
      batchCalls[0].length,
      2
    );


    const createCall =
      batchCalls[0][0];


    const auditCall =
      batchCalls[0][1];


    assert.match(
      createCall.sql,
      /INSERT INTO staff_accounts/i
    );


    assert.match(
      createCall.sql,
      /'driver'/i
    );


    assert.match(
      createCall.sql,
      /'active'/i
    );


    assert.match(
      auditCall.sql,
      /account_created/i
    );


    assert.equal(
      createCall.args.includes(
        STAFF_PASSWORD_ITERATIONS
      ),
      true
    );


    const serializedCalls =
      JSON.stringify(
        calls
      );


    assert.equal(
      serializedCalls.includes(
        PASSWORD
      ),
      false
    );
  }
);


// ========================================
// DUPLICATE LOGIN
// ========================================

await test(
  "existing login is rejected before password hashing and account creation",
  async () => {

    const {
      db,
      batchCalls
    } =
      createFakeDatabase(
        {
          firstResults: [
            staffRow()
          ]
        }
      );


    const input = {
      login:
        "driver.one",

      displayName:
        "Duplicate Driver",

      password:
        PASSWORD
    };


    const result =
      await createDriverAccount(
        {
          DB:
            db
        },
        ADMIN_ACTOR,
        input
      );


    assert.equal(
      result.ok,
      false
    );


    assert.equal(
      result.status,
      409
    );


    assert.equal(
      batchCalls.length,
      0
    );


    assert.equal(
      input.password,
      null
    );
  }
);


// ========================================
// STATUS: ADMIN TARGET PROTECTED
// ========================================

await test(
  "admin account cannot be modified through driver status API",
  async () => {

    const {
      db,
      batchCalls
    } =
      createFakeDatabase(
        {
          firstResults: [
            staffRow({
              id:
                "staff_admin_0002",

              login:
                "admin.two",

              display_name:
                "Admin Two",

              role:
                "admin",

              status:
                "active"
            })
          ]
        }
      );


    const result =
      await changeDriverStatus(
        {
          DB:
            db
        },
        ADMIN_ACTOR,
        "staff_admin_0002",
        {
          status:
            "disabled"
        }
      );


    assert.equal(
      result.ok,
      false
    );


    assert.equal(
      result.status,
      403
    );


    assert.equal(
      batchCalls.length,
      0
    );
  }
);


// ========================================
// STATUS: INVALID PENDING
// ========================================

await test(
  "pending is not an allowed admin-managed target status",
  async () => {

    const {
      db,
      calls
    } =
      createFakeDatabase();


    const result =
      await changeDriverStatus(
        {
          DB:
            db
        },
        ADMIN_ACTOR,
        "staff_driver_0001",
        {
          status:
            "pending"
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


// ========================================
// STATUS CHANGE
// ========================================

await test(
  "driver status change increments token version revokes sessions and audits",
  async () => {

    const {
      db,
      batchCalls
    } =
      createFakeDatabase(
        {
          firstResults: [

            staffRow({
              status:
                "active",

              token_version:
                1
            }),

            staffRow({
              status:
                "suspended",

              token_version:
                2,

              updated_at:
                FIXED_NOW
            })
          ],

          batchResults: [
            {
              success:
                true,

              meta: {
                changes:
                  1
              }
            },

            {
              success:
                true,

              meta: {
                changes:
                  1
              }
            },

            {
              success:
                true,

              meta: {
                changes:
                  2
              }
            }
          ]
        }
      );


    const result =
      await withNow(
        FIXED_NOW,
        () =>
          changeDriverStatus(
            {
              DB:
                db
            },
            ADMIN_ACTOR,
            "staff_driver_0001",
            {
              status:
                "suspended"
            }
          )
      );


    assert.equal(
      result.ok,
      true
    );


    assert.equal(
      result.changed,
      true
    );


    assert.equal(
      result.staff.status,
      "suspended"
    );


    assert.equal(
      result.staff.tokenVersion,
      2
    );


    assert.equal(
      batchCalls.length,
      1
    );


    assert.equal(
      batchCalls[0].length,
      3
    );


    const auditCall =
      batchCalls[0][0];


    const accountCall =
      batchCalls[0][1];


    const sessionCall =
      batchCalls[0][2];


    assert.match(
      auditCall.sql,
      /status_changed/i
    );


    assert.match(
      accountCall.sql,
      /token_version\s*=\s*token_version\s*\+\s*1/i
    );


    assert.match(
      accountCall.sql,
      /status\s*=\s*\?1/i
    );


    assert.match(
      sessionCall.sql,
      /UPDATE staff_sessions/i
    );


    assert.match(
      sessionCall.sql,
      /revoked_at/i
    );
  }
);


// ========================================
// IDEMPOTENT STATUS
// ========================================

await test(
  "setting current driver status is idempotent",
  async () => {

    const {
      db,
      batchCalls
    } =
      createFakeDatabase(
        {
          firstResults: [
            staffRow({
              status:
                "suspended",

              token_version:
                2
            })
          ]
        }
      );


    const result =
      await changeDriverStatus(
        {
          DB:
            db
        },
        ADMIN_ACTOR,
        "staff_driver_0001",
        {
          status:
            "suspended"
        }
      );


    assert.equal(
      result.ok,
      true
    );


    assert.equal(
      result.changed,
      false
    );


    assert.equal(
      result.staff.tokenVersion,
      2
    );


    assert.equal(
      batchCalls.length,
      0
    );
  }
);


// ========================================
// PASSWORD: INVALID
// ========================================

await test(
  "short reset password is rejected before D1 access",
  async () => {

    const {
      db,
      calls
    } =
      createFakeDatabase();


    const result =
      await resetDriverPassword(
        {
          DB:
            db
        },
        ADMIN_ACTOR,
        "staff_driver_0001",
        {
          password:
            "short"
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


// ========================================
// PASSWORD: ADMIN TARGET PROTECTED
// ========================================

await test(
  "admin password cannot be reset through driver management API",
  async () => {

    const {
      db,
      batchCalls
    } =
      createFakeDatabase(
        {
          firstResults: [
            staffRow({
              id:
                "staff_admin_0002",

              login:
                "admin.two",

              role:
                "admin"
            })
          ]
        }
      );


    const input = {
      password:
        NEW_PASSWORD
    };


    const result =
      await resetDriverPassword(
        {
          DB:
            db
        },
        ADMIN_ACTOR,
        "staff_admin_0002",
        input
      );


    assert.equal(
      result.ok,
      false
    );


    assert.equal(
      result.status,
      403
    );


    assert.equal(
      input.password,
      null
    );


    assert.equal(
      batchCalls.length,
      0
    );
  }
);


// ========================================
// PASSWORD RESET
// ========================================

await test(
  "driver password reset uses current PBKDF2 policy invalidates tokens and clears lock state",
  async () => {

    const {
      db,
      calls,
      batchCalls
    } =
      createFakeDatabase(
        {
          firstResults: [

            staffRow({
              status:
                "active",

              token_version:
                1
            }),

            staffRow({
              status:
                "active",

              token_version:
                2,

              updated_at:
                FIXED_NOW
            })
          ],

          batchResults: [
            {
              success:
                true,

              meta: {
                changes:
                  1
              }
            },

            {
              success:
                true,

              meta: {
                changes:
                  1
              }
            },

            {
              success:
                true,

              meta: {
                changes:
                  1
              }
            }
          ]
        }
      );


    const input = {
      password:
        NEW_PASSWORD
    };


    const result =
      await withNow(
        FIXED_NOW,
        () =>
          resetDriverPassword(
            {
              DB:
                db
            },
            ADMIN_ACTOR,
            "staff_driver_0001",
            input
          )
      );


    assert.equal(
      result.ok,
      true
    );


    assert.equal(
      result.status,
      200
    );


    assert.equal(
      result.staff.role,
      "driver"
    );


    assert.equal(
      result.staff.tokenVersion,
      2
    );


    assert.equal(
      input.password,
      null
    );


    assert.equal(
      batchCalls.length,
      1
    );


    assert.equal(
      batchCalls[0].length,
      3
    );


    const auditCall =
      batchCalls[0][0];


    const accountCall =
      batchCalls[0][1];


    const sessionCall =
      batchCalls[0][2];


    assert.match(
      auditCall.sql,
      /password_reset/i
    );


    assert.match(
      accountCall.sql,
      /password_algorithm/i
    );


    assert.match(
      accountCall.sql,
      /password_iterations/i
    );


    assert.match(
      accountCall.sql,
      /token_version\s*=\s*token_version\s*\+\s*1/i
    );


    assert.match(
      accountCall.sql,
      /failed_login_count\s*=\s*0/i
    );


    assert.match(
      accountCall.sql,
      /locked_until\s*=\s*NULL/i
    );


    assert.match(
      accountCall.sql,
      /last_failed_login_at\s*=\s*NULL/i
    );


    assert.match(
      sessionCall.sql,
      /UPDATE staff_sessions/i
    );


    assert.match(
      sessionCall.sql,
      /revoked_at/i
    );


    assert.equal(
      accountCall.args.includes(
        STAFF_PASSWORD_ITERATIONS
      ),
      true
    );


    const serializedCalls =
      JSON.stringify(
        calls
      );


    assert.equal(
      serializedCalls.includes(
        NEW_PASSWORD
      ),
      false
    );


    assert.equal(
      Object.hasOwn(
        result.staff,
        "passwordHash"
      ),
      false
    );


    assert.equal(
      Object.hasOwn(
        result.staff,
        "passwordSalt"
      ),
      false
    );


    assert.equal(
      Object.hasOwn(
        result.staff,
        "passwordVerifier"
      ),
      false
    );
  }
);


// ========================================
// FINISH
// ========================================

console.log("");


if (
  !process.exitCode
) {

  console.log(
    "✓ ALL STAFF ACCOUNT ADMIN TESTS PASSED"
  );
}