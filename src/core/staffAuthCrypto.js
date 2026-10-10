// =========================================
// STAFF AUTH CRYPTO
// =========================================
//
// Passwords:
//
// PBKDF2-HMAC-SHA256
// unique random salt
// fixed 100,000 iterations
// 256-bit derived key
//
// Cloudflare Workers Web Crypto rejects
// PBKDF2 iteration counts above 100,000.
//
// Refresh tokens:
//
// 256-bit cryptographically random secret
// D1 stores SHA-256(token), never plaintext.
//
// This module contains cryptographic
// primitives only.
//
// It does NOT:
//
// - read/write D1
// - issue staff JWT
// - authorize roles
// - implement login policy
// =========================================


const encoder =
  new TextEncoder();


// =========================================
// PASSWORD CONSTANTS
// =========================================

export const STAFF_PASSWORD_ALGORITHM =
  "pbkdf2-sha256";

export const STAFF_PASSWORD_ITERATIONS =
  100000;

const PASSWORD_SALT_BYTES =
  16;

const PASSWORD_HASH_BYTES =
  32;


// Prevent deliberately enormous login
// payloads from becoming a CPU/memory DoS.
//
// This is a UTF-8 byte limit, not a
// character limit.
//
// 512 bytes is still comfortably above
// normal password-manager generated
// password lengths.
const MAX_PASSWORD_BYTES =
  512;


// =========================================
// REFRESH TOKEN CONSTANTS
// =========================================

const REFRESH_TOKEN_BYTES =
  32;

const REFRESH_TOKEN_PREFIX =
  "tsr1.";

const REFRESH_TOKEN_PATTERN =
  /^tsr1\.[A-Za-z0-9_-]{43}$/;


// =========================================
// CRYPTO REQUIREMENT
// =========================================

function requireCrypto() {

  if (
    !globalThis.crypto
    ||
    !globalThis.crypto.subtle
    ||
    typeof globalThis.crypto
      .getRandomValues !== "function"
  ) {

    throw new Error(
      "Web Crypto is unavailable"
    );
  }


  return globalThis.crypto;
}


// =========================================
// BASE64URL
// =========================================

function bytesToBase64Url(
  bytes
) {

  let binary =
    "";


  for (
    let i = 0;
    i < bytes.length;
    i++
  ) {

    binary +=
      String.fromCharCode(
        bytes[i]
      );
  }


  return btoa(
    binary
  )
    .replace(
      /\+/g,
      "-"
    )
    .replace(
      /\//g,
      "_"
    )
    .replace(
      /=+$/g,
      ""
    );
}


function base64UrlToBytes(
  value
) {

  // Deliberately no trim().
  //
  // Cryptographic values are exact opaque
  // strings. Leading/trailing whitespace
  // must invalidate them rather than be
  // silently accepted.
  const text =
    String(
      value ?? ""
    );


  if (
    !text
    ||
    !/^[A-Za-z0-9_-]+$/.test(
      text
    )
  ) {

    throw new Error(
      "Invalid base64url value"
    );
  }


  let base64 =
    text
      .replace(
        /-/g,
        "+"
      )
      .replace(
        /_/g,
        "/"
      );


  const remainder =
    base64.length % 4;


  if (
    remainder === 2
  ) {

    base64 +=
      "==";

  } else if (
    remainder === 3
  ) {

    base64 +=
      "=";

  } else if (
    remainder !== 0
  ) {

    throw new Error(
      "Invalid base64url value"
    );
  }


  let binary;


  try {

    binary =
      atob(
        base64
      );

  } catch (
    error
  ) {

    throw new Error(
      "Invalid base64url value"
    );
  }


  const bytes =
    new Uint8Array(
      binary.length
    );


  for (
    let i = 0;
    i < binary.length;
    i++
  ) {

    bytes[i] =
      binary.charCodeAt(
        i
      );
  }


  // Reject non-canonical encodings.
  if (
    bytesToBase64Url(
      bytes
    ) !== text
  ) {

    throw new Error(
      "Invalid base64url value"
    );
  }


  return bytes;
}


