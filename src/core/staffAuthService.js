// =========================================
// STAFF AUTH SERVICE
// =========================================
//
// Authentication application layer.
//
// Responsibilities:
//
// - validate login credentials
// - verify staff password
// - enforce account status / lockout
// - create staff refresh sessions
// - rotate refresh tokens
// - revoke refresh sessions
// - issue short-lived staff access JWTs
//
// D1 persistence:
// staffAuthRepository.js
//
// Cryptography:
// staffAuthCrypto.js
//
// This module never stores plaintext
// passwords or refresh tokens in D1.
// =========================================

import {
  signJWT
} from "./auth.js";

import {
  verifyStaffPassword,
  createRefreshToken,
  hashRefreshToken
} from "./staffAuthCrypto.js";

import {
  getStaffAccountByLogin,
  getStaffAccountById,
  getStaffSessionByRefreshTokenHash,
  recordStaffLoginFailure,
  recordStaffLoginSuccess,
  insertStaffSession,
  rotateStaffSession,
  revokeStaffSession,
  revokeStaffSessionFamily
} from "./staffAuthRepository.js";


// =========================================
// TOKEN LIFETIMES
// =========================================

export const STAFF_ACCESS_TTL_SECONDS =
  15 * 60;

export const STAFF_REFRESH_TTL_MS =
  30 * 24 * 60 * 60 * 1000;


// =========================================
// INPUT LIMITS
// =========================================

const MAX_PASSWORD_BYTES =
  512;

const LOGIN_PATTERN =
  /^[a-z0-9][a-z0-9._-]{2,63}$/;

const encoder =
  new TextEncoder();


// =========================================
// DUMMY PASSWORD VERIFIER
// =========================================
//
// Used when an account does not exist,
// is locked, or is inactive.
//
// This prevents the fast-path:
//
// unknown login -> immediate rejection
//
// from becoming an obvious username
// enumeration timing oracle.
//
// 16 zero bytes as canonical base64url:
// AAAAAAAAAAAAAAAAAAAAAA
//
// 32 zero bytes as canonical base64url:
// AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
// =========================================

const DUMMY_PASSWORD_VERIFIER = {

  passwordAlgorithm:
    "pbkdf2-sha256",

  passwordIterations:
    600000,

  passwordSalt:
    "AAAAAAAAAAAAAAAAAAAAAA",

  passwordHash:
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
};


// =========================================
// GENERIC ERRORS
// =========================================

function invalidCredentials() {

  return {
    ok: false,
    status: 401,
    error:
      "invalid credentials"
  };
}


function invalidRefreshToken() {

  return {
    ok: false,
    status: 401,
    error:
      "invalid refresh token"
  };
}


function invalidRequest() {

  return {
    ok: false,
    status: 400,
    error:
      "invalid request"
  };
}


// =========================================
// CRYPTO
// =========================================

function requireCrypto() {

  if (
    !globalThis.crypto
    ||
    typeof globalThis.crypto
      .randomUUID !== "function"
  ) {

    throw new Error(
      "Secure random UUID generation is unavailable"
    );
  }


  return globalThis.crypto;
}


// =========================================
// IDS
// =========================================

function createRandomId(
  prefix
) {

  const crypto =
    requireCrypto();


  return (
    `${prefix}_${crypto.randomUUID()}`
  );
}


// =========================================
// LOGIN INPUT
// =========================================

function parseLoginCredentials(
  input
) {

  if (
    !input
    ||
    typeof input !==
      "object"
    ||
    Array.isArray(
      input
    )
  ) {

    return null;
  }


  const login =
    String(
      input.login ?? ""
    )
      .trim()
      .toLowerCase();


  if (
    !LOGIN_PATTERN.test(
      login
    )
  ) {

    return null;
  }


  if (
    typeof input.password !==
      "string"
    ||
    input.password.length === 0
  ) {

    return null;
  }


  const passwordBytes =
    encoder.encode(
      input.password
    );


  if (
    passwordBytes.length >
      MAX_PASSWORD_BYTES
  ) {

    return null;
  }


  return {
    login,
    password:
      input.password
  };
}


// =========================================
// DUMMY PASSWORD WORK
// =========================================

async function consumeDummyPasswordWork(
  password
) {

  await verifyStaffPassword(
    password,
    DUMMY_PASSWORD_VERIFIER
  );
}


