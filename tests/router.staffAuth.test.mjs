import assert from "node:assert/strict";

import {
  webcrypto
} from "node:crypto";

import router
  from "../src/router.js";

import {
  hashStaffPassword,
  createRefreshToken
} from "../src/core/staffAuthCrypto.js";

import {
  verifyJWT
} from "../src/core/auth.js";

import {
  STAFF_REFRESH_TTL_MS
} from "../src/core/staffAuthService.js";


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
  "Staff-Router-Test-123!";

const FIXED_NOW =
  1700000000000;

const TEST_ITERATIONS =
  100000;


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
// JSON BODY
// ========================================

async function jsonBody(
  response
) {

  return JSON.parse(
    await response.text()
  );
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
          statement =>
            statement.__call
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
// REQUEST
// ========================================

function postJson(
  path,
  body
) {

  return new Request(
    `https://worker.test${path}`,
    {
      method:
        "POST",

      headers: {
        "Content-Type":
          "application/json"
      },

      body:
        JSON.stringify(
          body
        )
    }
  );
}


// ========================================
// METHOD GUARDS
// ========================================

await test(
  "staff login rejects GET",
  async () => {

    const response =
      await router(
        new Request(
          "https://worker.test/staff/login"
        ),
        {}
      );


    const body =
      await jsonBody(
        response
      );


    assert.equal(
      response.status,
      405
    );


    assert.equal(
      body.error,
      "method not allowed"
    );
  }
);


await test(
  "staff refresh rejects GET",
  async () => {

    const response =
      await router(
        new Request(
          "https://worker.test/staff/refresh"
        ),
        {}
      );


    assert.equal(
      response.status,
      405
    );
  }
);


await test(
  "staff logout rejects GET",
  async () => {

    const response =
      await router(
        new Request(
          "https://worker.test/staff/logout"
        ),
        {}
      );


    assert.equal(
      response.status,
      405
    );
  }
);


// ========================================
// LOGIN INVALID REQUEST
// ========================================

await test(
  "staff login rejects malformed request",
  async () => {

    const {
      db,
      calls
    } =
      createFakeDatabase();


    const response =
      await router(
        postJson(
          "/staff/login",
          {
            login:
              "??",

            password:
              ""
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
      body.error,
      "invalid request"
    );


    assert.equal(
      calls.length,
      0
    );
  }
);


// ========================================
// LOGIN UNKNOWN USER
// ========================================

await test(
  "unknown staff login returns generic credentials error",
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


    const response =
      await router(
        postJson(
          "/staff/login",
          {
            login:
              "unknown-user",

            password:
              PASSWORD
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
      401
    );


    assert.equal(
      body.error,
      "invalid credentials"
    );
  }
);


// ========================================
// LOGIN SUCCESS
// ========================================

await test(
  "active staff account logs in through router",
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


        const response =
          await router(
            postJson(
              "/staff/login",
              {
                login:
                  " DRIVER1 ",

                password:
                  PASSWORD
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


        assert.deepEqual(
          body.staff,
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
          typeof body.accessToken,
          "string"
        );


        assert.match(
          body.refreshToken,
          /^tsr1\./
        );


        assert.equal(
          "password" in body,
          false
        );


        assert.equal(
          "passwordVerifier" in
            body.staff,
          false
        );


        const payload =
          await verifyJWT(
            JWT_SECRET,
            body.accessToken
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
              value ===
              body.refreshToken
          ),
          false
        );
      }
    );
  }
);


// ========================================
// LOGIN INTERNAL FAILURE
// ========================================

await test(
  "staff login hides internal configuration failure",
  async () => {

    await withNow(
      FIXED_NOW,
      async () => {

        const {
          db
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
                )
              ]
            }
          );


        const response =
          await router(
            postJson(
              "/staff/login",
              {
                login:
                  "driver1",

                password:
                  PASSWORD
              }
            ),
            {
              DB:
                db

              // JWT_SECRET intentionally
              // absent.
            }
          );


        const body =
          await jsonBody(
            response
          );


        assert.equal(
          response.status,
          500
        );


        assert.equal(
          body.error,
          "staff authentication failed"
        );
      }
    );
  }
);


// ========================================
// REFRESH INVALID TOKEN
// ========================================

await test(
  "staff refresh rejects malformed token",
  async () => {

    const {
      db,
      calls
    } =
      createFakeDatabase();


    const response =
      await router(
        postJson(
          "/staff/refresh",
          {
            refreshToken:
              "invalid"
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
      401
    );


    assert.equal(
      body.error,
      "invalid refresh token"
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
  "staff refresh rotates token through router",
  async () => {

    await withNow(
      FIXED_NOW,
      async () => {

        const original =
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
                      original
                        .refreshTokenHash
                  }
                ),

                accountRow(),

                sessionRow(
                  {
                    id:
                      "replacement-session",

                    refresh_token_hash:
                      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",

                    created_at:
                      FIXED_NOW
                  }
                )
              ]
            }
          );


        const response =
          await router(
            postJson(
              "/staff/refresh",
              {
                refreshToken:
                  original
                    .refreshToken
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


        assert.notEqual(
          body.refreshToken,
          original.refreshToken
        );


        assert.equal(
          batchCalls.length,
          1
        );


        const payload =
          await verifyJWT(
            JWT_SECRET,
            body.accessToken
          );


        assert.equal(
          payload.scope,
          "staff"
        );


        assert.equal(
          payload.id,
          "staff-1"
        );
      }
    );
  }
);


// ========================================
// LOGOUT VALID TOKEN
// ========================================

await test(
  "staff logout revokes refresh session",
  async () => {

    await withNow(
      FIXED_NOW,
      async () => {

        const refresh =
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
                      refresh
                        .refreshTokenHash,

                    revoked_at:
                      FIXED_NOW
                  }
                )
              ]
            }
          );


        const response =
          await router(
            postJson(
              "/staff/logout",
              {
                refreshToken:
                  refresh.refreshToken
              }
            ),
            {
              DB:
                db
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


        assert.deepEqual(
          body,
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
  "staff logout does not expose unknown token",
  async () => {

    const {
      db,
      calls
    } =
      createFakeDatabase();


    const response =
      await router(
        postJson(
          "/staff/logout",
          {
            refreshToken:
              "not-a-token"
          }
        ),
        {
          DB:
            db
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


    assert.deepEqual(
      body,
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


// ========================================
// LEGACY AUTH REMAINS DISABLED
// ========================================

await test(
  "legacy driver login remains disabled",
  async () => {

    const response =
      await router(
        postJson(
          "/drivers/login",
          {
            login:
              "driver1",

            password:
              PASSWORD
          }
        ),
        {}
      );


    const body =
      await jsonBody(
        response
      );


    assert.equal(
      response.status,
      404
    );


    assert.equal(
      body.error,
      "not found"
    );
  }
);


console.log("");


if (
  !process.exitCode
) {

  console.log(
    "✓ ALL STAFF AUTH ROUTER TESTS PASSED"
  );
}