// =========================================
// STAFF AUTHORIZATION
// =========================================
//
// A valid JWT signature alone is NOT
// sufficient for staff authorization.
//
// Every private staff request must verify:
//
// 1. JWT signature + expiration
// 2. scope === "staff"
// 3. sub === id
// 4. role is driver/admin
// 5. tokenVersion is valid
// 6. sid is present
// 7. staff account exists in D1
// 8. account status === active
// 9. JWT role matches authoritative D1 role
// 10. JWT tokenVersion matches D1
// 11. referenced D1 session exists
// 12. session belongs to account
// 13. session is not revoked
// 14. session was not rotated/replaced
// 15. session is not expired
//
// Returned user identity is constructed
// from authoritative D1 state, not from
// JWT role/account fields.
// =========================================

import {
  authenticateRequest
} from "./auth.js";

import {
  getStaffAccountById,
  getStaffSessionById
} from "./staffAuthRepository.js";


// =========================================
// CONSTANTS
// =========================================

const STAFF_ROLES =
  new Set([
    "driver",
    "admin"
  ]);


// =========================================
// FAILURE RESULTS
// =========================================

function invalidStaffToken() {

  return {
    ok: false,
    status: 401,
    error:
      "invalid or revoked staff token"
  };
}


function authorizationFailure() {

  return {
    ok: false,
    status: 500,
    error:
      "staff authorization failed"
  };
}


// =========================================
// REQUIRED TEXT
// =========================================

function normalizedText(
  value
) {

  return String(
    value ?? ""
  )
    .trim();
}


// =========================================
// TOKEN CLAIMS
// =========================================

function parseStaffClaims(
  payload
) {

  if (
    !payload
    ||
    typeof payload !==
      "object"
    ||
    Array.isArray(
      payload
    )
  ) {

    return null;
  }


  const scope =
    normalizedText(
      payload.scope
    );


  if (
    scope !==
      "staff"
  ) {

    return null;
  }


  const sub =
    normalizedText(
      payload.sub
    );


  const id =
    normalizedText(
      payload.id
    );


  if (
    !sub
    ||
    !id
    ||
    sub !== id
  ) {

    return null;
  }


  const role =
    normalizedText(
      payload.role
    )
      .toLowerCase();


  if (
    !STAFF_ROLES.has(
      role
    )
  ) {

    return null;
  }


  const tokenVersion =
    Number(
      payload.tokenVersion
    );


  if (
    !Number.isSafeInteger(
      tokenVersion
    )
    ||
    tokenVersion <= 0
  ) {

    return null;
  }


  const sessionId =
    normalizedText(
      payload.sid
    );


  if (!sessionId) {

    return null;
  }


  return {
    accountId:
      id,

    role,

    tokenVersion,

    sessionId
  };
}


// =========================================
// AUTHENTICATE STAFF REQUEST
// =========================================

export async function authenticateStaffRequest(
  request,
  env
) {

  // =======================================
  // JWT SIGNATURE + EXPIRATION
  // =======================================

  const jwtAuth =
    await authenticateRequest(
      request,
      env
    );


  if (
    jwtAuth.ok !== true
  ) {

    return jwtAuth;
  }


  // =======================================
  // STAFF CLAIM SHAPE
  // =======================================

  const claims =
    parseStaffClaims(
      jwtAuth.user
    );


  if (!claims) {

    return invalidStaffToken();
  }


  let account;
  let session;


  try {

    // =====================================
    // AUTHORITATIVE ACCOUNT
    // =====================================

    account =
      await getStaffAccountById(
        env,
        claims.accountId
      );


    if (!account) {

      return invalidStaffToken();
    }


    // =====================================
    // ACCOUNT STATUS
    // =====================================

    if (
      String(
        account.status ?? ""
      )
        .trim()
        .toLowerCase()
      !==
      "active"
    ) {

      return invalidStaffToken();
    }


    // =====================================
    // AUTHORITATIVE ROLE
    // =====================================

    const authoritativeRole =
      String(
        account.role ?? ""
      )
        .trim()
        .toLowerCase();


    if (
      !STAFF_ROLES.has(
        authoritativeRole
      )
      ||
      authoritativeRole !==
        claims.role
    ) {

      return invalidStaffToken();
    }


    // =====================================
    // TOKEN VERSION
    // =====================================

    const authoritativeTokenVersion =
      Number(
        account.tokenVersion
      );


    if (
      !Number.isSafeInteger(
        authoritativeTokenVersion
      )
      ||
      authoritativeTokenVersion <= 0
      ||
      authoritativeTokenVersion !==
        claims.tokenVersion
    ) {

      return invalidStaffToken();
    }


    // =====================================
    // AUTHORITATIVE SESSION
    // =====================================

    session =
      await getStaffSessionById(
        env,
        claims.sessionId
      );


    if (!session) {

      return invalidStaffToken();
    }


    // =====================================
    // SESSION OWNERSHIP
    // =====================================

    if (
      String(
        session.accountId ?? ""
      )
      !==
      account.id
    ) {

      return invalidStaffToken();
    }


    // =====================================
    // SESSION REVOCATION
    // =====================================

    if (
      session.revokedAt !==
        null
    ) {

      return invalidStaffToken();
    }


    // =====================================
    // ROTATED SESSION
    // =====================================

    if (
      session.replacedBySessionId !==
        null
    ) {

      return invalidStaffToken();
    }


    // =====================================
    // SESSION EXPIRATION
    // =====================================

    const expiresAt =
      Number(
        session.expiresAt
      );


    if (
      !Number.isSafeInteger(
        expiresAt
      )
      ||
      expiresAt <=
        Date.now()
    ) {

      return invalidStaffToken();
    }

  } catch (
    error
  ) {

    console.error(
      "STAFF AUTHORIZATION ERROR:",
      error
    );


    return authorizationFailure();
  }


  // =======================================
  // AUTHORITATIVE PRINCIPAL
  // =======================================
  //
  // Do not pass the JWT payload forward as
  // the authenticated user.
  //
  // Staff identity/role/version below come
  // from current D1 state.
  // =======================================

  return {
    ok: true,

    token:
      jwtAuth.token,

    user: {
      id:
        account.id,

      displayName:
        account.displayName,

      role:
        account.role,

      tokenVersion:
        account.tokenVersion,

      sessionId:
        session.id
    },

    account,
    session
  };
}