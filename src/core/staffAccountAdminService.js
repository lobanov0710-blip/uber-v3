// =========================================
// STAFF ACCOUNT ADMIN SERVICE
// =========================================
//
// Application layer for administrative
// staff-account management.
//
// Responsibilities:
//
// - require authenticated admin identity
// - validate API input
// - enforce driver-only management policy
// - enforce password policy
// - hash passwords before D1
// - generate secure account/audit ids
// - translate repository results into
//   safe API results
//
// This module NEVER:
//
// - stores plaintext passwords
// - returns password verifier data
// - allows API creation of admin accounts
// - allows API modification of admin
//   accounts
//
// D1 remains authoritative.
// =========================================


import {
  hashStaffPassword
} from "./staffAuthCrypto.js";

import {
  getStaffAccountSummaryById,
  getStaffAccountSummaryByLogin,
  listStaffAccountSummaries,
  createDriverAccountWithAudit,
  changeDriverStatusWithAudit,
  resetDriverPasswordWithAudit
} from "./staffAccountAdminRepository.js";


// =========================================
// POLICY
// =========================================

const LOGIN_PATTERN =
  /^[a-z0-9][a-z0-9._-]{2,63}$/;


const STAFF_ID_PATTERN =
  /^staff_[A-Za-z0-9_-]{8,94}$/;


const MANAGED_STATUSES =
  new Set([
    "active",
    "suspended",
    "disabled"
  ]);


const MIN_PASSWORD_LENGTH =
  16;


const MAX_PASSWORD_LENGTH =
  128;


const MAX_PASSWORD_BYTES =
  512;


const MAX_DISPLAY_NAME_LENGTH =
  100;


const encoder =
  new TextEncoder();


// =========================================
// RESULT HELPERS
// =========================================

function invalidRequest(
  error = "invalid request"
) {

  return {
    ok: false,
    status: 400,
    error
  };
}


function forbidden(
  error = "forbidden"
) {

  return {
    ok: false,
    status: 403,
    error
  };
}


function notFound(
  error = "staff account not found"
) {

  return {
    ok: false,
    status: 404,
    error
  };
}


