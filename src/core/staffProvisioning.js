// =========================================
// STAFF PROVISIONING
// =========================================
//
// Secure offline provisioning primitives.
//
// Used to bootstrap the first administrator
// without exposing a public registration
// endpoint.
//
// This module:
//
// - validates account data
// - hashes password locally
// - creates an active admin account entity
// - generates INSERT-only SQL
//
// This module NEVER:
//
// - stores plaintext password
// - talks directly to production D1
// - creates public registration routes
// - overwrites existing accounts
// =========================================

import {
  STAFF_PASSWORD_ALGORITHM,
  STAFF_PASSWORD_ITERATIONS,
  hashStaffPassword
} from "./staffAuthCrypto.js";


// =========================================
// POLICY
// =========================================

const LOGIN_PATTERN =
  /^[a-z0-9][a-z0-9._-]{2,63}$/;

const STAFF_ID_PATTERN =
  /^staff_[A-Za-z0-9_-]{8,94}$/;

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
// LOGIN
// =========================================

function requireLogin(
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

    throw new Error(
      "Invalid staff provisioning login"
    );
  }


  return login;
}


// =========================================
// STAFF ID
// =========================================

function requireStaffId(
  value
) {

  const id =
    String(
      value ?? ""
    )
      .trim();


  // D1 migration allows:
  //
  // length(id) BETWEEN 1 AND 100
  //
  // Prefix "staff_" occupies 6 chars,
  // therefore suffix is capped at 94.
  if (
    !STAFF_ID_PATTERN.test(
      id
    )
  ) {

    throw new Error(
      "Invalid staff provisioning id"
    );
  }


  return id;
}


// =========================================
// DISPLAY NAME
// =========================================

function requireDisplayName(
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

    throw new Error(
      "Invalid staff provisioning displayName"
    );
  }


  if (
    /[\u0000-\u001F\u007F]/.test(
      displayName
    )
  ) {

    throw new Error(
      "Invalid staff provisioning displayName"
    );
  }


  return displayName;
}


// =========================================
// PASSWORD
// =========================================

function requirePassword(
  value
) {

  if (
    typeof value !==
      "string"
  ) {

    throw new Error(
      "Invalid staff provisioning password"
    );
  }


  if (
    value.length <
      MIN_PASSWORD_LENGTH
    ||
    value.length >
      MAX_PASSWORD_LENGTH
  ) {

    throw new Error(
      "Staff provisioning password must contain 16-128 characters"
    );
  }


  const bytes =
    encoder.encode(
      value
    );


  if (
    bytes.length >
      MAX_PASSWORD_BYTES
  ) {

    throw new Error(
      "Staff provisioning password is too large"
    );
  }


  return value;
}


// =========================================
// SQL STRING
// =========================================

function sqlString(
  value
) {

  return (
    "'" +
    String(
      value
    )
      .replace(
        /'/g,
        "''"
      ) +
    "'"
  );
}


// =========================================
// TIMESTAMP
// =========================================

function requireTimestamp(
  value
) {

  const timestamp =
    Number(
      value
    );


  if (
    !Number.isSafeInteger(
      timestamp
    )
    ||
    timestamp <= 0
  ) {

    throw new Error(
      "Invalid staff provisioning timestamp"
    );
  }


  return timestamp;
}


// =========================================
// PASSWORD VERIFIER
// =========================================
//
// Bootstrap provisioning accepts only the
// current production password policy.
//
// Verification and provisioning both use
// the exact Cloudflare-compatible work
// factor.
//
// New bootstrap accounts must always use:
//
// PBKDF2-HMAC-SHA256
// 100,000 iterations
// 16-byte random salt
// 32-byte derived key
// =========================================

function requireBootstrapPasswordVerifier(
  value
) {

  if (
    !value
    ||
    typeof value !==
      "object"
    ||
    Array.isArray(
      value
    )
  ) {

    throw new Error(
      "Invalid staff provisioning password verifier"
    );
  }


  if (
    value.passwordAlgorithm !==
      STAFF_PASSWORD_ALGORITHM
  ) {

    throw new Error(
      "Invalid staff provisioning password verifier"
    );
  }


  if (
    value.passwordIterations !==
      STAFF_PASSWORD_ITERATIONS
  ) {

    throw new Error(
      "Invalid staff provisioning password verifier"
    );
  }


  const passwordSalt =
    String(
      value.passwordSalt ?? ""
    );


  const passwordHash =
    String(
      value.passwordHash ?? ""
    );


  if (
    !/^[A-Za-z0-9_-]{22}$/.test(
      passwordSalt
    )
    ||
    !/^[A-Za-z0-9_-]{43}$/.test(
      passwordHash
    )
  ) {

    throw new Error(
      "Invalid staff provisioning password verifier"
    );
  }


  return {
    passwordAlgorithm:
      value.passwordAlgorithm,

    passwordIterations:
      value.passwordIterations,

    passwordSalt,

    passwordHash
  };
}


