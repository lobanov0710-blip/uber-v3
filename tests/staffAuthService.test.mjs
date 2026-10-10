import assert from "node:assert/strict";

import {
  webcrypto
} from "node:crypto";

import {
  loginStaff,
  refreshStaff,
  logoutStaff,
  STAFF_ACCESS_TTL_SECONDS,
  STAFF_REFRESH_TTL_MS
} from "../src/core/staffAuthService.js";

import {
  hashStaffPassword,
  createRefreshToken
} from "../src/core/staffAuthCrypto.js";

import {
  verifyJWT
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

const PASSWORD =
  "Staff-Test-Password-123!";

const FIXED_NOW =
  1700000000000;

const TEST_ITERATIONS =
  100000;


// ========================================
// PASSWORD VERIFIER
// ========================================

const TEST_VERIFIER =
  await hashStaffPassword(
    PASSWORD,
    {
      iterations:
        TEST_ITERATIONS
    }
  );


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

    process.exitCode = 1;
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
// ACCOUNT ROW
// ========================================

function accountRow(
  overrides = {}
) {

  return {
    id:
      "staff-1",

    login:
      "driver1",

    display_name:
      "Driver One",

    role:
      "driver",

    status:
      "active",

    password_algorithm:
      TEST_VERIFIER
        .passwordAlgorithm,

    password_iterations:
      TEST_VERIFIER
        .passwordIterations,

    password_salt:
      TEST_VERIFIER
        .passwordSalt,

    password_hash:
      TEST_VERIFIER
        .passwordHash,

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
      "session-1",

    account_id:
      "staff-1",

    family_id:
      "family-1",

    refresh_token_hash:
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",

    created_at:
      FIXED_NOW - 1000,

    expires_at:
      FIXED_NOW +
      STAFF_REFRESH_TTL_MS,

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


  const runResults =
    Array.isArray(
      options.runResults
    )
      ? [
          ...options.runResults
        ]
      : [];


  const defaultRunResult =
    options.runResult ?? {
      success:
        true,

      meta: {
        changes:
          1
      }
    };


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


          return firstResults.shift();
        },


        async run() {

          if (
            options.runError
          ) {

            throw options.runError;
          }


          if (
            runResults.length >
              0
          ) {

            return runResults.shift();
          }


          return defaultRunResult;
        }
      };


      return statement;
    },


    async batch(
      statements
    ) {

      batchCalls.push(
        statements.map(
          item =>
            item.__call
        )
      );


      if (
        options.batchError
      ) {

        throw options.batchError;
      }


      return options.batchResults ?? [
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
      ];
    }
  };


  return {
    db,
    calls,
    batchCalls
  };
}


// ========================================
// LOGIN SUCCESS
// ========================================

await test(
  "active staff account can login",
  async () => {

    await withNow(
      FIXED_NOW,
      async () => {

        const {
          db,
          calls
        } =
          createFakeDatabase(
            {
              firstResults: [
                accountRow(),

                accountRow(
                  {
                    last_login_at:
                      FIXED_NOW,

                    updated_at:
                      FIXED_NOW
                  }
                ),

                sessionRow()
              ]
            }
          );


        const result =
          await loginStaff(
            {
              DB:
                db,

              JWT_SECRET
            },
            {
              login:
                " DRIVER1 ",

              password:
                PASSWORD
            }
          );


        assert.equal(
          result.ok,
          true
        );


        assert.deepEqual(
          result.staff,
          {
            id:
              "staff-1",

            displayName:
              "Driver One",

            role:
              "driver"
          }
        );


        assert.equal(
          typeof result.accessToken,
          "string"
        );


        assert.match(
          result.refreshToken,
          /^tsr1\./
        );


        assert.equal(
          result.accessExpiresAt,
          FIXED_NOW +
            STAFF_ACCESS_TTL_SECONDS *
            1000
        );


        assert.equal(
          result.refreshExpiresAt,
          FIXED_NOW +
            STAFF_REFRESH_TTL_MS
        );


        const payload =
          await verifyJWT(
            JWT_SECRET,
            result.accessToken
          );


        assert.equal(
          payload.sub,
          "staff-1"
        );


        assert.equal(
          payload.id,
          "staff-1"
        );


        assert.equal(
          payload.role,
          "driver"
        );


        assert.equal(
          payload.scope,
          "staff"
        );


        assert.equal(
          payload.tokenVersion,
          1
        );


        assert.match(
          payload.sid,
          /^staff-session_/
        );


        const insertSession =
          calls.find(
            call =>
              /INSERT INTO staff_sessions/i
                .test(
                  call.sql
                )
          );


        assert.ok(
          insertSession
        );


        assert.equal(
          insertSession.args.some(
            value =>
              String(
                value
              ) ===
              result.refreshToken
          ),
          false
        );
      }
    );
  }
);