// =========================================
// PASSWORD INPUT
// =========================================

function passwordToBytes(
  password
) {

  if (
    typeof password !==
      "string"
    ||
    password.length === 0
  ) {

    throw new Error(
      "Invalid staff password"
    );
  }


  // Password is intentionally NOT:
  //
  // - trimmed
  // - lowercased
  // - normalized
  //
  // The exact password entered by the
  // user is the password being verified.
  const bytes =
    encoder.encode(
      password
    );


  if (
    bytes.length >
      MAX_PASSWORD_BYTES
  ) {

    throw new Error(
      "Staff password is too long"
    );
  }


  return bytes;
}


// =========================================
// ITERATIONS
// =========================================
//
// Cloudflare Workers currently supports
// PBKDF2 iteration counts up to 100,000.
//
// Staff password verifiers therefore use
// one exact production work factor.
//
// Unsupported persisted verifier metadata
// is rejected before Web Crypto is called.
// =========================================

function requireIterations(
  value
) {

  const iterations =
    Number(
      value
    );


  if (
    !Number.isSafeInteger(
      iterations
    )
    ||
    iterations !==
      STAFF_PASSWORD_ITERATIONS
  ) {

    throw new Error(
      "Invalid staff password iterations"
    );
  }


  return iterations;
}


// =========================================
// RANDOM BYTES
// =========================================

function randomBytes(
  length
) {

  const crypto =
    requireCrypto();


  const bytes =
    new Uint8Array(
      length
    );


  crypto.getRandomValues(
    bytes
  );


  return bytes;
}


// =========================================
// PBKDF2
// =========================================

async function derivePasswordHash(
  password,
  salt,
  iterations
) {

  const crypto =
    requireCrypto();


  const passwordBytes =
    passwordToBytes(
      password
    );


  const baseKey =
    await crypto.subtle.importKey(
      "raw",
      passwordBytes,
      {
        name:
          "PBKDF2"
      },
      false,
      [
        "deriveBits"
      ]
    );


  const derivedBits =
    await crypto.subtle.deriveBits(
      {
        name:
          "PBKDF2",

        hash:
          "SHA-256",

        salt,

        iterations
      },
      baseKey,
      PASSWORD_HASH_BYTES * 8
    );


  return new Uint8Array(
    derivedBits
  );
}


// =========================================
// TIMING-SAFE EQUALITY
// =========================================

function timingSafeEqual(
  left,
  right
) {

  if (
    !(left instanceof Uint8Array)
    ||
    !(right instanceof Uint8Array)
  ) {

    return false;
  }


  if (
    left.length !==
      right.length
  ) {

    return false;
  }


  const crypto =
    requireCrypto();


  // Cloudflare Workers provides a
  // timingSafeEqual extension.
  if (
    typeof crypto.subtle
      .timingSafeEqual ===
      "function"
  ) {

    return crypto.subtle
      .timingSafeEqual(
        left,
        right
      );
  }


  // Node.js Web Crypto used by local tests
  // may not expose Cloudflare's extension.
  //
  // This fallback keeps the local test
  // environment compatible.
  let difference =
    0;


  for (
    let i = 0;
    i < left.length;
    i++
  ) {

    difference |=
      left[i] ^
      right[i];
  }


  return (
    difference === 0
  );
}


// =========================================
// HASH STAFF PASSWORD
// =========================================
//
// IMPORTANT:
//
// New password hashes ALWAYS use the
// frozen production work factor:
//
// 100,000 PBKDF2-HMAC-SHA256 iterations.
//
// Callers cannot change this value.
//
// Returns exactly the verifier data that
// will later be persisted in:
//
// staff_accounts.password_*
//
// Password plaintext is not returned.
// =========================================

export async function hashStaffPassword(
  password
) {

  const iterations =
    STAFF_PASSWORD_ITERATIONS;


  const salt =
    randomBytes(
      PASSWORD_SALT_BYTES
    );


  const hash =
    await derivePasswordHash(
      password,
      salt,
      iterations
    );


  return {
    passwordAlgorithm:
      STAFF_PASSWORD_ALGORITHM,

    passwordIterations:
      iterations,

    passwordSalt:
      bytesToBase64Url(
        salt
      ),

    passwordHash:
      bytesToBase64Url(
        hash
      )
  };
}