// =========================================
// PUBLIC STAFF OBJECT
// =========================================

function staffReceipt(
  account
) {

  return {
    id:
      account.id,

    displayName:
      account.displayName,

    role:
      account.role
  };
}


// =========================================
// ACCESS JWT
// =========================================
//
// sid binds the access JWT to one refresh
// session.
//
// ARCH-09.3 will validate:
//
// JWT signature
// account status
// tokenVersion
// sid/session status
//
// against authoritative D1 state.
// =========================================

async function issueStaffAccessToken(
  env,
  account,
  sessionId
) {

  const issuedAtSeconds =
    Math.floor(
      Date.now() / 1000
    );


  const accessToken =
    await signJWT(
      env?.JWT_SECRET,
      {
        sub:
          account.id,

        id:
          account.id,

        role:
          account.role,

        scope:
          "staff",

        tokenVersion:
          account.tokenVersion,

        sid:
          sessionId
      },
      STAFF_ACCESS_TTL_SECONDS
    );


  return {
    accessToken,

    accessExpiresAt:
      (
        issuedAtSeconds +
        STAFF_ACCESS_TTL_SECONDS
      ) * 1000
  };
}


// =========================================
// LOGIN
// =========================================

export async function loginStaff(
  env,
  credentials
) {

  const parsed =
    parseLoginCredentials(
      credentials
    );


  if (!parsed) {

    return invalidRequest();
  }


  const now =
    Date.now();


  const account =
    await getStaffAccountByLogin(
      env,
      parsed.login
    );


  // =======================================
  // UNKNOWN ACCOUNT
  // =======================================

  if (!account) {

    await consumeDummyPasswordWork(
      parsed.password
    );


    return invalidCredentials();
  }


  // =======================================
  // ACCOUNT STATUS
  // =======================================

  if (
    account.status !==
      "active"
  ) {

    await consumeDummyPasswordWork(
      parsed.password
    );


    return invalidCredentials();
  }


  // =======================================
  // TEMPORARY LOCK
  // =======================================

  if (
    account.lockedUntil !== null
    &&
    account.lockedUntil >
      now
  ) {

    await consumeDummyPasswordWork(
      parsed.password
    );


    return invalidCredentials();
  }


  // =======================================
  // PASSWORD
  // =======================================

  const passwordValid =
    await verifyStaffPassword(
      parsed.password,
      account.passwordVerifier
    );


  if (!passwordValid) {

    await recordStaffLoginFailure(
      env,
      account.id,
      {
        failedAt:
          now
      }
    );


    return invalidCredentials();
  }


  // =======================================
  // SUCCESSFUL LOGIN STATE
  // =======================================

  const authenticatedAccount =
    await recordStaffLoginSuccess(
      env,
      account.id,
      now
    );


  if (
    !authenticatedAccount
    ||
    authenticatedAccount.status !==
      "active"
  ) {

    return invalidCredentials();
  }


  // =======================================
  // SESSION IDENTIFIERS
  // =======================================

  const sessionId =
    createRandomId(
      "staff-session"
    );


  const familyId =
    createRandomId(
      "staff-family"
    );


  // =======================================
  // REFRESH TOKEN
  // =======================================

  const refresh =
    await createRefreshToken();


  const refreshExpiresAt =
    now +
    STAFF_REFRESH_TTL_MS;


  if (
    !Number.isSafeInteger(
      refreshExpiresAt
    )
  ) {

    throw new Error(
      "Invalid staff refresh expiration"
    );
  }


  // =======================================
  // ACCESS TOKEN
  // =======================================
  //
  // Sign before persisting the session.
  //
  // If JWT_SECRET is invalid, no unusable
  // refresh session is left behind in D1.
  // =======================================

  const access =
    await issueStaffAccessToken(
      env,
      authenticatedAccount,
      sessionId
    );


  // =======================================
  // PERSIST REFRESH SESSION
  // =======================================

  await insertStaffSession(
    env,
    {
      id:
        sessionId,

      accountId:
        authenticatedAccount.id,

      familyId,

      refreshTokenHash:
        refresh.refreshTokenHash,

      createdAt:
        now,

      expiresAt:
        refreshExpiresAt
    }
  );


  return {
    ok: true,

    staff:
      staffReceipt(
        authenticatedAccount
      ),

    accessToken:
      access.accessToken,

    accessExpiresAt:
      access.accessExpiresAt,

    refreshToken:
      refresh.refreshToken,

    refreshExpiresAt
  };
}


