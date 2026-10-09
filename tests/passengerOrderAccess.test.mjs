import assert from "node:assert/strict";

import {
  webcrypto
} from "node:crypto";

import {
  signJWT
} from "../src/core/auth.js";

import {
  requirePassengerOrderAccess,
  issuePassengerOrderAccess,
  verifyPassengerOrderAccess
} from "../src/core/passengerOrderAccess.js";


if (!globalThis.crypto) {
  globalThis.crypto =
    webcrypto;
}


// ========================================
// CONSTANTS
// ========================================

const PASSENGER_SECRET =
  "0123456789abcdef0123456789abcdef";

const OTHER_PASSENGER_SECRET =
  "abcdef0123456789abcdef0123456789";

const STAFF_JWT_SECRET =
  "staff-secret-0123456789abcdef123456";

const FIXED_NOW =
  Date.parse(
    "2026-10-08T12:00:00.000Z"
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

  } catch (error) {

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
// TIME
// ========================================

async function withNow(
  now,
  fn
) {

  const originalNow =
    Date.now;

  Date.now =
    () => now;

  try {

    return await fn();

  } finally {

    Date.now =
      originalNow;
  }
}


// ========================================
// ENV
// ========================================

function env(
  secret =
    PASSENGER_SECRET
) {

  return {
    PASSENGER_ORDER_SECRET:
      secret,

    JWT_SECRET:
      STAFF_JWT_SECRET
  };
}


// ========================================
// ORDER
// ========================================

function order(
  overrides = {}
) {

  return {
    id:
      "order-123",

    date:
      "2026-10-20",

    ...overrides
  };
}


// ========================================
// CONFIG
// ========================================

await test(
  "passenger order access accepts valid dedicated secret",
  async () => {

    assert.equal(
      requirePassengerOrderAccess(
        env()
      ),
      true
    );
  }
);


await test(
  "missing passenger secret is rejected",
  async () => {

    assert.throws(
      () =>
        requirePassengerOrderAccess(
          {}
        ),

      /PASSENGER_ORDER_SECRET is missing or too short/
    );
  }
);


await test(
  "short passenger secret is rejected",
  async () => {

    assert.throws(
      () =>
        requirePassengerOrderAccess(
          {
            PASSENGER_ORDER_SECRET:
              "short"
          }
        ),

      /PASSENGER_ORDER_SECRET is missing or too short/
    );
  }
);


await test(
  "staff JWT secret is not accepted as implicit passenger secret",
  async () => {

    assert.throws(
      () =>
        requirePassengerOrderAccess(
          {
            JWT_SECRET:
              STAFF_JWT_SECRET
          }
        ),

      /PASSENGER_ORDER_SECRET is missing or too short/
    );
  }
);


// ========================================
// ISSUE TOKEN
// ========================================

await test(
  "passenger access token is issued for exact order",
  async () => {

    await withNow(
      FIXED_NOW,
      async () => {

        const result =
          await issuePassengerOrderAccess(
            env(),
            order()
          );


        assert.equal(
          typeof result.accessToken,
          "string"
        );

        assert.equal(
          result.accessToken
            .split(".")
            .length,
          3
        );

        assert.ok(
          Number.isSafeInteger(
            result.accessExpiresAt
          )
        );

        assert.ok(
          result.accessExpiresAt >
            FIXED_NOW
        );
      }
    );
  }
);


await test(
  "order id is required when issuing passenger access",
  async () => {

    await assert.rejects(
      () =>
        issuePassengerOrderAccess(
          env(),
          order({
            id:
              ""
          })
        ),

      /Invalid passenger order id/
    );
  }
);


// ========================================
// VERIFY TOKEN
// ========================================

await test(
  "valid passenger token verifies for its order",
  async () => {

    await withNow(
      FIXED_NOW,
      async () => {

        const issued =
          await issuePassengerOrderAccess(
            env(),
            order({
              id:
                "order-abc"
            })
          );


        const verified =
          await verifyPassengerOrderAccess(
            env(),
            issued.accessToken
          );


        assert.equal(
          verified.ok,
          true
        );

        assert.equal(
          verified.orderId,
          "order-abc"
        );

        assert.equal(
          verified.expiresAt,
          issued.accessExpiresAt
        );
      }
    );
  }
);


await test(
  "empty passenger token is rejected",
  async () => {

    const result =
      await verifyPassengerOrderAccess(
        env(),
        ""
      );


    assert.deepEqual(
      result,
      {
        ok:
          false
      }
    );
  }
);


// ========================================
// WRONG SECRET
// ========================================

await test(
  "token cannot be verified with another passenger secret",
  async () => {

    await withNow(
      FIXED_NOW,
      async () => {

        const issued =
          await issuePassengerOrderAccess(
            env(
              PASSENGER_SECRET
            ),
            order()
          );


        const result =
          await verifyPassengerOrderAccess(
            env(
              OTHER_PASSENGER_SECRET
            ),
            issued.accessToken
          );


        assert.equal(
          result.ok,
          false
        );
      }
    );
  }
);


// ========================================
// STAFF JWT ISOLATION
// ========================================

await test(
  "staff JWT cannot be used as passenger order token",
  async () => {

    await withNow(
      FIXED_NOW,
      async () => {

        const staffToken =
          await signJWT(
            STAFF_JWT_SECRET,
            {
              sub:
                "order-123",

              scope:
                "passenger_order:read"
            },
            3600
          );


        const result =
          await verifyPassengerOrderAccess(
            env(),
            staffToken
          );


        assert.equal(
          result.ok,
          false
        );
      }
    );
  }
);


// ========================================
// TAMPERED TOKEN
// ========================================

await test(
  "tampered passenger token is rejected",
  async () => {

    await withNow(
      FIXED_NOW,
      async () => {

        const issued =
          await issuePassengerOrderAccess(
            env(),
            order()
          );


        const parts =
          issued.accessToken
            .split(".");


        const payload =
          parts[1];


        const tamperedPayload =
          payload.slice(
            0,
            -1
          ) +
          (
            payload.endsWith(
              "A"
            )
              ? "B"
              : "A"
          );


        const tamperedToken =
          `${parts[0]}.${tamperedPayload}.${parts[2]}`;


        const result =
          await verifyPassengerOrderAccess(
            env(),
            tamperedToken
          );


        assert.equal(
          result.ok,
          false
        );
      }
    );
  }
);


// ========================================
// SCOPE
// ========================================

await test(
  "token with wrong scope is rejected",
  async () => {

    await withNow(
      FIXED_NOW,
      async () => {

        const token =
          await signJWT(
            PASSENGER_SECRET,
            {
              sub:
                "order-123",

              scope:
                "admin"
            },
            3600
          );


        const result =
          await verifyPassengerOrderAccess(
            env(),
            token
          );


        assert.equal(
          result.ok,
          false
        );
      }
    );
  }
);


await test(
  "token without order subject is rejected",
  async () => {

    await withNow(
      FIXED_NOW,
      async () => {

        const token =
          await signJWT(
            PASSENGER_SECRET,
            {
              scope:
                "passenger_order:read"
            },
            3600
          );


        const result =
          await verifyPassengerOrderAccess(
            env(),
            token
          );


        assert.equal(
          result.ok,
          false
        );
      }
    );
  }
);


// ========================================
// EXPIRATION
// ========================================

await test(
  "expired passenger token is rejected",
  async () => {

    let token;


    await withNow(
      FIXED_NOW,
      async () => {

        token =
          await signJWT(
            PASSENGER_SECRET,
            {
              sub:
                "order-123",

              scope:
                "passenger_order:read"
            },
            60
          );
      }
    );


    await withNow(
      FIXED_NOW + 61000,
      async () => {

        const result =
          await verifyPassengerOrderAccess(
            env(),
            token
          );


        assert.equal(
          result.ok,
          false
        );
      }
    );
  }
);


// ========================================
// MINIMUM 30 DAYS
// ========================================

await test(
  "passenger access lives at least 30 days",
  async () => {

    await withNow(
      FIXED_NOW,
      async () => {

        const issued =
          await issuePassengerOrderAccess(
            env(),
            order({
              date:
                "2026-10-09"
            })
          );


        const minimum =
          FIXED_NOW +
          (
            30 *
            24 *
            60 *
            60 *
            1000
          );


        assert.ok(
          issued.accessExpiresAt >=
            minimum
        );
      }
    );
  }
);


// ========================================
// FUTURE TRIP
// ========================================

await test(
  "future trip access survives until at least seven days after trip",
  async () => {

    await withNow(
      FIXED_NOW,
      async () => {

        const issued =
          await issuePassengerOrderAccess(
            env(),
            order({
              date:
                "2027-01-15"
            })
          );


        const expectedMinimum =
          Date.parse(
            "2027-01-22T23:59:59.999Z"
          );


        assert.ok(
          issued.accessExpiresAt >=
            expectedMinimum
        );
      }
    );
  }
);


// ========================================
// INVALID TRIP DATE
// ========================================

await test(
  "invalid trip date falls back to minimum lifetime",
  async () => {

    await withNow(
      FIXED_NOW,
      async () => {

        const issued =
          await issuePassengerOrderAccess(
            env(),
            order({
              date:
                "2026-99-99"
            })
          );


        const minimum =
          FIXED_NOW +
          (
            30 *
            24 *
            60 *
            60 *
            1000
          );


        assert.ok(
          issued.accessExpiresAt >=
            minimum
        );
      }
    );
  }
);


console.log("");

if (!process.exitCode) {

  console.log(
    "✓ ALL PASSENGER ORDER ACCESS TESTS PASSED"
  );
}