// =========================================
// VERIFY STAFF PASSWORD
// =========================================
//
// Verification accepts only the current
// production work factor.
//
// This prevents unsupported persisted
// iteration counts from reaching the
// Cloudflare Web Crypto PBKDF2 operation.
// =========================================

export async function verifyStaffPassword(
  password,
  verifier
) {

  if (
    !verifier
    ||
    typeof verifier !==
      "object"
    ||
    Array.isArray(
      verifier
    )
  ) {

    throw new Error(
      "Invalid staff password verifier"
    );
  }


  const algorithm =
    String(
      verifier.passwordAlgorithm ??
      ""
    )
      .trim()
      .toLowerCase();


  if (
    algorithm !==
      STAFF_PASSWORD_ALGORITHM
  ) {

    throw new Error(
      "Unsupported staff password algorithm"
    );
  }


  const iterations =
    requireIterations(
      verifier.passwordIterations
    );


  let salt;
  let expectedHash;


  try {

    salt =
      base64UrlToBytes(
        verifier.passwordSalt
      );


    expectedHash =
      base64UrlToBytes(
        verifier.passwordHash
      );

  } catch (
    error
  ) {

    throw new Error(
      "Invalid staff password verifier"
    );
  }


  if (
    salt.length !==
      PASSWORD_SALT_BYTES
    ||
    expectedHash.length !==
      PASSWORD_HASH_BYTES
  ) {

    throw new Error(
      "Invalid staff password verifier"
    );
  }


  const actualHash =
    await derivePasswordHash(
      password,
      salt,
      iterations
    );


  return timingSafeEqual(
    actualHash,
    expectedHash
  );
}


// =========================================
// REFRESH TOKEN VALIDATION
// =========================================
//
// Refresh token is an opaque credential.
//
// No:
// - trim()
// - normalization
// - case conversion
//
// Even one extra whitespace character
// makes the credential invalid.
// =========================================

function requireRefreshToken(
  value
) {

  if (
    typeof value !==
      "string"
  ) {

    throw new Error(
      "Invalid staff refresh token"
    );
  }


  const token =
    value;


  if (
    !REFRESH_TOKEN_PATTERN.test(
      token
    )
  ) {

    throw new Error(
      "Invalid staff refresh token"
    );
  }


  const encodedSecret =
    token.slice(
      REFRESH_TOKEN_PREFIX.length
    );


  let secret;


  try {

    secret =
      base64UrlToBytes(
        encodedSecret
      );

  } catch (
    error
  ) {

    throw new Error(
      "Invalid staff refresh token"
    );
  }


  if (
    secret.length !==
      REFRESH_TOKEN_BYTES
  ) {

    throw new Error(
      "Invalid staff refresh token"
    );
  }


  return token;
}


// =========================================
// HASH REFRESH TOKEN
// =========================================

export async function hashRefreshToken(
  refreshToken
) {

  const crypto =
    requireCrypto();


  const token =
    requireRefreshToken(
      refreshToken
    );


  const digest =
    await crypto.subtle.digest(
      "SHA-256",
      encoder.encode(
        token
      )
    );


  return bytesToBase64Url(
    new Uint8Array(
      digest
    )
  );
}


// =========================================
// CREATE REFRESH TOKEN
// =========================================
//
// Only refreshToken is secret.
//
// refreshTokenHash is safe to persist in D1.
// =========================================

export async function createRefreshToken() {

  const secret =
    randomBytes(
      REFRESH_TOKEN_BYTES
    );


  const refreshToken =
    REFRESH_TOKEN_PREFIX +
    bytesToBase64Url(
      secret
    );


  const refreshTokenHash =
    await hashRefreshToken(
      refreshToken
    );


  return {
    refreshToken,
    refreshTokenHash
  };
}