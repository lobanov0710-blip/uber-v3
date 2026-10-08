import assert from "node:assert/strict";

import {
  webcrypto
} from "node:crypto";

import {
  signJWT,
  verifyJWT,
  getBearerToken,
  authenticateRequest,
  hasRole
} from "../src/core/auth.js";


if (!globalThis.crypto) {
  globalThis.crypto =
    webcrypto;
}


// ========================================
// BROWSER BASE64 FALLBACK
// ========================================

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

const SECRET =
  "0123456789abcdef0123456789abcdef";

const OTHER_SECRET =
  "abcdef0123456789abcdef0123456789";

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
// TIME HELPER
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
// REQUEST HELPER
// ========================================

function requestWithAuthorization(
  authorization
) {

  const headers =
    new Headers();

  if (
    authorization !==
    undefined
  ) {

    headers.set(
      "Authorization",
      authorization
    );
  }

  return {
    headers
  };
}


// ========================================
// SIGN + VERIFY
// ========================================

await test(
  "signed JWT verifies and preserves payload",
  async () => {

    await withNow(
      FIXED_NOW,
      async () => {

        const token =
          await signJWT(
            SECRET,
            {
              id:
                "driver-1",

              role:
                "driver"
            },
            3600
          );


        assert.equal(
          typeof token,
          "string"
        );

        assert.equal(
          token.split(".").length,
          3
        );


        const payload =
          await verifyJWT(
            SECRET,
            token
          );


        assert.ok(
          payload
        );

        assert.equal(
          payload.id,
          "driver-1"
        );

        assert.equal(
          payload.role,
          "driver"
        );

        assert.equal(
          payload.iat,
          Math.floor(
            FIXED_NOW / 1000
          )
        );

        assert.equal(
          payload.exp,
          Math.floor(
            FIXED_NOW / 1000
          ) + 3600
        );
      }
    );
  }
);


// ========================================
// WRONG SECRET
// ========================================

await test(
  "JWT signed with another secret is rejected",
  async () => {

    await withNow(
      FIXED_NOW,
      async () => {

        const token =
          await signJWT(
            SECRET,
            {
              id:
                "driver-1",

              role:
                "driver"
            }
          );


        const payload =
          await verifyJWT(
            OTHER_SECRET,
            token
          );


        assert.equal(
          payload,
          null
        );
      }
    );
  }
);


// ========================================
// TAMPERED TOKEN
// ========================================

await test(
  "tampered JWT payload is rejected",
  async () => {

    await withNow(
      FIXED_NOW,
      async () => {

        const token =
          await signJWT(
            SECRET,
            {
              id:
                "driver-1",

              role:
                "driver"
            }
          );


        const parts =
          token.split(".");


        const originalBody =
          parts[1];


        const tamperedBody =
          originalBody.slice(
            0,
            -1
          ) +
          (
            originalBody.endsWith(
              "A"
            )
              ? "B"
              : "A"
          );


        const tamperedToken =
          `${parts[0]}.${tamperedBody}.${parts[2]}`;


        const payload =
          await verifyJWT(
            SECRET,
            tamperedToken
          );


        assert.equal(
          payload,
          null
        );
      }
    );
  }
);


// ========================================
// MALFORMED TOKEN
// ========================================

await test(
  "malformed JWT is rejected",
  async () => {

    const payload =
      await verifyJWT(
        SECRET,
        "not-a-jwt"
      );


    assert.equal(
      payload,
      null
    );
  }
);


// ========================================
// EXPIRED TOKEN
// ========================================

await test(
  "expired JWT is rejected",
  async () => {

    let token;


    await withNow(
      FIXED_NOW,
      async () => {

        token =
          await signJWT(
            SECRET,
            {
              id:
                "driver-1",

              role:
                "driver"
            },
            60
          );
      }
    );


    await withNow(
      FIXED_NOW + 61000,
      async () => {

        const payload =
          await verifyJWT(
            SECRET,
            token
          );


        assert.equal(
          payload,
          null
        );
      }
    );
  }
);


// ========================================
// FUTURE ISSUED TOKEN
// ========================================

await test(
  "JWT issued too far in the future is rejected",
  async () => {

    let token;


    await withNow(
      FIXED_NOW,
      async () => {

        token =
          await signJWT(
            SECRET,
            {
              id:
                "driver-1",

              role:
                "driver"
            }
          );
      }
    );


    await withNow(
      FIXED_NOW - 61000,
      async () => {

        const payload =
          await verifyJWT(
            SECRET,
            token
          );


        assert.equal(
          payload,
          null
        );
      }
    );
  }
);