// =========================================
// REFRESH
// =========================================

export async function refreshStaff(
  env,
  refreshToken
) {

  let currentHash;


  try {

    currentHash =
      await hashRefreshToken(
        refreshToken
      );

  } catch (
    error
  ) {

    return invalidRefreshToken();
  }


  const now =
    Date.now();


  const currentSession =
    await getStaffSessionByRefreshTokenHash(
      env,
      currentHash
    );


  if (!currentSession) {

    return invalidRefreshToken();
  }


  // =======================================
  // REPLAY / REVOKED TOKEN
  // =======================================
  //
  // Reuse of a rotated/revoked refresh
  // token invalidates that token family.
  //
  // Access JWTs are bound to sid/session,
  // so family revocation also invalidates
  // access tokens belonging to revoked
  // sessions.
  // =======================================

  if (
    currentSession.revokedAt !==
      null
    ||
    currentSession
      .replacedBySessionId !==
      null
  ) {

    await revokeStaffSessionFamily(
      env,
      currentSession.familyId,
      now
    );


    return invalidRefreshToken();
  }


  // =======================================
  // ABSOLUTE EXPIRATION
  // =======================================

  if (
    !Number.isSafeInteger(
      currentSession.expiresAt
    )
    ||
    currentSession.expiresAt <=
      now
  ) {

    return invalidRefreshToken();
  }


  // =======================================
  // ACCOUNT
  // =======================================

  const account =
    await getStaffAccountById(
      env,
      currentSession.accountId
    );


  if (
    !account
    ||
    account.status !==
      "active"
  ) {

    await revokeStaffSessionFamily(
      env,
      currentSession.familyId,
      now
    );


    return invalidRefreshToken();
  }


  // =======================================
  // REPLACEMENT SESSION
  // =======================================

  const replacementSessionId =
    createRandomId(
      "staff-session"
    );


  const replacementRefresh =
    await createRefreshToken();


  // =======================================
  // ABSOLUTE FAMILY LIFETIME
  // =======================================
  //
  // Refresh rotation must NOT extend the
  // lifetime by another 30 days.
  //
  // Every descendant inherits the original
  // session-family expiration.
  //
  // Repository additionally enforces this
  // by copying current.expires_at directly
  // inside D1.
  // =======================================

  const replacementExpiresAt =
    currentSession.expiresAt;


  // =======================================
  // NEW ACCESS TOKEN
  // =======================================
  //
  // Sign before mutating D1.
  //
  // If JWT signing fails, no refresh
  // session state is modified.
  // =======================================

  const access =
    await issueStaffAccessToken(
      env,
      account,
      replacementSessionId
    );


  // =======================================
  // ATOMIC ROTATION
  // =======================================

  const rotation =
    await rotateStaffSession(
      env,
      currentHash,
      {
        id:
          replacementSessionId,

        refreshTokenHash:
          replacementRefresh
            .refreshTokenHash
      },
      now
    );


  if (
    rotation.ok !==
      true
  ) {

    // A concurrent reuse may have raced
    // between the initial read and the
    // atomic rotation.
    if (
      rotation.reason ===
        "revoked"
      &&
      rotation.session
        ?.familyId
    ) {

      await revokeStaffSessionFamily(
        env,
        rotation.session.familyId,
        now
      );
    }


    return invalidRefreshToken();
  }


  return {
    ok: true,

    staff:
      staffReceipt(
        account
      ),

    accessToken:
      access.accessToken,

    accessExpiresAt:
      access.accessExpiresAt,

    refreshToken:
      replacementRefresh
        .refreshToken,

    refreshExpiresAt:
      replacementExpiresAt
  };
}


// =========================================
// LOGOUT
// =========================================
//
// Logout is intentionally idempotent.
//
// Unknown or malformed refresh tokens do
// not reveal whether a session exists.
// =========================================

export async function logoutStaff(
  env,
  refreshToken
) {

  let hash;


  try {

    hash =
      await hashRefreshToken(
        refreshToken
      );

  } catch (
    error
  ) {

    return {
      ok: true
    };
  }


  await revokeStaffSession(
    env,
    hash,
    Date.now()
  );


  return {
    ok: true
  };
}