// ========================================
// WRONG PASSWORD
// ========================================

await test(
  "wrong password is rejected and recorded",
  async () => {

    await withNow(
      FIXED_NOW,
      async () => {

        const {
          db,
          calls
        } =
          createFakeDatabase(
            {
              firstResults: [
                accountRow(),

                accountRow(
                  {
                    failed_login_count:
                      1,

                    last_failed_login_at:
                      FIXED_NOW,

                    updated_at:
                      FIXED_NOW
                  }
                )
              ]
            }
          );


        const result =
          await loginStaff(
            {
              DB:
                db,

              JWT_SECRET
            },
            {
              login:
                "driver1",

              password:
                "Wrong-Password!"
            }
          );


        assert.deepEqual(
          result,
          {
            ok:
              false,

            status:
              401,

            error:
              "invalid credentials"
          }
        );


        assert.ok(
          calls.some(
            call =>
              /failed_login_count/i
                .test(
                  call.sql
                )
          )
        );


        assert.equal(
          calls.some(
            call =>
              /INSERT INTO staff_sessions/i
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
// UNKNOWN LOGIN
// ========================================

await test(
  "unknown login returns generic credentials error",
  async () => {

    const {
      db
    } =
      createFakeDatabase(
        {
          firstResults: [
            null
          ]
        }
      );


    const result =
      await loginStaff(
        {
          DB:
            db,

          JWT_SECRET
        },
        {
          login:
            "unknown-user",

          password:
            PASSWORD
        }
      );


    assert.deepEqual(
      result,
      {
        ok:
          false,

        status:
          401,

        error:
          "invalid credentials"
      }
    );
  }
);


// ========================================
// LOCKED ACCOUNT
// ========================================

await test(
  "locked account cannot login",
  async () => {

    await withNow(
      FIXED_NOW,
      async () => {

        const {
          db,
          calls
        } =
          createFakeDatabase(
            {
              firstResults: [
                accountRow(
                  {
                    locked_until:
                      FIXED_NOW +
                      60000
                  }
                )
              ]
            }
          );


        const result =
          await loginStaff(
            {
              DB:
                db,

              JWT_SECRET
            },
            {
              login:
                "driver1",

              password:
                PASSWORD
            }
          );


        assert.equal(
          result.ok,
          false
        );


        assert.equal(
          result.status,
          401
        );


        assert.equal(
          calls.some(
            call =>
              /INSERT INTO staff_sessions/i
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
// INACTIVE ACCOUNT
// ========================================

await test(
  "inactive account cannot login",
  async () => {

    const {
      db
    } =
      createFakeDatabase(
        {
          firstResults: [
            accountRow(
              {
                status:
                  "disabled"
              }
            )
          ]
        }
      );


    const result =
      await loginStaff(
        {
          DB:
            db,

          JWT_SECRET
        },
        {
          login:
            "driver1",

          password:
            PASSWORD
        }
      );


    assert.equal(
      result.ok,
      false
    );


    assert.equal(
      result.status,
      401
    );
  }
);


// ========================================
// INVALID INPUT
// ========================================

await test(
  "malformed login request is rejected",
  async () => {

    const {
      db,
      calls
    } =
      createFakeDatabase();


    const result =
      await loginStaff(
        {
          DB:
            db,

          JWT_SECRET
        },
        {
          login:
            "??",

          password:
            ""
        }
      );


    assert.deepEqual(
      result,
      {
        ok:
          false,

        status:
          400,

        error:
          "invalid request"
      }
    );


    assert.equal(
      calls.length,
      0
    );
  }
);


// ========================================
// REFRESH SUCCESS
// ========================================

await test(
  "active refresh token rotates and issues new access token",
  async () => {

    await withNow(
      FIXED_NOW,
      async () => {

        const originalRefresh =
          await createRefreshToken();


        const {
          db,
          batchCalls
        } =
          createFakeDatabase(
            {
              firstResults: [
                sessionRow(
                  {
                    refresh_token_hash:
                      originalRefresh
                        .refreshTokenHash
                  }
                ),

                accountRow(),

                sessionRow(
                  {
                    id:
                      "replacement-session"
                  }
                )
              ]
            }
          );


        const result =
          await refreshStaff(
            {
              DB:
                db,

              JWT_SECRET
            },
            originalRefresh
              .refreshToken
          );


        assert.equal(
          result.ok,
          true
        );


        assert.notEqual(
          result.refreshToken,
          originalRefresh
            .refreshToken
        );


        assert.equal(
          batchCalls.length,
          1
        );


        const payload =
          await verifyJWT(
            JWT_SECRET,
            result.accessToken
          );


        assert.equal(
          payload.id,
          "staff-1"
        );


        assert.equal(
          payload.scope,
          "staff"
        );


        assert.match(
          payload.sid,
          /^staff-session_/
        );
      }
    );
  }
);


// ========================================
// REFRESH REPLAY
// ========================================

await test(
  "reuse of revoked refresh token revokes its family",
  async () => {

    await withNow(
      FIXED_NOW,
      async () => {

        const oldRefresh =
          await createRefreshToken();


        const {
          db,
          calls
        } =
          createFakeDatabase(
            {
              firstResults: [
                sessionRow(
                  {
                    refresh_token_hash:
                      oldRefresh
                        .refreshTokenHash,

                    revoked_at:
                      FIXED_NOW -
                      1000,

                    replaced_by_session_id:
                      "session-2"
                  }
                )
              ],

              runResult: {
                success:
                  true,

                meta: {
                  changes:
                    1
                }
              }
            }
          );


        const result =
          await refreshStaff(
            {
              DB:
                db,

              JWT_SECRET
            },
            oldRefresh
              .refreshToken
          );


        assert.deepEqual(
          result,
          {
            ok:
              false,

            status:
              401,

            error:
              "invalid refresh token"
          }
        );


        assert.ok(
          calls.some(
            call =>
              /WHERE family_id = \?1/i
                .test(
                  call.sql
                )
          )
        );
      }
    );
  }
);


// ========================================
// UNKNOWN REFRESH
// ========================================

await test(
  "unknown refresh token is rejected",
  async () => {

    const token =
      await createRefreshToken();


    const {
      db
    } =
      createFakeDatabase(
        {
          firstResults: [
            null
          ]
        }
      );


    const result =
      await refreshStaff(
        {
          DB:
            db,

          JWT_SECRET
        },
        token.refreshToken
      );


    assert.deepEqual(
      result,
      {
        ok:
          false,

        status:
          401,

        error:
          "invalid refresh token"
      }
    );
  }
);


// ========================================
// LOGOUT
// ========================================

await test(
  "logout revokes refresh session",
  async () => {

    await withNow(
      FIXED_NOW,
      async () => {

        const token =
          await createRefreshToken();


        const {
          db,
          calls
        } =
          createFakeDatabase(
            {
              firstResults: [
                sessionRow(
                  {
                    refresh_token_hash:
                      token
                        .refreshTokenHash,

                    revoked_at:
                      FIXED_NOW
                  }
                )
              ]
            }
          );


        const result =
          await logoutStaff(
            {
              DB:
                db
            },
            token.refreshToken
          );


        assert.deepEqual(
          result,
          {
            ok:
              true
          }
        );


        assert.ok(
          calls.some(
            call =>
              /UPDATE staff_sessions/i
                .test(
                  call.sql
                )
          )
        );
      }
    );
  }
);


// ========================================
// IDEMPOTENT LOGOUT
// ========================================

await test(
  "malformed refresh token logout remains idempotent",
  async () => {

    const {
      db,
      calls
    } =
      createFakeDatabase();


    const result =
      await logoutStaff(
        {
          DB:
            db
        },
        "not-a-token"
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
      0
    );
  }
);


console.log("");


if (
  !process.exitCode
) {

  console.log(
    "✓ ALL STAFF AUTH SERVICE TESTS PASSED"
  );
}