// =========================================
// CREATE ADMIN ACCOUNT ENTITY
// =========================================
//
// Bootstrap role is intentionally
// hard-coded to:
//
// role   = admin
// status = active
//
// Caller input cannot select another role
// or account state.
// =========================================

export async function createAdminBootstrapAccount(
  {
    login,
    displayName,
    password
  },
  options = {}
) {

  const normalizedLogin =
    requireLogin(
      login
    );


  const normalizedDisplayName =
    requireDisplayName(
      displayName
    );


  const plaintextPassword =
    requirePassword(
      password
    );


  const crypto =
    requireCrypto();


  const generatedId =
    options.id
      ? options.id
      : `staff_${crypto.randomUUID()}`;


  const id =
    requireStaffId(
      generatedId
    );


  const timestamp =
    requireTimestamp(
      options.now ??
        Date.now()
    );


  // hashStaffPassword() itself enforces
  // the fixed production work factor.
  const passwordVerifier =
    await hashStaffPassword(
      plaintextPassword
    );


  // Defense in depth:
  //
  // Even if password hashing changes in a
  // future refactor, provisioning will
  // reject a verifier that does not match
  // the frozen bootstrap policy.
  const validatedVerifier =
    requireBootstrapPasswordVerifier(
      passwordVerifier
    );


  return {
    id,

    login:
      normalizedLogin,

    displayName:
      normalizedDisplayName,

    role:
      "admin",

    status:
      "active",

    passwordVerifier:
      validatedVerifier,

    tokenVersion:
      1,

    passwordChangedAt:
      timestamp,

    createdAt:
      timestamp,

    updatedAt:
      timestamp
  };
}


// =========================================
// BUILD INSERT SQL
// =========================================
//
// INSERT only.
//
// No:
//
// - REPLACE
// - UPSERT
// - UPDATE
//
// Existing id/login therefore causes D1
// to reject provisioning instead of
// silently replacing an account.
//
// This function also revalidates the full
// entity because callers must not be able
// to bypass createAdminBootstrapAccount()
// by constructing an arbitrary object.
// =========================================

export function buildStaffAccountInsertSql(
  account
) {

  if (
    !account
    ||
    typeof account !==
      "object"
    ||
    Array.isArray(
      account
    )
  ) {

    throw new Error(
      "Invalid staff provisioning account"
    );
  }


  const id =
    requireStaffId(
      account.id
    );


  const login =
    requireLogin(
      account.login
    );


  const displayName =
    requireDisplayName(
      account.displayName
    );


  if (
    account.role !==
      "admin"
    ||
    account.status !==
      "active"
  ) {

    throw new Error(
      "Invalid bootstrap account role/status"
    );
  }


  const verifier =
    requireBootstrapPasswordVerifier(
      account.passwordVerifier
    );


  const tokenVersion =
    Number(
      account.tokenVersion
    );


  if (
    !Number.isSafeInteger(
      tokenVersion
    )
    ||
    tokenVersion !== 1
  ) {

    throw new Error(
      "Invalid staff provisioning tokenVersion"
    );
  }


  const passwordChangedAt =
    requireTimestamp(
      account.passwordChangedAt
    );


  const createdAt =
    requireTimestamp(
      account.createdAt
    );


  const updatedAt =
    requireTimestamp(
      account.updatedAt
    );


  // Initial bootstrap account is created
  // as one atomic logical entity.
  //
  // These timestamps must therefore start
  // with the same value.
  if (
    passwordChangedAt !==
      createdAt
    ||
    updatedAt !==
      createdAt
  ) {

    throw new Error(
      "Invalid staff provisioning timestamps"
    );
  }


  return `
INSERT INTO staff_accounts (
  id,
  login,
  display_name,
  role,
  status,
  password_algorithm,
  password_iterations,
  password_salt,
  password_hash,
  token_version,
  failed_login_count,
  locked_until,
  last_failed_login_at,
  last_login_at,
  password_changed_at,
  created_at,
  updated_at
)
VALUES (
  ${sqlString(id)},
  ${sqlString(login)},
  ${sqlString(displayName)},
  'admin',
  'active',
  ${sqlString(
    verifier.passwordAlgorithm
  )},
  ${verifier.passwordIterations},
  ${sqlString(
    verifier.passwordSalt
  )},
  ${sqlString(
    verifier.passwordHash
  )},
  1,
  0,
  NULL,
  NULL,
  NULL,
  ${passwordChangedAt},
  ${createdAt},
  ${updatedAt}
);
`.trim() + "\n";
}