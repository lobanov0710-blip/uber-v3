import assert from "node:assert/strict";

import {
  webcrypto
} from "node:crypto";

import router
  from "../src/router.js";

import {
  signJWT
} from "../src/core/auth.js";


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

const JWT_SECRET =
  "0123456789abcdef0123456789abcdef";


const FIXED_NOW =
  1700000000000;


const ADMIN_ID =
  "staff_admin_0001";


const DRIVER_ID =
  "staff_driver_0001";


const SESSION_ID =
  "staff-session_test_0001";


const PASSWORD =
  "Driver-Router-Test-Password-123!";


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
// JSON RESPONSE
// ========================================

async function jsonBody(
  response
) {

  return JSON.parse(
    await response.text()
  );
}


// ========================================
// STAFF ACCOUNT ROW
// ========================================

function accountRow(
  overrides = {}
) {

  return {
    id:
      DRIVER_ID,

    login:
      "driver.one",

    display_name:
      "Driver One",

    role:
      "driver",

    status:
      "active",

    password_algorithm:
      "pbkdf2-sha256",

    password_iterations:
      100000,

    password_salt:
      "aaaaaaaaaaaaaaaaaaaaaa",

    password_hash:
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",

    token_version:
      1,

    failed_login_count:
      0,

    locked_until:
      null,

    last_failed_login_at:
      null,

    last_login_at:
      null,

    password_changed_at:
      1000,

    created_at:
      1000,

    updated_at:
      1000,

    ...overrides
  };
}


// ========================================
// SESSION ROW
// ========================================

