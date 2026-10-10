import assert from "node:assert/strict";

import {
  webcrypto
} from "node:crypto";

import {
  STAFF_PASSWORD_ALGORITHM,
  STAFF_PASSWORD_ITERATIONS,
  hashStaffPassword,
  verifyStaffPassword,
  createRefreshToken,
  hashRefreshToken
} from "../src/core/staffAuthCrypto.js";


// ========================================
// WEB CRYPTO
// ========================================

if (
  !globalThis.crypto
) {

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
// HISTORICAL VERIFIER ITERATIONS
// ========================================
//
// Verification intentionally accepts
// schema-valid historical verifier work
// factors.
//
// New hashes, however, must always use
// the frozen production value of 600,000.
// ========================================

const HISTORICAL_TEST_ITERATIONS =
  100000;


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
// CONSTANTS
// ========================================

await test(
  "staff password algorithm is frozen",
  async () => {

    assert.equal(
      STAFF_PASSWORD_ALGORITHM,
      "pbkdf2-sha256"
    );


    assert.equal(
      STAFF_PASSWORD_ITERATIONS,
      600000
    );
  }
);


// ========================================
// PASSWORD HASH
// ========================================

await test(
  "staff password is hashed with fixed production work factor",
  async () => {

    const first =
      await hashStaffPassword(
        "VeryStrongPassword-123!",
        {
          iterations:
            HISTORICAL_TEST_ITERATIONS
        }
      );


    const second =
      await hashStaffPassword(
        "VeryStrongPassword-123!"
      );


    assert.equal(
      first.passwordAlgorithm,
      "pbkdf2-sha256"
    );


    // Caller-supplied iteration override
    // must have no effect.
    assert.equal(
      first.passwordIterations,
      STAFF_PASSWORD_ITERATIONS
    );


    assert.equal(
      second.passwordIterations,
      STAFF_PASSWORD_ITERATIONS
    );


    assert.equal(
      first.passwordIterations,
      600000
    );


    assert.equal(
      second.passwordIterations,
      600000
    );


    // Same password must still receive
    // independent random salts.
    assert.notEqual(
      first.passwordSalt,
      second.passwordSalt
    );


    assert.notEqual(
      first.passwordHash,
      second.passwordHash
    );


    assert.equal(
      typeof first.passwordSalt,
      "string"
    );


    assert.equal(
      typeof first.passwordHash,
      "string"
    );


    // 16-byte salt -> 22 base64url chars.
    assert.equal(
      first.passwordSalt.length,
      22
    );


    // 32-byte derived key -> 43 base64url chars.
    assert.equal(
      first.passwordHash.length,
      43
    );


    assert.match(
      first.passwordSalt,
      /^[A-Za-z0-9_-]{22}$/
    );


    assert.match(
      first.passwordHash,
      /^[A-Za-z0-9_-]{43}$/
    );
  }
);


// ========================================
// CALLER CANNOT DOWNGRADE HASHING
// ========================================

await test(
  "password hashing cannot be downgraded by caller",
  async () => {

    const verifier =
      await hashStaffPassword(
        "Password-123!",
        {
          iterations:
            100000
        }
      );


    assert.equal(
      verifier.passwordIterations,
      STAFF_PASSWORD_ITERATIONS
    );


    assert.equal(
      verifier.passwordIterations,
      600000
    );
  }
);


// ========================================
// CORRECT PASSWORD
// ========================================

await test(
  "correct staff password verifies",
  async () => {

    const verifier =
      await hashStaffPassword(
        "Correct-Horse-Battery-42!"
      );


    const valid =
      await verifyStaffPassword(
        "Correct-Horse-Battery-42!",
        verifier
      );


    assert.equal(
      valid,
      true
    );
  }
);


// ========================================
// WRONG PASSWORD
// ========================================

await test(
  "wrong staff password is rejected",
  async () => {

    const verifier =
      await hashStaffPassword(
        "Correct-Horse-Battery-42!"
      );


    const valid =
      await verifyStaffPassword(
        "Wrong-Password-42!",
        verifier
      );


    assert.equal(
      valid,
      false
    );
  }
);


// ========================================
// PASSWORD IS EXACT
// ========================================

await test(
  "staff password is not trimmed or normalized",
  async () => {

    const verifier =
      await hashStaffPassword(
        " Password-123! "
      );


    assert.equal(
      await verifyStaffPassword(
        " Password-123! ",
        verifier
      ),
      true
    );


    assert.equal(
      await verifyStaffPassword(
        "Password-123!",
        verifier
      ),
      false
    );
  }
);


// ========================================
// INVALID PASSWORD
// ========================================

await test(
  "empty staff password is rejected",
  async () => {

    await assert.rejects(
      () =>
        hashStaffPassword(
          ""
        ),

      /Invalid staff password/
    );
  }
);


await test(
  "oversized staff password is rejected",
  async () => {

    const oversized =
      "a".repeat(
        513
      );


    await assert.rejects(
      () =>
        hashStaffPassword(
          oversized
        ),

      /Staff password is too long/
    );
  }
);


// ========================================
// INVALID VERIFIER
// ========================================

await test(
  "unsupported password algorithm is rejected",
  async () => {

    await assert.rejects(
      () =>
        verifyStaffPassword(
          "Password-123!",
          {
            passwordAlgorithm:
              "sha256",

            passwordIterations:
              HISTORICAL_TEST_ITERATIONS,

            passwordSalt:
              "aaaaaaaaaaaaaaaaaaaaaa",

            passwordHash:
              "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
          }
        ),

      /Unsupported staff password algorithm/
    );
  }
);


await test(
  "unsafe persisted verifier iteration count is rejected",
  async () => {

    await assert.rejects(
      () =>
        verifyStaffPassword(
          "Password-123!",
          {
            passwordAlgorithm:
              "pbkdf2-sha256",

            passwordIterations:
              99999,

            passwordSalt:
              "aaaaaaaaaaaaaaaaaaaaaa",

            passwordHash:
              "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
          }
        ),

      /Invalid staff password iterations/
    );
  }
);


await test(
  "malformed password verifier is rejected",
  async () => {

    await assert.rejects(
      () =>
        verifyStaffPassword(
          "Password-123!",
          {
            passwordAlgorithm:
              "pbkdf2-sha256",

            passwordIterations:
              HISTORICAL_TEST_ITERATIONS,

            passwordSalt:
              "***invalid***",

            passwordHash:
              "also-invalid"
          }
        ),

      /Invalid staff password verifier/
    );
  }
);


await test(
  "password verifier base64url does not accept whitespace",
  async () => {

    await assert.rejects(
      () =>
        verifyStaffPassword(
          "Password-123!",
          {
            passwordAlgorithm:
              "pbkdf2-sha256",

            passwordIterations:
              HISTORICAL_TEST_ITERATIONS,

            passwordSalt:
              " aaaaaaaaaaaaaaaaaaaaaa",

            passwordHash:
              "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
          }
        ),

      /Invalid staff password verifier/
    );


    await assert.rejects(
      () =>
        verifyStaffPassword(
          "Password-123!",
          {
            passwordAlgorithm:
              "pbkdf2-sha256",

            passwordIterations:
              HISTORICAL_TEST_ITERATIONS,

            passwordSalt:
              "aaaaaaaaaaaaaaaaaaaaaa",

            passwordHash:
              "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa "
          }
        ),

      /Invalid staff password verifier/
    );
  }
);


// ========================================
// REFRESH TOKEN
// ========================================

await test(
  "refresh token contains 256 bits of random secret",
  async () => {

    const result =
      await createRefreshToken();


    assert.match(
      result.refreshToken,
      /^tsr1\.[A-Za-z0-9_-]{43}$/
    );


    assert.match(
      result.refreshTokenHash,
      /^[A-Za-z0-9_-]{43}$/
    );
  }
);


await test(
  "refresh tokens are unique",
  async () => {

    const first =
      await createRefreshToken();


    const second =
      await createRefreshToken();


    assert.notEqual(
      first.refreshToken,
      second.refreshToken
    );


    assert.notEqual(
      first.refreshTokenHash,
      second.refreshTokenHash
    );
  }
);


// ========================================
// REFRESH TOKEN HASH
// ========================================

await test(
  "refresh token hash is deterministic",
  async () => {

    const result =
      await createRefreshToken();


    const secondHash =
      await hashRefreshToken(
        result.refreshToken
      );


    assert.equal(
      secondHash,
      result.refreshTokenHash
    );
  }
);


await test(
  "different refresh tokens have different hashes",
  async () => {

    const first =
      await createRefreshToken();


    const second =
      await createRefreshToken();


    assert.notEqual(
      await hashRefreshToken(
        first.refreshToken
      ),
      await hashRefreshToken(
        second.refreshToken
      )
    );
  }
);


// ========================================
// STRICT REFRESH TOKEN
// ========================================

await test(
  "refresh token with leading whitespace is rejected",
  async () => {

    const token =
      await createRefreshToken();


    await assert.rejects(
      () =>
        hashRefreshToken(
          ` ${token.refreshToken}`
        ),

      /Invalid staff refresh token/
    );
  }
);


await test(
  "refresh token with trailing whitespace is rejected",
  async () => {

    const token =
      await createRefreshToken();


    await assert.rejects(
      () =>
        hashRefreshToken(
          `${token.refreshToken} `
        ),

      /Invalid staff refresh token/
    );
  }
);


await test(
  "refresh token with newline is rejected",
  async () => {

    const token =
      await createRefreshToken();


    await assert.rejects(
      () =>
        hashRefreshToken(
          `${token.refreshToken}\n`
        ),

      /Invalid staff refresh token/
    );
  }
);


// ========================================
// MALFORMED REFRESH TOKEN
// ========================================

await test(
  "malformed refresh token is rejected",
  async () => {

    await assert.rejects(
      () =>
        hashRefreshToken(
          "not-a-refresh-token"
        ),

      /Invalid staff refresh token/
    );
  }
);


await test(
  "wrong refresh token prefix is rejected",
  async () => {

    const token =
      await createRefreshToken();


    const malformed =
      token.refreshToken.replace(
        /^tsr1\./,
        "tsr2."
      );


    await assert.rejects(
      () =>
        hashRefreshToken(
          malformed
        ),

      /Invalid staff refresh token/
    );
  }
);


console.log("");


if (
  !process.exitCode
) {

  console.log(
    "✓ ALL STAFF AUTH CRYPTO TESTS PASSED"
  );
}