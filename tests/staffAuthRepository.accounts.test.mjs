import assert from "node:assert/strict";

import {
  STAFF_PASSWORD_ITERATIONS
} from "../src/core/staffAuthCrypto.js";

import {
  STAFF_LOGIN_LOCK_THRESHOLD,
  STAFF_LOGIN_LOCK_DURATION_MS,
  getStaffAccountById,
  getStaffAccountByLogin,
  insertStaffAccount,
  recordStaffLoginFailure,
  recordStaffLoginSuccess,
  incrementStaffTokenVersion
} from "../src/core/staffAuthRepository.js";


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
      STAFF_PASSWORD_ITERATIONS,

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
// ACCOUNT DOMAIN
// ========================================

function accountEntity(
  overrides = {}
) {

  return {
    id:
      "staff-1",

    login:
      " Driver1 ",

    displayName:
      "Driver One",

    role:
      "driver",

    status:
      "active",

    passwordVerifier: {

      passwordAlgorithm:
        "pbkdf2-sha256",

      passwordIterations:
        STAFF_PASSWORD_ITERATIONS,

      passwordSalt:
        "aaaaaaaaaaaaaaaaaaaaaa",

      passwordHash:
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    },

    tokenVersion:
      1,

    passwordChangedAt:
      1000,

    createdAt:
      1000,

    updatedAt:
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
    }
  };


  return {
    db,
    calls
  };
}


// ========================================
// PASSWORD POLICY
// ========================================

await test(
  "staff account repository uses current production password work factor",
  async () => {

    assert.equal(
      STAFF_PASSWORD_ITERATIONS,
      100000
    );
  }
);


// ========================================
// READ BY ID
// ========================================

await test(
  "staff account is read by id",
  async () => {

    const {
      db,
      calls
    } =
      createFakeDatabase(
        {
          firstResults: [
            accountRow()
          ]
        }
      );


    const account =
      await getStaffAccountById(
        {
          DB:
            db
        },
        "staff-1"
      );


    assert.equal(
      account.id,
      "staff-1"
    );


    assert.equal(
      account.login,
      "driver1"
    );


    assert.equal(
      account.role,
      "driver"
    );


    assert.equal(
      account.status,
      "active"
    );


    assert.equal(
      account.passwordVerifier
        .passwordIterations,
      STAFF_PASSWORD_ITERATIONS
    );


    assert.equal(
      account.passwordVerifier
        .passwordIterations,
      100000
    );


    assert.equal(
      account.tokenVersion,
      1
    );


    assert.match(
      calls[0].sql,
      /WHERE id = \?1/i
    );


    assert.deepEqual(
      calls[0].args,
      [
        "staff-1"
      ]
    );
  }
);


// ========================================
// READ BY LOGIN
// ========================================

await test(
  "staff login lookup is normalized",
  async () => {

    const {
      db,
      calls
    } =
      createFakeDatabase(
        {
          firstResults: [
            accountRow()
          ]
        }
      );


    const account =
      await getStaffAccountByLogin(
        {
          DB:
            db
        },
        " DRIVER1 "
      );


    assert.equal(
      account.id,
      "staff-1"
    );


    assert.match(
      calls[0].sql,
      /WHERE login = \?1/i
    );


    assert.deepEqual(
      calls[0].args,
      [
        "driver1"
      ]
    );
  }
);


// ========================================
// CREATE ACCOUNT
// ========================================

await test(
  "staff account insert stores verifier but no plaintext password",
  async () => {

    const {
      db,
      calls
    } =
      createFakeDatabase(
        {
          firstResults: [
            accountRow()
          ]
        }
      );


    const result =
      await insertStaffAccount(
        {
          DB:
            db
        },
        accountEntity()
      );


    assert.equal(
      result.id,
      "staff-1"
    );


    assert.equal(
      result.login,
      "driver1"
    );


    assert.match(
      calls[0].sql,
      /INSERT INTO staff_accounts/i
    );


    assert.match(
      calls[0].sql,
      /password_hash/i
    );


    assert.doesNotMatch(
      calls[0].sql,
      /\bpassword\b(?!_)/i
    );


    assert.deepEqual(
      calls[0].args,
      [
        "staff-1",
        "driver1",
        "Driver One",
        "driver",
        "active",
        "pbkdf2-sha256",
        STAFF_PASSWORD_ITERATIONS,
        "aaaaaaaaaaaaaaaaaaaaaa",
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        1,
        1000,
        1000,
        1000
      ]
    );


    assert.match(
      calls[1].sql,
      /WHERE id = \?1/i
    );
  }
);


await test(
  "staff account insert rejects unsupported password work factor",
  async () => {

    const {
      db,
      calls
    } =
      createFakeDatabase();


    const account =
      accountEntity();


    account.passwordVerifier = {
      ...account.passwordVerifier,

      passwordIterations:
        600000
    };


    await assert.rejects(
      () =>
        insertStaffAccount(
          {
            DB:
              db
          },
          account
        ),

      /Invalid staff passwordIterations/
    );


    assert.equal(
      calls.length,
      0
    );
  }
);


await test(
  "staff account insert rejects password work factor below production policy",
  async () => {

    const {
      db,
      calls
    } =
      createFakeDatabase();


    const account =
      accountEntity();


    account.passwordVerifier = {
      ...account.passwordVerifier,

      passwordIterations:
        99999
    };


    await assert.rejects(
      () =>
        insertStaffAccount(
          {
            DB:
              db
          },
          account
        ),

      /Invalid staff passwordIterations/
    );


    assert.equal(
      calls.length,
      0
    );
  }
);


