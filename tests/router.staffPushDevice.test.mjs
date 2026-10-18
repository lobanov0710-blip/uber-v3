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
// D1 ROWS
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
      "pbkdf2-sha256",

    password_iterations:
      100000,

    password_salt:
      "AAAAAAAAAAAAAAAAAAAAAA",

    password_hash:
      "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",

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
      FIXED_NOW + 86400000,

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
            runResults.length >
              0
          ) {

            return runResults.shift();
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
// ACCESS TOKEN
// ========================================

async function accessToken() {

  return signJWT(
    JWT_SECRET,
    {
      sub:
        "staff-1",

      id:
        "staff-1",

      role:
        "driver",

      scope:
        "staff",

      tokenVersion:
        1,

      sid:
        "session-1"
    },
    900
  );
}


// ========================================
// REQUEST
// ========================================

function request(
  method,
  token,
  body = null
) {

  const headers = {
    Authorization:
      `Bearer ${token}`
  };


  if (
    body !== null
  ) {

    headers["Content-Type"] =
      "application/json";
  }


  return new Request(
    "https://worker.test/staff/push-device",
    {
      method,
      headers,

      body:
        body === null
          ? undefined
          : JSON.stringify(
              body
            )
    }
  );
}


// ========================================
// METHOD GUARD
// ========================================

await test(
  "staff push device rejects unsupported method",
  async () => {

    const response =
      await router(
        new Request(
          "https://worker.test/staff/push-device"
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
// AUTH REQUIRED
// ========================================

await test(
  "staff push device requires staff authentication",
  async () => {

    const response =
      await router(
        new Request(
          "https://worker.test/staff/push-device",
          {
            method:
              "PUT"
          }
        ),
        {
          JWT_SECRET
        }
      );


    assert.equal(
      response.status,
      401
    );
  }
);


// ========================================
// REGISTER
// ========================================

await test(
  "authenticated staff can register push device",
  async () => {

    await withNow(
      FIXED_NOW,
      async () => {

        const token =
          await accessToken();


        const {
          db,
          calls
        } =
          createFakeDatabase(
            {
              firstResults: [
                accountRow(),
                sessionRow()
              ]
            }
          );


        const response =
          await router(
            request(
              "PUT",
              token,
              {
                installationId:
                  INSTALLATION_ID,

                platform:
                  "android",

                token:
                  FCM_TOKEN
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


        assert.deepEqual(
          body,
          {
            ok:
              true
          }
        );


        const upsert =
          calls.find(
            call =>
              /INSERT INTO staff_push_devices/i
                .test(
                  call.sql
                )
          );


        assert.ok(
          upsert
        );


        assert.deepEqual(
          upsert.args,
          [
            INSTALLATION_ID,
            "staff-1",
            "family-1",
            "android",
            FCM_TOKEN,
            FIXED_NOW
          ]
        );


        assert.equal(
          JSON.stringify(
            body
          )
            .includes(
              FCM_TOKEN
            ),
          false
        );
      }
    );
  }
);


// ========================================
// INVALID BODY
// ========================================

await test(
  "authenticated staff receives 400 for invalid push device body",
  async () => {

    await withNow(
      FIXED_NOW,
      async () => {

        const token =
          await accessToken();


        const {
          db,
          calls
        } =
          createFakeDatabase(
            {
              firstResults: [
                accountRow(),
                sessionRow()
              ]
            }
          );


        const response =
          await router(
            request(
              "PUT",
              token,
              {
                installationId:
                  "invalid",

                platform:
                  "android",

                token:
                  FCM_TOKEN
              }
            ),
            {
              DB:
                db,

              JWT_SECRET
            }
          );


        assert.equal(
          response.status,
          400
        );


        assert.equal(
          calls.some(
            call =>
              /INSERT INTO staff_push_devices/i
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
// DELETE
// ========================================

await test(
  "authenticated staff can idempotently unregister own installation",
  async () => {

    await withNow(
      FIXED_NOW,
      async () => {

        const token =
          await accessToken();


        const {
          db,
          calls
        } =
          createFakeDatabase(
            {
              firstResults: [
                accountRow(),
                sessionRow()
              ],

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


        const response =
          await router(
            request(
              "DELETE",
              token,
              {
                installationId:
                  INSTALLATION_ID
              }
            ),
            {
              DB:
                db,

              JWT_SECRET
            }
          );


        assert.equal(
          response.status,
          200
        );


        const deletion =
          calls.find(
            call =>
              /DELETE FROM staff_push_devices/i
                .test(
                  call.sql
                )
          );


        assert.ok(
          deletion
        );


        assert.deepEqual(
          deletion.args,
          [
            INSTALLATION_ID,
            "staff-1"
          ]
        );
      }
    );
  }
);


// ========================================
// REVOKED SESSION
// ========================================

await test(
  "revoked staff session cannot register push device",
  async () => {

    await withNow(
      FIXED_NOW,
      async () => {

        const token =
          await accessToken();


        const {
          db,
          calls
        } =
          createFakeDatabase(
            {
              firstResults: [
                accountRow(),
                sessionRow(
                  {
                    revoked_at:
                      FIXED_NOW - 1
                  }
                )
              ]
            }
          );


        const response =
          await router(
            request(
              "PUT",
              token,
              {
                installationId:
                  INSTALLATION_ID,

                platform:
                  "android",

                token:
                  FCM_TOKEN
              }
            ),
            {
              DB:
                db,

              JWT_SECRET
            }
          );


        assert.equal(
          response.status,
          401
        );


        assert.equal(
          calls.some(
            call =>
              /INSERT INTO staff_push_devices/i
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
