import assert from "node:assert/strict";

import {
  webcrypto
} from "node:crypto";

import {
  signJWT
} from "../src/core/auth.js";

import {
  authenticateStaffRequest
} from "../src/core/staffAuthorization.js";


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
      FIXED_NOW,

    password_changed_at:
      1000,

    created_at:
      1000,

    updated_at:
      FIXED_NOW,

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
      FIXED_NOW + 60000,

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
  firstResults = [],
  {
    firstError = null
  } = {}
) {

  const calls =
    [];


  const queue =
    [
      ...firstResults
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


        async first() {

          if (firstError) {

            throw firstError;
          }


          if (
            queue.length ===
              0
          ) {

            return null;
          }


          return queue.shift();
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
// REQUEST
// ========================================

function requestWithToken(
  token
) {

  const headers =
    new Headers();


  if (token) {

    headers.set(
      "Authorization",
      `Bearer ${token}`
    );
  }


  return {
    headers
  };
}


// ========================================
// STAFF TOKEN
// ========================================

async function createStaffToken(
  overrides = {}
) {

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
        "session-1",

      ...overrides
    },
    900
  );
}


// ========================================
// MISSING TOKEN
// ========================================

await test(
  "staff authorization requires bearer token",
  async () => {

    const {
      db,
      calls
    } =
      createFakeDatabase();


    const result =
      await authenticateStaffRequest(
        requestWithToken(
          null
        ),
        {
          DB:
            db,

          JWT_SECRET
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
          "authorization required"
      }
    );


    assert.equal(
      calls.length,
      0
    );
  }
);


// ========================================
// VALID STAFF TOKEN
// ========================================

await test(
  "valid staff token is authorized against D1",
  async () => {

    await withNow(
      FIXED_NOW,
      async () => {

        const token =
          await createStaffToken();


        const {
          db,
          calls
        } =
          createFakeDatabase([
            accountRow(),
            sessionRow()
          ]);


        const result =
          await authenticateStaffRequest(
            requestWithToken(
              token
            ),
            {
              DB:
                db,

              JWT_SECRET
            }
          );


        assert.equal(
          result.ok,
          true
        );


        assert.equal(
          result.token,
          token
        );


        assert.deepEqual(
          result.user,
          {
            id:
              "staff-1",

            displayName:
              "Driver One",

            role:
              "driver",

            tokenVersion:
              1,

            sessionId:
              "session-1"
          }
        );


        assert.equal(
          calls.length,
          2
        );


        assert.match(
          calls[0].sql,
          /FROM staff_accounts/i
        );


        assert.match(
          calls[1].sql,
          /FROM staff_sessions/i
        );
      }
    );
  }
);


// ========================================
// LEGACY JWT
// ========================================

await test(
  "legacy role-only JWT is rejected",
  async () => {

    await withNow(
      FIXED_NOW,
      async () => {

        const token =
          await signJWT(
            JWT_SECRET,
            {
              id:
                "staff-1",

              role:
                "driver"
            },
            900
          );


        const {
          db,
          calls
        } =
          createFakeDatabase();


        const result =
          await authenticateStaffRequest(
            requestWithToken(
              token
            ),
            {
              DB:
                db,

              JWT_SECRET
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
          result.error,
          "invalid or revoked staff token"
        );


        assert.equal(
          calls.length,
          0
        );
      }
    );
  }
);


// ========================================
// NON-STAFF SCOPE
// ========================================

await test(
  "non-staff scope is rejected before D1",
  async () => {

    await withNow(
      FIXED_NOW,
      async () => {

        const token =
          await createStaffToken({
            scope:
              "passenger"
          });


        const {
          db,
          calls
        } =
          createFakeDatabase();


        const result =
          await authenticateStaffRequest(
            requestWithToken(
              token
            ),
            {
              DB:
                db,

              JWT_SECRET
            }
          );


        assert.equal(
          result.status,
          401
        );


        assert.equal(
          calls.length,
          0
        );
      }
    );
  }
);


// ========================================
// SUBJECT MISMATCH
// ========================================

await test(
  "JWT sub and id must match",
  async () => {

    await withNow(
      FIXED_NOW,
      async () => {

        const token =
          await createStaffToken({
            sub:
              "another-staff"
          });


        const {
          db,
          calls
        } =
          createFakeDatabase();


        const result =
          await authenticateStaffRequest(
            requestWithToken(
              token
            ),
            {
              DB:
                db,

              JWT_SECRET
            }
          );


        assert.equal(
          result.status,
          401
        );


        assert.equal(
          calls.length,
          0
        );
      }
    );
  }
);


// ========================================
// ACCOUNT MISSING
// ========================================

await test(
  "missing staff account invalidates token",
  async () => {

    await withNow(
      FIXED_NOW,
      async () => {

        const token =
          await createStaffToken();


        const {
          db
        } =
          createFakeDatabase([
            null
          ]);


        const result =
          await authenticateStaffRequest(
            requestWithToken(
              token
            ),
            {
              DB:
                db,

              JWT_SECRET
            }
          );


        assert.equal(
          result.status,
          401
        );
      }
    );
  }
);


// ========================================
// ACCOUNT DISABLED
// ========================================

await test(
  "disabled staff account invalidates token",
  async () => {

    await withNow(
      FIXED_NOW,
      async () => {

        const token =
          await createStaffToken();


        const {
          db,
          calls
        } =
          createFakeDatabase([
            accountRow({
              status:
                "disabled"
            })
          ]);


        const result =
          await authenticateStaffRequest(
            requestWithToken(
              token
            ),
            {
              DB:
                db,

              JWT_SECRET
            }
          );


        assert.equal(
          result.status,
          401
        );


        assert.equal(
          calls.length,
          1
        );
      }
    );
  }
);


// ========================================
// ROLE CHANGED
// ========================================

await test(
  "JWT role must match authoritative D1 role",
  async () => {

    await withNow(
      FIXED_NOW,
      async () => {

        const token =
          await createStaffToken();


        const {
          db
        } =
          createFakeDatabase([
            accountRow({
              role:
                "admin"
            })
          ]);


        const result =
          await authenticateStaffRequest(
            requestWithToken(
              token
            ),
            {
              DB:
                db,

              JWT_SECRET
            }
          );


        assert.equal(
          result.status,
          401
        );
      }
    );
  }
);


// ========================================
// TOKEN VERSION
// ========================================

await test(
  "old tokenVersion is rejected",
  async () => {

    await withNow(
      FIXED_NOW,
      async () => {

        const token =
          await createStaffToken({
            tokenVersion:
              1
          });


        const {
          db
        } =
          createFakeDatabase([
            accountRow({
              token_version:
                2
            })
          ]);


        const result =
          await authenticateStaffRequest(
            requestWithToken(
              token
            ),
            {
              DB:
                db,

              JWT_SECRET
            }
          );


        assert.equal(
          result.status,
          401
        );
      }
    );
  }
);


// ========================================
// SESSION MISSING
// ========================================

await test(
  "missing staff session invalidates token",
  async () => {

    await withNow(
      FIXED_NOW,
      async () => {

        const token =
          await createStaffToken();


        const {
          db
        } =
          createFakeDatabase([
            accountRow(),
            null
          ]);


        const result =
          await authenticateStaffRequest(
            requestWithToken(
              token
            ),
            {
              DB:
                db,

              JWT_SECRET
            }
          );


        assert.equal(
          result.status,
          401
        );
      }
    );
  }
);


// ========================================
// SESSION OWNERSHIP
// ========================================

await test(
  "session must belong to JWT account",
  async () => {

    await withNow(
      FIXED_NOW,
      async () => {

        const token =
          await createStaffToken();


        const {
          db
        } =
          createFakeDatabase([
            accountRow(),

            sessionRow({
              account_id:
                "staff-2"
            })
          ]);


        const result =
          await authenticateStaffRequest(
            requestWithToken(
              token
            ),
            {
              DB:
                db,

              JWT_SECRET
            }
          );


        assert.equal(
          result.status,
          401
        );
      }
    );
  }
);


// ========================================
// REVOKED SESSION
// ========================================

await test(
  "revoked staff session invalidates access token",
  async () => {

    await withNow(
      FIXED_NOW,
      async () => {

        const token =
          await createStaffToken();


        const {
          db
        } =
          createFakeDatabase([
            accountRow(),

            sessionRow({
              revoked_at:
                FIXED_NOW - 1
            })
          ]);


        const result =
          await authenticateStaffRequest(
            requestWithToken(
              token
            ),
            {
              DB:
                db,

              JWT_SECRET
            }
          );


        assert.equal(
          result.status,
          401
        );
      }
    );
  }
);


// ========================================
// REPLACED SESSION
// ========================================

await test(
  "rotated staff session invalidates old access token",
  async () => {

    await withNow(
      FIXED_NOW,
      async () => {

        const token =
          await createStaffToken();


        const {
          db
        } =
          createFakeDatabase([
            accountRow(),

            sessionRow({
              replaced_by_session_id:
                "session-2"
            })
          ]);


        const result =
          await authenticateStaffRequest(
            requestWithToken(
              token
            ),
            {
              DB:
                db,

              JWT_SECRET
            }
          );


        assert.equal(
          result.status,
          401
        );
      }
    );
  }
);


// ========================================
// EXPIRED SESSION
// ========================================

await test(
  "expired staff session invalidates access token",
  async () => {

    await withNow(
      FIXED_NOW,
      async () => {

        const token =
          await createStaffToken();


        const {
          db
        } =
          createFakeDatabase([
            accountRow(),

            sessionRow({
              expires_at:
                FIXED_NOW
            })
          ]);


        const result =
          await authenticateStaffRequest(
            requestWithToken(
              token
            ),
            {
              DB:
                db,

              JWT_SECRET
            }
          );


        assert.equal(
          result.status,
          401
        );
      }
    );
  }
);


// ========================================
// INVALID SIGNATURE
// ========================================

await test(
  "invalid JWT signature is rejected before D1",
  async () => {

    const {
      db,
      calls
    } =
      createFakeDatabase();


    const result =
      await authenticateStaffRequest(
        requestWithToken(
          "invalid.token.value"
        ),
        {
          DB:
            db,

          JWT_SECRET
        }
      );


    assert.equal(
      result.status,
      401
    );


    assert.equal(
      calls.length,
      0
    );
  }
);


// ========================================
// D1 FAILURE
// ========================================

await test(
  "D1 failure returns staff authorization failure",
  async () => {

    await withNow(
      FIXED_NOW,
      async () => {

        const token =
          await createStaffToken();


        const {
          db
        } =
          createFakeDatabase(
            [],
            {
              firstError:
                new Error(
                  "D1 unavailable"
                )
            }
          );


        const result =
          await authenticateStaffRequest(
            requestWithToken(
              token
            ),
            {
              DB:
                db,

              JWT_SECRET
            }
          );


        assert.deepEqual(
          result,
          {
            ok:
              false,

            status:
              500,

            error:
              "staff authorization failed"
          }
        );
      }
    );
  }
);


console.log("");


if (
  !process.exitCode
) {

  console.log(
    "✓ ALL STAFF AUTHORIZATION TESTS PASSED"
  );
}