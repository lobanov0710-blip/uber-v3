import assert from "node:assert/strict";

import {
  exchangeDriverFirebaseSession
} from "../src/core/driverFirebaseSessionService.js";


const NOW_MS =
  1800000000000;

const VERIFIED = {
  projectId:
    "transfer-servis-test",

  uid:
    "firebase-user-1",

  phoneNumber:
    "+79991234567",

  issuedAt:
    1799999990,

  authTime:
    1799999990,

  expiresAt:
    1800003600
};

const INSTALLATION_ID =
  "2a11acf9-7fec-475a-ac9c-a41e5e6df92a";


function createFakeDb(
  mode =
    "new"
) {

  const replayDigests =
    new Set();


  return {
    prepare(
      sql
    ) {

      const statement = {
        sql,
        args:
          [],

        bind(
          ...args
        ) {

          this.args =
            args;

          return this;
        },

        async first() {

          if (
            /driver_firebase_exchange_replay/i.test(
              this.sql
            )
          ) {

            return replayDigests.has(
              this.args[0]
            )
              ? {
                  token_digest:
                    this.args[0]
                }
              : null;
          }


          return null;
        },

        async all() {

          if (
            !/FROM\s+driver_firebase_identities/i.test(
              this.sql
            )
          ) {

            throw new Error(
              "unexpected fake D1 all query"
            );
          }


          if (
            mode ===
              "new"
          ) {

            return {
              success:
                true,

              results:
                []
            };
          }


          if (
            mode ===
              "blocked"
          ) {

            return {
              success:
                true,

              results: [
                {
                  firebase_uid:
                    VERIFIED.uid,

                  firebase_project_id:
                    VERIFIED.projectId,

                  staff_account_id:
                    "staff_existing123",

                  normalized_phone:
                    VERIFIED.phoneNumber,

                  display_name:
                    "Водитель",

                  role:
                    "driver",

                  account_status:
                    "suspended",

                  token_version:
                    1,

                  registration_status:
                    "approved",

                  identity_status:
                    "verified"
                }
              ]
            };
          }


          if (
            mode ===
              "identity-conflict"
          ) {

            return {
              success:
                true,

              results: [
                {
                  firebase_uid:
                    "another-firebase-user",

                  firebase_project_id:
                    VERIFIED.projectId,

                  staff_account_id:
                    "staff_other123",

                  normalized_phone:
                    VERIFIED.phoneNumber,

                  display_name:
                    "Другой водитель",

                  role:
                    "driver",

                  account_status:
                    "active",

                  token_version:
                    1,

                  registration_status:
                    "approved",

                  identity_status:
                    "verified"
                }
              ]
            };
          }


          throw new Error(
            "unknown fake D1 mode"
          );
        }
      };


      return statement;
    },

    async batch(
      statements
    ) {

      for (
        const statement of statements
      ) {

        if (
          /INSERT\s+INTO\s+driver_firebase_exchange_replay/i.test(
            statement.sql
          )
        ) {

          const digest =
            statement.args[0];


          if (
            replayDigests.has(
              digest
            )
          ) {

            throw new Error(
              "UNIQUE replay"
            );
          }


          replayDigests.add(
            digest
          );
        }
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
}


const verifyFirebaseIdToken =
  async () => ({
    ...VERIFIED
  });

const allowRateLimit =
  async () => ({
    allowed:
      true,

    blockedUntil:
      null
  });

const verifyFirebaseAppCheckToken =
  async () => ({
    projectNumber:
      "1234567890",

    appId:
      "1:1234567890:android:test"
  });


const env = {
  JWT_SECRET:
    "12345678901234567890123456789012",

  FIREBASE_PROJECT_ID:
    VERIFIED.projectId
};


const fakeDb =
  createFakeDb(
    "new"
);


const created =
  await exchangeDriverFirebaseSession(
    {
      ...env,
      DB:
        fakeDb
    },
    {
      firebaseIdToken:
        "fake.firebase.token",

      installationId:
        INSTALLATION_ID
    },
    {
      nowMs:
        NOW_MS,

      requestId:
        "req_test_create",

      verifyFirebaseIdToken,

      consumeRateLimit:
        allowRateLimit,

      appCheckToken:
        "fake.app.check",

      verifyFirebaseAppCheckToken
    }
  );


assert.equal(
  created.ok,
  true
);

assert.equal(
  created.created,
  true
);

assert.equal(
  created.staff.role,
  "driver"
);

assert.equal(
  created.registration.status,
  "draft"
);

assert.equal(
  created.registration.identityStatus,
  "pending"
);

assert.ok(
  created.accessToken
);

assert.ok(
  created.refreshToken
);

assert.equal(
  Object.hasOwn(
    created,
    "phoneNumber"
  ),
  false
);


const replay =
  await exchangeDriverFirebaseSession(
    {
      ...env,
      DB:
        fakeDb
    },
    {
      firebaseIdToken:
        "fake.firebase.token",

      installationId:
        INSTALLATION_ID
    },
    {
      nowMs:
        NOW_MS,

      requestId:
        "req_test_replay",

      verifyFirebaseIdToken,

      consumeRateLimit:
        allowRateLimit,

      appCheckToken:
        "fake.app.check",

      verifyFirebaseAppCheckToken
    }
  );


assert.equal(
  replay.ok,
  false
);

assert.equal(
  replay.status,
  409
);

assert.equal(
  replay.code,
  "firebase_token_replay"
);


for (
  const injected of [
    {
      role:
        "admin"
    },
    {
      phone:
        "+15550000000"
    },
    {
      driverId:
        "staff_attacker"
    }
  ]
) {

  const result =
    await exchangeDriverFirebaseSession(
      {
        ...env,
        DB: {
          prepare() {
            throw new Error(
              "D1 must not be reached"
            );
          }
        }
      },
      {
        firebaseIdToken:
          "fake.firebase.token",

        installationId:
          INSTALLATION_ID,

        ...injected
      },
      {
        nowMs:
          NOW_MS,

        requestId:
          "req_test_injection",

        verifyFirebaseIdToken
      }
    );


  assert.equal(
    result.status,
    400
  );

  assert.equal(
    result.code,
    "invalid_request"
  );
}


const blocked =
  await exchangeDriverFirebaseSession(
    {
      ...env,
      DB:
        createFakeDb(
          "blocked"
        )
    },
    {
      firebaseIdToken:
        "blocked.firebase.token",

      installationId:
        INSTALLATION_ID
    },
    {
      nowMs:
        NOW_MS,

      requestId:
        "req_test_blocked",

      verifyFirebaseIdToken,

      consumeRateLimit:
        allowRateLimit,

      appCheckToken:
        "fake.app.check",

      verifyFirebaseAppCheckToken
    }
  );


assert.equal(
  blocked.status,
  403
);

assert.equal(
  blocked.code,
  "driver_account_blocked"
);


const identityConflict =
  await exchangeDriverFirebaseSession(
    {
      ...env,
      DB:
        createFakeDb(
          "identity-conflict"
        )
    },
    {
      firebaseIdToken:
        "conflict.firebase.token",

      installationId:
        INSTALLATION_ID
    },
    {
      nowMs:
        NOW_MS,

      requestId:
        "req_test_identity_conflict",

      verifyFirebaseIdToken,

      consumeRateLimit:
        allowRateLimit,

      appCheckToken:
        "fake.app.check",

      verifyFirebaseAppCheckToken
    }
  );


assert.equal(
  identityConflict.status,
  409
);

assert.equal(
  identityConflict.code,
  "firebase_identity_conflict"
);


const missingAppCheck =
  await exchangeDriverFirebaseSession(
    {
      ...env,
      DB:
        createFakeDb(
          "new"
        )
    },
    {
      firebaseIdToken:
        "missing.appcheck.firebase.token",

      installationId:
        INSTALLATION_ID
    },
    {
      nowMs:
        NOW_MS,

      requestId:
        "req_test_missing_app_check",

      verifyFirebaseIdToken,

      consumeRateLimit:
        allowRateLimit
    }
  );


assert.equal(
  missingAppCheck.status,
  401
);

assert.equal(
  missingAppCheck.code,
  "firebase_app_check_required"
);


const invalidIdentity =
  await exchangeDriverFirebaseSession(
    {
      ...env,
      DB:
        createFakeDb(
          "new"
        )
    },
    {
      firebaseIdToken:
        "invalid.firebase.token",

      installationId:
        INSTALLATION_ID
    },
    {
      nowMs:
        NOW_MS,

      requestId:
        "req_test_bad_identity",

      verifyFirebaseIdToken:
        async () => {
          throw new Error(
            "invalid signature"
          );
        },

      consumeRateLimit:
        allowRateLimit,

      appCheckToken:
        "fake.app.check",

      verifyFirebaseAppCheckToken
    }
  );


assert.equal(
  invalidIdentity.status,
  401
);

assert.equal(
  invalidIdentity.code,
  "invalid_firebase_identity"
);


console.log(
  "✓ DRIVER FIREBASE SESSION EXCHANGE TESTS PASSED"
);
