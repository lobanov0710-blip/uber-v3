import assert from "node:assert/strict";

import {
  getStaffSessionById,
  getStaffSessionByRefreshTokenHash,
  insertStaffSession,
  rotateStaffSession,
  revokeStaffSession,
  revokeStaffSessionFamily,
  revokeStaffSessionsForAccount
} from "../src/core/staffAuthRepository.js";


// ========================================
// HASHES
// ========================================

const HASH_A =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const HASH_B =
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";


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
      HASH_A,

    created_at:
      1000,

    expires_at:
      100000,

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
// SESSION ENTITY
// ========================================

function sessionEntity(
  overrides = {}
) {

  return {
    id:
      "session-1",

    accountId:
      "staff-1",

    familyId:
      "family-1",

    refreshTokenHash:
      HASH_A,

    createdAt:
      1000,

    expiresAt:
      100000,

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


      if (
        options.batchResults
      ) {

        return options.batchResults;
      }


      return [
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
// READ BY ID
// ========================================

await test(
  "staff session is read by id",
  async () => {

    const {
      db,
      calls
    } =
      createFakeDatabase(
        {
          firstResults: [
            sessionRow()
          ]
        }
      );


    const session =
      await getStaffSessionById(
        {
          DB:
            db
        },
        "session-1"
      );


    assert.equal(
      session.id,
      "session-1"
    );


    assert.equal(
      session.accountId,
      "staff-1"
    );


    assert.equal(
      session.familyId,
      "family-1"
    );


    assert.equal(
      session.refreshTokenHash,
      HASH_A
    );


    assert.match(
      calls[0].sql,
      /WHERE id = \?1/i
    );
  }
);


// ========================================
// READ BY HASH
// ========================================

await test(
  "staff session lookup uses refresh-token hash",
  async () => {

    const {
      db,
      calls
    } =
      createFakeDatabase(
        {
          firstResults: [
            sessionRow()
          ]
        }
      );


    const session =
      await getStaffSessionByRefreshTokenHash(
        {
          DB:
            db
        },
        HASH_A
      );


    assert.equal(
      session.id,
      "session-1"
    );


    assert.match(
      calls[0].sql,
      /WHERE refresh_token_hash = \?1/i
    );


    assert.deepEqual(
      calls[0].args,
      [
        HASH_A
      ]
    );
  }
);


// ========================================
// INSERT
// ========================================

await test(
  "staff session stores refresh hash but no plaintext token",
  async () => {

    const {
      db,
      calls
    } =
      createFakeDatabase(
        {
          firstResults: [
            sessionRow()
          ]
        }
      );


    const session =
      await insertStaffSession(
        {
          DB:
            db
        },
        sessionEntity()
      );


    assert.equal(
      session.id,
      "session-1"
    );


    assert.match(
      calls[0].sql,
      /INSERT INTO staff_sessions/i
    );


    assert.match(
      calls[0].sql,
      /refresh_token_hash/i
    );


    assert.deepEqual(
      calls[0].args,
      [
        "session-1",
        "staff-1",
        "family-1",
        HASH_A,
        1000,
        100000
      ]
    );


    assert.equal(
      calls[0].args.some(
        value =>
          String(
            value
          ).startsWith(
            "tsr1."
          )
      ),
      false
    );
  }
);


// ========================================
// ROTATION SUCCESS
// ========================================

await test(
  "refresh session rotation is atomic",
  async () => {

    const replacement =
      sessionRow(
        {
          id:
            "session-2",

          refresh_token_hash:
            HASH_B,

          created_at:
            5000,

          expires_at:
            200000
        }
      );


    const {
      db,
      batchCalls
    } =
      createFakeDatabase(
        {
          firstResults: [
            replacement
          ]
        }
      );


    const result =
      await rotateStaffSession(
        {
          DB:
            db
        },
        HASH_A,
        {
          id:
            "session-2",

          refreshTokenHash:
            HASH_B,

          expiresAt:
            200000
        },
        5000
      );


    assert.equal(
      result.ok,
      true
    );


    assert.equal(
      result.session.id,
      "session-2"
    );


    assert.equal(
      batchCalls.length,
      1
    );


    assert.equal(
      batchCalls[0].length,
      2
    );


    const insert =
      batchCalls[0][0];


    const revoke =
      batchCalls[0][1];


    assert.match(
      insert.sql,
      /INSERT INTO staff_sessions/i
    );


    assert.match(
      insert.sql,
      /SELECT/i
    );


    assert.match(
      insert.sql,
      /current\.account_id/i
    );


    assert.match(
      insert.sql,
      /current\.family_id/i
    );


    assert.match(
      insert.sql,
      /current\.revoked_at IS NULL/i
    );


    assert.match(
      insert.sql,
      /current\.expires_at > \?3/i
    );


    assert.deepEqual(
      insert.args,
      [
        "session-2",
        HASH_B,
        5000,
        200000,
        HASH_A
      ]
    );


    assert.match(
      revoke.sql,
      /UPDATE staff_sessions/i
    );


    assert.match(
      revoke.sql,
      /replaced_by_session_id = \?1/i
    );


    assert.match(
      revoke.sql,
      /EXISTS/i
    );
  }
);


// ========================================
// ROTATION REPLAY
// ========================================

await test(
  "rotated refresh token is reported as revoked",
  async () => {

    const {
      db
    } =
      createFakeDatabase(
        {
          batchResults: [
            {
              success:
                true,

              meta: {
                changes:
                  0
              }
            },

            {
              success:
                true,

              meta: {
                changes:
                  0
              }
            }
          ],

          firstResults: [
            sessionRow(
              {
                revoked_at:
                  5000,

                replaced_by_session_id:
                  "session-2"
              }
            )
          ]
        }
      );


    const result =
      await rotateStaffSession(
        {
          DB:
            db
        },
        HASH_A,
        {
          id:
            "session-3",

          refreshTokenHash:
            HASH_B,

          expiresAt:
            200000
        },
        6000
      );


    assert.equal(
      result.ok,
      false
    );


    assert.equal(
      result.reason,
      "revoked"
    );


    assert.equal(
      result.session.familyId,
      "family-1"
    );
  }
);


// ========================================
// ROTATION EXPIRED
// ========================================

await test(
  "expired refresh session cannot rotate",
  async () => {

    const {
      db
    } =
      createFakeDatabase(
        {
          batchResults: [
            {
              success:
                true,

              meta: {
                changes:
                  0
              }
            },

            {
              success:
                true,

              meta: {
                changes:
                  0
              }
            }
          ],

          firstResults: [
            sessionRow(
              {
                expires_at:
                  4000
              }
            )
          ]
        }
      );


    const result =
      await rotateStaffSession(
        {
          DB:
            db
        },
        HASH_A,
        {
          id:
            "session-2",

          refreshTokenHash:
            HASH_B,

          expiresAt:
            200000
        },
        5000
      );


    assert.equal(
      result.ok,
      false
    );


    assert.equal(
      result.reason,
      "expired"
    );
  }
);


// ========================================
// ROTATION MISSING
// ========================================

await test(
  "unknown refresh session cannot rotate",
  async () => {

    const {
      db
    } =
      createFakeDatabase(
        {
          batchResults: [
            {
              success:
                true,

              meta: {
                changes:
                  0
              }
            },

            {
              success:
                true,

              meta: {
                changes:
                  0
              }
            }
          ],

          firstResults: [
            null
          ]
        }
      );


    const result =
      await rotateStaffSession(
        {
          DB:
            db
        },
        HASH_A,
        {
          id:
            "session-2",

          refreshTokenHash:
            HASH_B,

          expiresAt:
            200000
        },
        5000
      );


    assert.deepEqual(
      result,
      {
        ok:
          false,

        reason:
          "not_found",

        session:
          null
      }
    );
  }
);


// ========================================
// INCONSISTENT ROTATION
// ========================================

await test(
  "inconsistent D1 rotation result is rejected",
  async () => {

    const {
      db
    } =
      createFakeDatabase(
        {
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
                  0
              }
            }
          ]
        }
      );


    await assert.rejects(
      () =>
        rotateStaffSession(
          {
            DB:
              db
          },
          HASH_A,
          {
            id:
              "session-2",

            refreshTokenHash:
              HASH_B,

            expiresAt:
              200000
          },
          5000
        ),

      /Inconsistent staff session rotation/
    );
  }
);