function conflict(
  error = "staff account conflict"
) {

  return {
    ok: false,
    status: 409,
    error
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
// RANDOM ID
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
// ADMIN ACTOR
// =========================================
//
// Actor data comes from
// authenticateStaffRequest(), which has
// already reconstructed the principal from
// authoritative D1 state.
//
// This validation remains as defense in
// depth.
// =========================================

function requireAdminActor(
  actor
) {

  if (
    !actor
    ||
    typeof actor !== "object"
    ||
    Array.isArray(
      actor
    )
  ) {

    return null;
  }


  const id =
    String(
      actor.id ?? ""
    )
      .trim();


  const role =
    String(
      actor.role ?? ""
    )
      .trim()
      .toLowerCase();


  if (
    !STAFF_ID_PATTERN.test(
      id
    )
    ||
    role !== "admin"
  ) {

    return null;
  }


  return {
    id,
    role
  };
}


// =========================================
// TARGET ACCOUNT ID
// =========================================

function parseAccountId(
  value
) {

  const id =
    String(
      value ?? ""
    )
      .trim();


  if (
    !STAFF_ID_PATTERN.test(
      id
    )
  ) {

    return null;
  }


  return id;
}


// =========================================
// LOGIN
// =========================================

function parseLogin(
  value
) {

  const login =
    String(
      value ?? ""
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


  return login;
}


// =========================================
// DISPLAY NAME
// =========================================

function parseDisplayName(
  value
) {

  const displayName =
    String(
      value ?? ""
    )
      .trim();


  if (
    displayName.length < 1
    ||
    displayName.length >
      MAX_DISPLAY_NAME_LENGTH
  ) {

    return null;
  }


  if (
    /[\u0000-\u001F\u007F]/.test(
      displayName
    )
  ) {

    return null;
  }


  return displayName;
}


// =========================================
// PASSWORD
// =========================================

function parsePassword(
  value
) {

  if (
    typeof value !== "string"
  ) {

    return null;
  }


  if (
    value.length <
      MIN_PASSWORD_LENGTH
    ||
    value.length >
      MAX_PASSWORD_LENGTH
  ) {

    return null;
  }


  const bytes =
    encoder.encode(
      value
    );


  if (
    bytes.length >
      MAX_PASSWORD_BYTES
  ) {

    return null;
  }


  return value;
}


// =========================================
// STATUS
// =========================================

function parseManagedStatus(
  value
) {

  const status =
    String(
      value ?? ""
    )
      .trim()
      .toLowerCase();


  if (
    !MANAGED_STATUSES.has(
      status
    )
  ) {

    return null;
  }


  return status;
}


// =========================================
// CREATE INPUT
// =========================================

function parseCreateDriverInput(
  input
) {

  if (
    !input
    ||
    typeof input !== "object"
    ||
    Array.isArray(
      input
    )
  ) {

    return null;
  }


  // Role and status are deliberately not
  // client-selectable.
  //
  // Rejecting these fields avoids an API
  // contract where callers may mistakenly
  // believe they influence account
  // privileges.
  if (
    Object.hasOwn(
      input,
      "role"
    )
    ||
    Object.hasOwn(
      input,
      "status"
    )
  ) {

    return null;
  }


  const login =
    parseLogin(
      input.login
    );


  const displayName =
    parseDisplayName(
      input.displayName
    );


  const password =
    parsePassword(
      input.password
    );


  if (
    !login
    ||
    !displayName
    ||
    !password
  ) {

    return null;
  }


  return {
    login,
    displayName,
    password
  };
}


// =========================================
// ACCOUNT RECEIPT
// =========================================
//
// Repository summaries contain no password
// verifier data.
//
// Keep this mapping explicit so future
// repository fields do not automatically
// become public API fields.
// =========================================

function accountReceipt(
  account
) {

  return {
    id:
      account.id,

    login:
      account.login,

    displayName:
      account.displayName,

    role:
      account.role,

    status:
      account.status,

    tokenVersion:
      account.tokenVersion,

    createdAt:
      account.createdAt,

    updatedAt:
      account.updatedAt
  };
}


// =========================================
// LIST STAFF ACCOUNTS
// =========================================

export async function listStaffAccounts(
  env,
  actor
) {

  const admin =
    requireAdminActor(
      actor
    );


  if (!admin) {

    return forbidden();
  }


  const accounts =
    await listStaffAccountSummaries(
      env
    );


  return {
    ok: true,
    status: 200,

    count:
      accounts.length,

    staff:
      accounts.map(
        accountReceipt
      )
  };
}


// =========================================
// CREATE DRIVER ACCOUNT
// =========================================
//
// API-created accounts are always:
//
// role   = driver
// status = active
//
// The password is hashed before any
// repository call containing verifier data.
// =========================================

export async function createDriverAccount(
  env,
  actor,
  input
) {

  const admin =
    requireAdminActor(
      actor
    );


  if (!admin) {

    return forbidden();
  }


  const parsed =
    parseCreateDriverInput(
      input
    );


  if (!parsed) {

    return invalidRequest(
      "invalid staff account"
    );
  }


  let plaintextPassword =
    parsed.password;


  let passwordVerifier =
    null;


  // Remove unnecessary plaintext references
  // immediately after successful parsing.
  parsed.password =
    null;


  if (
    input
    &&
    typeof input === "object"
    &&
    !Array.isArray(
      input
    )
    &&
    Object.hasOwn(
      input,
      "password"
    )
  ) {

    input.password =
      null;
  }


  try {

    // Avoid expensive PBKDF2 work for an
    // already known login.
    //
    // Repository-side constraints still
    // protect against races.
    const existing =
      await getStaffAccountSummaryByLogin(
        env,
        parsed.login
      );


    if (existing) {

      return conflict(
        "staff login already exists"
      );
    }


    const targetAccountId =
      createRandomId(
        "staff"
      );


    const auditId =
      createRandomId(
        "staff-audit"
      );


    const now =
      Date.now();


    passwordVerifier =
      await hashStaffPassword(
        plaintextPassword
      );


    plaintextPassword =
      null;


    const result =
      await createDriverAccountWithAudit(
        env,
        {
          actorAccountId:
            admin.id,

          targetAccountId,

          auditId,

          login:
            parsed.login,

          displayName:
            parsed.displayName,

          passwordVerifier,

          createdAt:
            now
        }
      );


    if (
      result?.ok !== true
    ) {

      if (
        result?.reason ===
          "conflict"
      ) {

        return conflict(
          "staff account conflict"
        );
      }


      throw new Error(
        "Unexpected staff account creation result"
      );
    }


    return {
      ok: true,
      status: 201,

      staff:
        accountReceipt(
          result.account
        )
    };

  } finally {

    plaintextPassword =
      null;

    passwordVerifier =
      null;
  }
}


// =========================================
// CHANGE DRIVER STATUS
// =========================================

export async function changeDriverStatus(
  env,
  actor,
  targetAccountId,
  input
) {

  const admin =
    requireAdminActor(
      actor
    );


  if (!admin) {

    return forbidden();
  }


  const accountId =
    parseAccountId(
      targetAccountId
    );


  if (!accountId) {

    return invalidRequest(
      "invalid staff account id"
    );
  }


  if (
    !input
    ||
    typeof input !== "object"
    ||
    Array.isArray(
      input
    )
  ) {

    return invalidRequest(
      "invalid staff status"
    );
  }


  const newStatus =
    parseManagedStatus(
      input.status
    );


  if (!newStatus) {

    return invalidRequest(
      "invalid staff status"
    );
  }


  const current =
    await getStaffAccountSummaryById(
      env,
      accountId
    );


  if (!current) {

    return notFound();
  }


  // Admin accounts are deliberately outside
  // this management API.
  if (
    current.role !==
      "driver"
  ) {

    return forbidden(
      "staff account is not manageable"
    );
  }


  // PATCH is idempotent.
  //
  // Setting the already-current status does
  // not increment token_version and does
  // not create an audit event.
  if (
    current.status ===
      newStatus
  ) {

    return {
      ok: true,
      status: 200,
      changed: false,

      staff:
        accountReceipt(
          current
        )
    };
  }


  const result =
    await changeDriverStatusWithAudit(
      env,
      {
        actorAccountId:
          admin.id,

        targetAccountId:
          accountId,

        auditId:
          createRandomId(
            "staff-audit"
          ),

        expectedStatus:
          current.status,

        newStatus,

        expectedTokenVersion:
          current.tokenVersion,

        changedAt:
          Date.now()
      }
    );


  if (
    result?.ok === true
  ) {

    return {
      ok: true,
      status: 200,
      changed: true,

      staff:
        accountReceipt(
          result.account
        )
    };
  }


  if (
    result?.reason ===
      "not_found"
  ) {

    return notFound();
  }


  if (
    result?.reason ===
      "not_driver"
  ) {

    return forbidden(
      "staff account is not manageable"
    );
  }


  if (
    result?.reason ===
      "no_change"
    &&
    result.account
    &&
    result.account.status ===
      newStatus
  ) {

    return {
      ok: true,
      status: 200,
      changed: false,

      staff:
        accountReceipt(
          result.account
        )
    };
  }


  if (
    result?.reason ===
      "conflict"
  ) {

    return conflict();
  }


  throw new Error(
    "Unexpected staff status change result"
  );
}


// =========================================
// RESET DRIVER PASSWORD
// =========================================

export async function resetDriverPassword(
  env,
  actor,
  targetAccountId,
  input
) {

  const admin =
    requireAdminActor(
      actor
    );


  if (!admin) {

    return forbidden();
  }


  const accountId =
    parseAccountId(
      targetAccountId
    );


  if (!accountId) {

    return invalidRequest(
      "invalid staff account id"
    );
  }


  if (
    !input
    ||
    typeof input !== "object"
    ||
    Array.isArray(
      input
    )
  ) {

    return invalidRequest(
      "invalid password"
    );
  }


  let plaintextPassword =
    parsePassword(
      input.password
    );


  if (!plaintextPassword) {

    return invalidRequest(
      "password must contain 16-128 characters"
    );
  }


  let passwordVerifier =
    null;


  // Service owns this request value from
  // this point forward. Do not keep the
  // original plaintext reference around.
  if (
    Object.hasOwn(
      input,
      "password"
    )
  ) {

    input.password =
      null;
  }


  try {

    const current =
      await getStaffAccountSummaryById(
        env,
        accountId
      );


    if (!current) {

      return notFound();
    }


    // Password management for admin accounts
    // remains outside this API.
    if (
      current.role !==
        "driver"
    ) {

      return forbidden(
        "staff account is not manageable"
      );
    }


    passwordVerifier =
      await hashStaffPassword(
        plaintextPassword
      );


    plaintextPassword =
      null;


    const result =
      await resetDriverPasswordWithAudit(
        env,
        {
          actorAccountId:
            admin.id,

          targetAccountId:
            accountId,

          auditId:
            createRandomId(
              "staff-audit"
            ),

          expectedTokenVersion:
            current.tokenVersion,

          passwordVerifier,

          changedAt:
            Date.now()
        }
      );


    if (
      result?.ok === true
    ) {

      return {
        ok: true,
        status: 200,

        staff:
          accountReceipt(
            result.account
          )
      };
    }


    if (
      result?.reason ===
        "not_found"
    ) {

      return notFound();
    }


    if (
      result?.reason ===
        "not_driver"
    ) {

      return forbidden(
        "staff account is not manageable"
      );
    }


    if (
      result?.reason ===
        "conflict"
    ) {

      return conflict();
    }


    throw new Error(
      "Unexpected staff password reset result"
    );

  } finally {

    plaintextPassword =
      null;

    passwordVerifier =
      null;
  }
}