// ========================================
// FAILED LOGIN
// ========================================

await test(
  "failed login is recorded atomically",
  async () => {

    const failedAt =
      2000;


    const {
      db,
      calls
    } =
      createFakeDatabase(
        {
          firstResults: [
            accountRow(
              {
                failed_login_count:
                  1,

                last_failed_login_at:
                  failedAt,

                updated_at:
                  failedAt
              }
            )
          ]
        }
      );


    const result =
      await recordStaffLoginFailure(
        {
          DB:
            db
        },
        "staff-1",
        {
          failedAt
        }
      );


    assert.equal(
      result.failedLoginCount,
      1
    );


    assert.match(
      calls[0].sql,
      /failed_login_count\s*=/i
    );


    assert.match(
      calls[0].sql,
      /locked_until\s*=/i
    );


    assert.match(
      calls[0].sql,
      /failed_login_count \+ 1/i
    );


    assert.deepEqual(
      calls[0].args,
      [
        "staff-1",
        failedAt,
        STAFF_LOGIN_LOCK_THRESHOLD,
        failedAt +
          STAFF_LOGIN_LOCK_DURATION_MS
      ]
    );
  }
);


// ========================================
// EXPIRED LOCK
// ========================================

await test(
  "expired login lock starts a fresh failure counter",
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
                failed_login_count:
                  1,

                locked_until:
                  null,

                last_failed_login_at:
                  5000,

                updated_at:
                  5000
              }
            )
          ]
        }
      );


    await recordStaffLoginFailure(
      {
        DB:
          db
      },
      "staff-1",
      {
        failedAt:
          5000,

        lockThreshold:
          5,

        lockDurationMs:
          10000
      }
    );


    assert.match(
      calls[0].sql,
      /locked_until <= \?2/i
    );


    assert.deepEqual(
      calls[0].args,
      [
        "staff-1",
        5000,
        5,
        15000
      ]
    );
  }
);


// ========================================
// SUCCESSFUL LOGIN
// ========================================

await test(
  "successful login clears temporary lock and failure count",
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
                failed_login_count:
                  0,

                locked_until:
                  null,

                last_failed_login_at:
                  1500,

                last_login_at:
                  3000,

                updated_at:
                  3000
              }
            )
          ]
        }
      );


    const result =
      await recordStaffLoginSuccess(
        {
          DB:
            db
        },
        "staff-1",
        3000
      );


    assert.equal(
      result.failedLoginCount,
      0
    );


    assert.equal(
      result.lockedUntil,
      null
    );


    assert.equal(
      result.lastLoginAt,
      3000
    );


    // Historical failed-login timestamp
    // is intentionally retained.
    assert.equal(
      result.lastFailedLoginAt,
      1500
    );


    assert.match(
      calls[0].sql,
      /failed_login_count = 0/i
    );


    assert.match(
      calls[0].sql,
      /locked_until = NULL/i
    );


    assert.deepEqual(
      calls[0].args,
      [
        "staff-1",
        3000
      ]
    );
  }
);


// ========================================
// TOKEN VERSION
// ========================================

await test(
  "staff token version is incremented atomically",
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
                token_version:
                  2,

                updated_at:
                  4000
              }
            )
          ]
        }
      );


    const result =
      await incrementStaffTokenVersion(
        {
          DB:
            db
        },
        "staff-1",
        4000
      );


    assert.equal(
      result.tokenVersion,
      2
    );


    assert.match(
      calls[0].sql,
      /token_version\s*=\s*token_version \+ 1/i
    );


    assert.deepEqual(
      calls[0].args,
      [
        "staff-1",
        4000
      ]
    );
  }
);


// ========================================
// MISSING ACCOUNT
// ========================================

await test(
  "account update returns null when account does not exist",
  async () => {

    const {
      db
    } =
      createFakeDatabase(
        {
          runResult: {
            success:
              true,

            meta: {
              changes:
                0
            }
          },

          firstResults: [
            null
          ]
        }
      );


    const result =
      await recordStaffLoginSuccess(
        {
          DB:
            db
        },
        "missing-account",
        3000
      );


    assert.equal(
      result,
      null
    );
  }
);


// ========================================
// UPDATE FAILURE
// ========================================

await test(
  "invalid D1 account update result is rejected",
  async () => {

    const {
      db
    } =
      createFakeDatabase(
        {
          runResult: {
            success:
              true
          }
        }
      );


    await assert.rejects(
      () =>
        incrementStaffTokenVersion(
          {
            DB:
              db
          },
          "staff-1",
          4000
        ),

      /Invalid staff D1 operation result/
    );
  }
);


// ========================================
// VALIDATION
// ========================================

await test(
  "staff account rejects unauthorized role",
  async () => {

    const {
      db,
      calls
    } =
      createFakeDatabase();


    await assert.rejects(
      () =>
        insertStaffAccount(
          {
            DB:
              db
          },
          accountEntity(
            {
              role:
                "passenger"
            }
          )
        ),

      /Invalid staff role/
    );


    assert.equal(
      calls.length,
      0
    );
  }
);


await test(
  "staff account repository requires D1",
  async () => {

    await assert.rejects(
      () =>
        insertStaffAccount(
          {},
          accountEntity()
        ),

      /D1 DB binding is not configured/
    );
  }
);


console.log("");


if (
  !process.exitCode
) {

  console.log(
    "✓ ALL STAFF ACCOUNT REPOSITORY TESTS PASSED"
  );
}