function sessionRow(
  overrides = {}
) {

  return {
    id:
      SESSION_ID,

    account_id:
      ADMIN_ID,

    family_id:
      "staff-family_test_0001",

    refresh_token_hash:
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",

    created_at:
      FIXED_NOW - 1000,

    expires_at:
      FIXED_NOW + 600000,

    last_used_at:
      null,

    revoked_at:
      null,

    replaced_by_session_id:
      null,

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

      const callsForBatch =
        statements.map(
          statement =>
            statement.__call
        );


      batchCalls.push(
        callsForBatch
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
// STAFF TOKEN
// ========================================

async function createStaffToken(
  {
    id,
    role,
    sessionId =
      SESSION_ID,

    tokenVersion =
      1
  }
) {

  return signJWT(
    JWT_SECRET,
    {
      sub:
        id,

      id,

      role,

      scope:
        "staff",

      tokenVersion,

      sid:
        sessionId
    },
    900
  );
}


// ========================================
// AUTHENTICATED REQUEST
// ========================================

function authenticatedRequest(
  path,
  token,
  {
    method = "GET",
    body = null
  } = {}
) {

  const options = {

    method,

    headers: {
      Authorization:
        `Bearer ${token}`
    }
  };


  if (
    body !== null
  ) {

    options.headers[
      "Content-Type"
    ] =
      "application/json";


    options.body =
      JSON.stringify(
        body
      );
  }


  return new Request(
    `https://worker.test${path}`,
    options
  );
}


// ========================================
// NO JWT
// ========================================

await test(
  "staff account list requires authentication",
  async () => {

    const {
      db,
      calls
    } =
      createFakeDatabase();


    const response =
      await router(
        new Request(
          "https://worker.test/staff/accounts"
        ),
        {
          DB:
            db,

          JWT_SECRET
        }
      );


    const body =
      await jsonBody(
        response
      );


    assert.equal(
      response.status,
      401
    );


    assert.equal(
      body.ok,
      false
    );


    assert.equal(
      calls.length,
      0
    );
  }
);


// ========================================
// DRIVER -> FORBIDDEN
// ========================================

await test(
  "driver cannot list staff accounts",
  async () => {

    await withNow(
      FIXED_NOW,
      async () => {

        const token =
          await createStaffToken(
            {
              id:
                DRIVER_ID,

              role:
                "driver"
            }
          );


        const {
          db,
          calls
        } =
          createFakeDatabase(
            {
              firstResults: [

                accountRow(),

                sessionRow({
                  account_id:
                    DRIVER_ID
                })
              ]
            }
          );


        const response =
          await router(
            authenticatedRequest(
              "/staff/accounts",
              token
            ),
            {
              DB:
                db,

              JWT_SECRET
            }
          );


        const body =
          await jsonBody(
            response
          );


        assert.equal(
          response.status,
          403
        );


        assert.equal(
          body.error,
          "forbidden"
        );


        assert.equal(
          calls.some(
            call =>
              /FROM staff_accounts[\s\S]*ORDER BY/i
                .test(
                  call.sql
                )
          ),
          false
        );
      }
    );
  }
);


// ========================================
// ADMIN LIST
// ========================================

await test(
  "admin can list staff accounts",
  async () => {

    await withNow(
      FIXED_NOW,
      async () => {

        const token =
          await createStaffToken(
            {
              id:
                ADMIN_ID,

              role:
                "admin"
            }
          );


        const {
          db
        } =
          createFakeDatabase(
            {
              firstResults: [

                accountRow({
                  id:
                    ADMIN_ID,

                  login:
                    "superadm",

                  display_name:
                    "Nicko",

                  role:
                    "admin"
                }),

                sessionRow()
              ],

              allResults: [
                {
                  success:
                    true,

                  results: [

                    accountRow({
                      id:
                        ADMIN_ID,

                      login:
                        "superadm",

                      display_name:
                        "Nicko",

                      role:
                        "admin"
                    }),

                    accountRow()
                  ]
                }
              ]
            }
          );


        const response =
          await router(
            authenticatedRequest(
              "/staff/accounts",
              token
            ),
            {
              DB:
                db,

              JWT_SECRET
            }
          );


        const body =
          await jsonBody(
            response
          );


        assert.equal(
          response.status,
          200
        );


        assert.equal(
          body.ok,
          true
        );


        assert.equal(
          body.count,
          2
        );


        assert.equal(
          body.staff.length,
          2
        );


        for (
          const staff
          of body.staff
        ) {

          assert.equal(
            Object.hasOwn(
              staff,
              "password"
            ),
            false
          );


          assert.equal(
            Object.hasOwn(
              staff,
              "passwordHash"
            ),
            false
          );


          assert.equal(
            Object.hasOwn(
              staff,
              "passwordSalt"
            ),
            false
          );


          assert.equal(
            Object.hasOwn(
              staff,
              "passwordVerifier"
            ),
            false
          );
        }
      }
    );
  }
);


// ========================================
// CREATE ADMIN FORBIDDEN
// ========================================

await test(
  "admin cannot create another admin through staff account API",
  async () => {

    await withNow(
      FIXED_NOW,
      async () => {

        const token =
          await createStaffToken(
            {
              id:
                ADMIN_ID,

              role:
                "admin"
            }
          );


        const {
          db,
          batchCalls
        } =
          createFakeDatabase(
            {
              firstResults: [

                accountRow({
                  id:
                    ADMIN_ID,

                  login:
                    "superadm",

                  display_name:
                    "Nicko",

                  role:
                    "admin"
                }),

                sessionRow()
              ]
            }
          );


        const response =
          await router(
            authenticatedRequest(
              "/staff/accounts",
              token,
              {
                method:
                  "POST",

                body: {
                  login:
                    "admin.two",

                  displayName:
                    "Admin Two",

                  password:
                    PASSWORD,

                  role:
                    "admin"
                }
              }
            ),
            {
              DB:
                db,

              JWT_SECRET
            }
          );


        const body =
          await jsonBody(
            response
          );


        assert.equal(
          response.status,
          400
        );


        assert.equal(
          body.ok,
          false
        );


        assert.equal(
          batchCalls.length,
          0
        );
      }
    );
  }
);


// ========================================
// CREATE DRIVER
// ========================================

await test(
  "admin creates driver through router",
  async () => {

    await withNow(
      FIXED_NOW,
      async () => {

        const token =
          await createStaffToken(
            {
              id:
                ADMIN_ID,

              role:
                "admin"
            }
          );


        const {
          db,
          calls,
          batchCalls
        } =
          createFakeDatabase(
            {
              firstResults: [

                // Staff authorization:
                // account.
                accountRow({
                  id:
                    ADMIN_ID,

                  login:
                    "superadm",

                  display_name:
                    "Nicko",

                  role:
                    "admin"
                }),

                // Staff authorization:
                // session.
                sessionRow(),

                // Duplicate-login check.
                null,

                // Created driver readback.
                call =>
                  accountRow({
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
              ]
            }
          );


        const response =
          await router(
            authenticatedRequest(
              "/staff/accounts",
              token,
              {
                method:
                  "POST",

                body: {
                  login:
                    "driver.two",

                  displayName:
                    "Driver Two",

                  password:
                    PASSWORD
                }
              }
            ),
            {
              DB:
                db,

              JWT_SECRET
            }
          );


        const body =
          await jsonBody(
            response
          );


        assert.equal(
          response.status,
          201
        );


        assert.equal(
          body.ok,
          true
        );


        assert.equal(
          body.staff.login,
          "driver.two"
        );


        assert.equal(
          body.staff.role,
          "driver"
        );


        assert.equal(
          body.staff.status,
          "active"
        );


        assert.equal(
          Object.hasOwn(
            body.staff,
            "password"
          ),
          false
        );


        assert.equal(
          Object.hasOwn(
            body.staff,
            "passwordHash"
          ),
          false
        );


        assert.equal(
          Object.hasOwn(
            body.staff,
            "passwordSalt"
          ),
          false
        );


        assert.equal(
          Object.hasOwn(
            body.staff,
            "passwordVerifier"
          ),
          false
        );


        assert.equal(
          batchCalls.length,
          1
        );


        assert.equal(
          batchCalls[0].length,
          2
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
  }
);


// ========================================
// SUPERADMIN STATUS PROTECTED
// ========================================

await test(
  "superadm cannot be disabled through driver management endpoint",
  async () => {

    await withNow(
      FIXED_NOW,
      async () => {

        const token =
          await createStaffToken(
            {
              id:
                ADMIN_ID,

              role:
                "admin"
            }
          );


        const {
          db,
          batchCalls
        } =
          createFakeDatabase(
            {
              firstResults: [

                // Authorization account.
                accountRow({
                  id:
                    ADMIN_ID,

                  login:
                    "superadm",

                  display_name:
                    "Nicko",

                  role:
                    "admin"
                }),

                // Authorization session.
                sessionRow(),

                // Target account.
                accountRow({
                  id:
                    ADMIN_ID,

                  login:
                    "superadm",

                  display_name:
                    "Nicko",

                  role:
                    "admin",

                  status:
                    "active"
                })
              ]
            }
          );


        const response =
          await router(
            authenticatedRequest(
              `/staff/accounts/${ADMIN_ID}/status`,
              token,
              {
                method:
                  "PATCH",

                body: {
                  status:
                    "disabled"
                }
              }
            ),
            {
              DB:
                db,

              JWT_SECRET
            }
          );


        const body =
          await jsonBody(
            response
          );


        assert.equal(
          response.status,
          403
        );


        assert.equal(
          body.error,
          "staff account is not manageable"
        );


        assert.equal(
          batchCalls.length,
          0
        );
      }
    );
  }
);


// ========================================
// DRIVER STATUS SUCCESS
// ========================================

await test(
  "admin suspends driver through router and revokes sessions",
  async () => {

    await withNow(
      FIXED_NOW,
      async () => {

        const token =
          await createStaffToken(
            {
              id:
                ADMIN_ID,

              role:
                "admin"
            }
          );


        const {
          db,
          batchCalls
        } =
          createFakeDatabase(
            {
              firstResults: [

                accountRow({
                  id:
                    ADMIN_ID,

                  login:
                    "superadm",

                  display_name:
                    "Nicko",

                  role:
                    "admin"
                }),

                sessionRow(),

                accountRow({
                  id:
                    DRIVER_ID,

                  role:
                    "driver",

                  status:
                    "active",

                  token_version:
                    1
                }),

                accountRow({
                  id:
                    DRIVER_ID,

                  role:
                    "driver",

                  status:
                    "suspended",

                  token_version:
                    2,

                  updated_at:
                    FIXED_NOW
                })
              ]
            }
          );


        const response =
          await router(
            authenticatedRequest(
              `/staff/accounts/${DRIVER_ID}/status`,
              token,
              {
                method:
                  "PATCH",

                body: {
                  status:
                    "suspended"
                }
              }
            ),
            {
              DB:
                db,

              JWT_SECRET
            }
          );


        const body =
          await jsonBody(
            response
          );


        assert.equal(
          response.status,
          200
        );


        assert.equal(
          body.ok,
          true
        );


        assert.equal(
          body.changed,
          true
        );


        assert.equal(
          body.staff.status,
          "suspended"
        );


        assert.equal(
          body.staff.tokenVersion,
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


        assert.match(
          batchCalls[0][2].sql,
          /UPDATE staff_sessions/i
        );


        assert.match(
          batchCalls[0][2].sql,
          /revoked_at/i
        );
      }
    );
  }
);


// ========================================
// SUPERADMIN PASSWORD PROTECTED
// ========================================

await test(
  "superadm password cannot be reset through driver management endpoint",
  async () => {

    await withNow(
      FIXED_NOW,
      async () => {

        const token =
          await createStaffToken(
            {
              id:
                ADMIN_ID,

              role:
                "admin"
            }
          );


        const {
          db,
          batchCalls
        } =
          createFakeDatabase(
            {
              firstResults: [

                accountRow({
                  id:
                    ADMIN_ID,

                  login:
                    "superadm",

                  display_name:
                    "Nicko",

                  role:
                    "admin"
                }),

                sessionRow(),

                accountRow({
                  id:
                    ADMIN_ID,

                  login:
                    "superadm",

                  display_name:
                    "Nicko",

                  role:
                    "admin"
                })
              ]
            }
          );


        const response =
          await router(
            authenticatedRequest(
              `/staff/accounts/${ADMIN_ID}/password-reset`,
              token,
              {
                method:
                  "POST",

                body: {
                  password:
                    PASSWORD
                }
              }
            ),
            {
              DB:
                db,

              JWT_SECRET
            }
          );


        const body =
          await jsonBody(
            response
          );


        assert.equal(
          response.status,
          403
        );


        assert.equal(
          body.error,
          "staff account is not manageable"
        );


        assert.equal(
          batchCalls.length,
          0
        );
      }
    );
  }
);


// ========================================
// PASSWORD RESET SUCCESS
// ========================================

await test(
  "admin resets driver password through router",
  async () => {

    await withNow(
      FIXED_NOW,
      async () => {

        const token =
          await createStaffToken(
            {
              id:
                ADMIN_ID,

              role:
                "admin"
            }
          );


        const {
          db,
          calls,
          batchCalls
        } =
          createFakeDatabase(
            {
              firstResults: [

                accountRow({
                  id:
                    ADMIN_ID,

                  login:
                    "superadm",

                  display_name:
                    "Nicko",

                  role:
                    "admin"
                }),

                sessionRow(),

                accountRow({
                  id:
                    DRIVER_ID,

                  role:
                    "driver",

                  status:
                    "active",

                  token_version:
                    1
                }),

                accountRow({
                  id:
                    DRIVER_ID,

                  role:
                    "driver",

                  status:
                    "active",

                  token_version:
                    2,

                  updated_at:
                    FIXED_NOW
                })
              ]
            }
          );


        const response =
          await router(
            authenticatedRequest(
              `/staff/accounts/${DRIVER_ID}/password-reset`,
              token,
              {
                method:
                  "POST",

                body: {
                  password:
                    PASSWORD
                }
              }
            ),
            {
              DB:
                db,

              JWT_SECRET
            }
          );


        const body =
          await jsonBody(
            response
          );


        assert.equal(
          response.status,
          200
        );


        assert.equal(
          body.ok,
          true
        );


        assert.equal(
          body.staff.tokenVersion,
          2
        );


        assert.equal(
          Object.hasOwn(
            body.staff,
            "passwordVerifier"
          ),
          false
        );


        assert.equal(
          batchCalls.length,
          1
        );


        assert.equal(
          batchCalls[0].length,
          3
        );


        assert.match(
          batchCalls[0][1].sql,
          /password_iterations/i
        );


        assert.match(
          batchCalls[0][2].sql,
          /UPDATE staff_sessions/i
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
    "✓ ALL STAFF ADMIN ROUTER TESTS PASSED"
  );
}