// ========================================
// SECRET VALIDATION
// ========================================

await test(
  "JWT signing requires sufficiently long secret",
  async () => {

    await assert.rejects(
      () =>
        signJWT(
          "short-secret",
          {
            id:
              "driver-1"
          }
        ),

      /JWT_SECRET is missing or too short/
    );
  }
);


// ========================================
// PAYLOAD VALIDATION
// ========================================

await test(
  "JWT signing requires object payload",
  async () => {

    await assert.rejects(
      () =>
        signJWT(
          SECRET,
          "driver"
        ),

      /JWT payload must be an object/
    );
  }
);


// ========================================
// TTL VALIDATION
// ========================================

await test(
  "JWT signing rejects invalid TTL",
  async () => {

    await assert.rejects(
      () =>
        signJWT(
          SECRET,
          {
            id:
              "driver-1"
          },
          0
        ),

      /Invalid JWT TTL/
    );
  }
);


// ========================================
// BEARER TOKEN
// ========================================

await test(
  "Bearer token is extracted from Authorization header",
  async () => {

    const request =
      requestWithAuthorization(
        "Bearer abc.def.ghi"
      );


    assert.equal(
      getBearerToken(
        request
      ),
      "abc.def.ghi"
    );
  }
);


await test(
  "Bearer scheme is case insensitive",
  async () => {

    const request =
      requestWithAuthorization(
        "bearer abc.def.ghi"
      );


    assert.equal(
      getBearerToken(
        request
      ),
      "abc.def.ghi"
    );
  }
);


await test(
  "missing Authorization header returns null bearer token",
  async () => {

    const request =
      requestWithAuthorization(
        undefined
      );


    assert.equal(
      getBearerToken(
        request
      ),
      null
    );
  }
);


await test(
  "non Bearer authorization is rejected",
  async () => {

    const request =
      requestWithAuthorization(
        "Basic abc123"
      );


    assert.equal(
      getBearerToken(
        request
      ),
      null
    );
  }
);


// ========================================
// AUTHENTICATE REQUEST
// ========================================

await test(
  "request without bearer token returns 401",
  async () => {

    const result =
      await authenticateRequest(
        requestWithAuthorization(
          undefined
        ),
        {
          JWT_SECRET:
            SECRET
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
  }
);


await test(
  "invalid bearer token returns 401",
  async () => {

    const result =
      await authenticateRequest(
        requestWithAuthorization(
          "Bearer invalid.token.value"
        ),
        {
          JWT_SECRET:
            SECRET
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
          "invalid or expired token"
      }
    );
  }
);


await test(
  "valid bearer token authenticates request",
  async () => {

    await withNow(
      FIXED_NOW,
      async () => {

        const token =
          await signJWT(
            SECRET,
            {
              id:
                "driver-1",

              role:
                "driver"
            },
            3600
          );


        const result =
          await authenticateRequest(
            requestWithAuthorization(
              `Bearer ${token}`
            ),
            {
              JWT_SECRET:
                SECRET
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

        assert.equal(
          result.user.id,
          "driver-1"
        );

        assert.equal(
          result.user.role,
          "driver"
        );
      }
    );
  }
);


// ========================================
// ROLE CHECK
// ========================================

await test(
  "role check accepts matching role",
  async () => {

    assert.equal(
      hasRole(
        {
          role:
            "driver"
        },
        "driver"
      ),
      true
    );
  }
);


await test(
  "role check normalizes case and whitespace",
  async () => {

    assert.equal(
      hasRole(
        {
          role:
            " DRIVER "
        },
        "driver"
      ),
      true
    );
  }
);


await test(
  "role check supports several allowed roles",
  async () => {

    assert.equal(
      hasRole(
        {
          role:
            "admin"
        },
        "driver",
        "admin"
      ),
      true
    );
  }
);


await test(
  "role check rejects unauthorized role",
  async () => {

    assert.equal(
      hasRole(
        {
          role:
            "passenger"
        },
        "driver",
        "admin"
      ),
      false
    );
  }
);


await test(
  "role check rejects missing user",
  async () => {

    assert.equal(
      hasRole(
        null,
        "admin"
      ),
      false
    );
  }
);


console.log("");

if (!process.exitCode) {

  console.log(
    "✓ ALL AUTH TESTS PASSED"
  );
}