// ========================================
// LOGOUT / REVOKE ONE
// ========================================

await test(
  "staff session can be revoked",
  async () => {

    const {
      db,
      calls
    } =
      createFakeDatabase(
        {
          firstResults: [
            sessionRow(
              {
                revoked_at:
                  7000
              }
            )
          ]
        }
      );


    const result =
      await revokeStaffSession(
        {
          DB:
            db
        },
        HASH_A,
        7000
      );


    assert.equal(
      result.ok,
      true
    );


    assert.equal(
      result.revoked,
      true
    );


    assert.equal(
      result.session.revokedAt,
      7000
    );


    assert.match(
      calls[0].sql,
      /revoked_at = \?2/i
    );


    assert.deepEqual(
      calls[0].args,
      [
        HASH_A,
        7000
      ]
    );
  }
);


// ========================================
// FAMILY REVOKE
// ========================================

await test(
  "entire refresh-token family can be revoked",
  async () => {

    const {
      db,
      calls
    } =
      createFakeDatabase(
        {
          runResult: {
            success:
              true,

            meta: {
              changes:
                3
            }
          }
        }
      );


    const result =
      await revokeStaffSessionFamily(
        {
          DB:
            db
        },
        "family-1",
        8000
      );


    assert.equal(
      result.ok,
      true
    );


    assert.equal(
      result.revokedCount,
      3
    );


    assert.match(
      calls[0].sql,
      /WHERE family_id = \?1/i
    );


    assert.deepEqual(
      calls[0].args,
      [
        "family-1",
        8000
      ]
    );
  }
);


// ========================================
// ACCOUNT REVOKE
// ========================================

await test(
  "all sessions for an account can be revoked",
  async () => {

    const {
      db,
      calls
    } =
      createFakeDatabase(
        {
          runResult: {
            success:
              true,

            meta: {
              changes:
                4
            }
          }
        }
      );


    const result =
      await revokeStaffSessionsForAccount(
        {
          DB:
            db
        },
        "staff-1",
        9000
      );


    assert.equal(
      result.ok,
      true
    );


    assert.equal(
      result.revokedCount,
      4
    );


    assert.match(
      calls[0].sql,
      /WHERE account_id = \?1/i
    );
  }
);


// ========================================
// VALIDATION
// ========================================

await test(
  "malformed refresh-token hash is rejected",
  async () => {

    const {
      db,
      calls
    } =
      createFakeDatabase();


    await assert.rejects(
      () =>
        getStaffSessionByRefreshTokenHash(
          {
            DB:
              db
          },
          "invalid"
        ),

      /Invalid staff refreshTokenHash/
    );


    assert.equal(
      calls.length,
      0
    );
  }
);


await test(
  "session repository requires D1",
  async () => {

    await assert.rejects(
      () =>
        insertStaffSession(
          {},
          sessionEntity()
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
    "✓ ALL STAFF SESSION REPOSITORY TESTS PASSED"
  );
}