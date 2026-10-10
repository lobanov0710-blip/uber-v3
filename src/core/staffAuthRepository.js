// =========================================
// STAFF AUTH REPOSITORY
// Cloudflare D1
// =========================================
//
// Security-critical staff authentication
// state.
//
// D1 is authoritative for:
//
// - staff identity
// - role
// - account status
// - password verifier metadata
// - token version
// - login failure counters
// - temporary login lock
// - refresh sessions
// - refresh-token rotation/revocation
//
// Password plaintext and refresh-token
// plaintext NEVER reach D1.
// =========================================


// =========================================
// CONSTANTS
// =========================================

const STAFF_ROLES =
  new Set([
    "driver",
    "admin"
  ]);


const STAFF_STATUSES =
  new Set([
    "pending",
    "active",
    "suspended",
    "disabled"
  ]);


const PASSWORD_ALGORITHM =
  "pbkdf2-sha256";


export const STAFF_LOGIN_LOCK_THRESHOLD =
  5;


export const STAFF_LOGIN_LOCK_DURATION_MS =
  15 * 60 * 1000;


// =========================================
// DATABASE
// =========================================

function requireDatabase(
  env
) {

  if (!env?.DB) {

    throw new Error(
      "D1 DB binding is not configured"
    );
  }


  return env.DB;
}


// =========================================
// TEXT
// =========================================

function requiredText(
  value,
  field
) {

  const text =
    String(
      value ?? ""
    )
      .trim();


  if (!text) {

    throw new Error(
      `Invalid staff ${field}`
    );
  }


  return text;
}


// =========================================
// LOGIN
// =========================================

function normalizeLogin(
  value
) {

  return requiredText(
    value,
    "login"
  )
    .toLowerCase();
}


// =========================================
// INTEGER
// =========================================

function requiredPositiveInteger(
  value,
  field
) {

  const number =
    Number(
      value
    );


  if (
    !Number.isSafeInteger(
      number
    )
    ||
    number <= 0
  ) {

    throw new Error(
      `Invalid staff ${field}`
    );
  }


  return number;
}


// =========================================
// TIMESTAMP
// =========================================

function requiredTimestamp(
  value,
  field
) {

  return requiredPositiveInteger(
    value,
    field
  );
}


// =========================================
// ROLE
// =========================================

function requireRole(
  value
) {

  const role =
    requiredText(
      value,
      "role"
    )
      .toLowerCase();


  if (
    !STAFF_ROLES.has(
      role
    )
  ) {

    throw new Error(
      "Invalid staff role"
    );
  }


  return role;
}


// =========================================
// STATUS
// =========================================

function requireStatus(
  value
) {

  const status =
    requiredText(
      value,
      "status"
    )
      .toLowerCase();


  if (
    !STAFF_STATUSES.has(
      status
    )
  ) {

    throw new Error(
      "Invalid staff status"
    );
  }


  return status;
}


// =========================================
// PASSWORD VERIFIER
// =========================================

function requirePasswordVerifier(
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
      "Invalid staff password verifier"
    );
  }


  const passwordAlgorithm =
    requiredText(
      value.passwordAlgorithm,
      "passwordAlgorithm"
    )
      .toLowerCase();


  if (
    passwordAlgorithm !==
      PASSWORD_ALGORITHM
  ) {

    throw new Error(
      "Invalid staff password algorithm"
    );
  }


  const passwordIterations =
    requiredPositiveInteger(
      value.passwordIterations,
      "passwordIterations"
    );


  if (
    passwordIterations <
      100000
    ||
    passwordIterations >
      5000000
  ) {

    throw new Error(
      "Invalid staff passwordIterations"
    );
  }


  const passwordSalt =
    requiredText(
      value.passwordSalt,
      "passwordSalt"
    );


  const passwordHash =
    requiredText(
      value.passwordHash,
      "passwordHash"
    );


  return {
    passwordAlgorithm,
    passwordIterations,
    passwordSalt,
    passwordHash
  };
}


// =========================================
// REFRESH TOKEN HASH
// =========================================
//
// SHA-256 digest encoded as unpadded
// base64url:
//
// 32 bytes -> 43 characters.
// =========================================

function requireRefreshTokenHash(
  value
) {

  const hash =
    requiredText(
      value,
      "refreshTokenHash"
    );


  if (
    !/^[A-Za-z0-9_-]{43}$/.test(
      hash
    )
  ) {

    throw new Error(
      "Invalid staff refreshTokenHash"
    );
  }


  return hash;
}


// =========================================
// ACCOUNT ROW -> DOMAIN
// =========================================

function mapStaffAccountRow(
  row
) {

  if (
    !row
    ||
    typeof row !==
      "object"
  ) {

    return null;
  }


  return {
    id:
      String(
        row.id
      ),

    login:
      String(
        row.login
      ),

    displayName:
      String(
        row.display_name
      ),

    role:
      String(
        row.role
      ),

    status:
      String(
        row.status
      ),

    passwordVerifier: {

      passwordAlgorithm:
        String(
          row.password_algorithm
        ),

      passwordIterations:
        Number(
          row.password_iterations
        ),

      passwordSalt:
        String(
          row.password_salt
        ),

      passwordHash:
        String(
          row.password_hash
        )
    },

    tokenVersion:
      Number(
        row.token_version
      ),

    failedLoginCount:
      Number(
        row.failed_login_count
      ),

    lockedUntil:
      row.locked_until === null
        ? null
        : Number(
            row.locked_until
          ),

    lastFailedLoginAt:
      row.last_failed_login_at === null
        ? null
        : Number(
            row.last_failed_login_at
          ),

    lastLoginAt:
      row.last_login_at === null
        ? null
        : Number(
            row.last_login_at
          ),

    passwordChangedAt:
      Number(
        row.password_changed_at
      ),

    createdAt:
      Number(
        row.created_at
      ),

    updatedAt:
      Number(
        row.updated_at
      )
  };
}


// =========================================
// SESSION ROW -> DOMAIN
// =========================================

function mapStaffSessionRow(
  row
) {

  if (
    !row
    ||
    typeof row !==
      "object"
  ) {

    return null;
  }


  return {
    id:
      String(
        row.id
      ),

    accountId:
      String(
        row.account_id
      ),

    familyId:
      String(
        row.family_id
      ),

    refreshTokenHash:
      String(
        row.refresh_token_hash
      ),

    createdAt:
      Number(
        row.created_at
      ),

    expiresAt:
      Number(
        row.expires_at
      ),

    lastUsedAt:
      row.last_used_at === null
        ? null
        : Number(
            row.last_used_at
          ),

    revokedAt:
      row.revoked_at === null
        ? null
        : Number(
            row.revoked_at
          ),

    replacedBySessionId:
      row.replaced_by_session_id === null
        ? null
        : String(
            row.replaced_by_session_id
          )
  };
}


// =========================================
// COMMON ACCOUNT SELECT
// =========================================

const STAFF_ACCOUNT_SELECT = `
  SELECT
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
  FROM staff_accounts
`;


// =========================================
// COMMON SESSION SELECT
// =========================================

const STAFF_SESSION_SELECT = `
  SELECT
    id,
    account_id,
    family_id,
    refresh_token_hash,
    created_at,
    expires_at,
    last_used_at,
    revoked_at,
    replaced_by_session_id
  FROM staff_sessions
`;


// =========================================
// D1 RESULT
// =========================================

function requireRunResult(
  result,
  {
    maxChanges = null
  } = {}
) {

  if (
    result?.success !== true
  ) {

    throw new Error(
      "Staff D1 operation failed"
    );
  }


  const changes =
    Number(
      result?.meta?.changes
    );


  if (
    !Number.isSafeInteger(
      changes
    )
    ||
    changes < 0
  ) {

    throw new Error(
      "Invalid staff D1 operation result"
    );
  }


  if (
    maxChanges !== null
    &&
    changes >
      maxChanges
  ) {

    throw new Error(
      "Invalid staff D1 change count"
    );
  }


  return changes;
}


// =========================================
// GET ACCOUNT BY ID
// =========================================

export async function getStaffAccountById(
  env,
  accountId
) {

  const id =
    String(
      accountId ?? ""
    )
      .trim();


  if (!id) {

    return null;
  }


  const db =
    requireDatabase(
      env
    );


  const row =
    await db
      .prepare(`
        ${STAFF_ACCOUNT_SELECT}

        WHERE id = ?1

        LIMIT 1
      `)
      .bind(
        id
      )
      .first();


  return mapStaffAccountRow(
    row
  );
}


// =========================================
// GET ACCOUNT BY LOGIN
// =========================================

export async function getStaffAccountByLogin(
  env,
  login
) {

  const normalizedLogin =
    String(
      login ?? ""
    )
      .trim()
      .toLowerCase();


  if (!normalizedLogin) {

    return null;
  }


  const db =
    requireDatabase(
      env
    );


  const row =
    await db
      .prepare(`
        ${STAFF_ACCOUNT_SELECT}

        WHERE login = ?1

        LIMIT 1
      `)
      .bind(
        normalizedLogin
      )
      .first();


  return mapStaffAccountRow(
    row
  );
}


// =========================================
// CREATE STAFF ACCOUNT
// =========================================
//
// Caller must supply verifier data produced
// by hashStaffPassword().
//
// No plaintext password parameter exists.
// =========================================

export async function insertStaffAccount(
  env,
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
      "Invalid staff account"
    );
  }


  const db =
    requireDatabase(
      env
    );


  const id =
    requiredText(
      account.id,
      "id"
    );


  const login =
    normalizeLogin(
      account.login
    );


  const displayName =
    requiredText(
      account.displayName,
      "displayName"
    );


  const role =
    requireRole(
      account.role
    );


  const status =
    requireStatus(
      account.status ??
        "pending"
    );


  const verifier =
    requirePasswordVerifier(
      account.passwordVerifier
    );


  const tokenVersion =
    requiredPositiveInteger(
      account.tokenVersion ??
        1,
      "tokenVersion"
    );


  const passwordChangedAt =
    requiredTimestamp(
      account.passwordChangedAt,
      "passwordChangedAt"
    );


  const createdAt =
    requiredTimestamp(
      account.createdAt,
      "createdAt"
    );


  const updatedAt =
    requiredTimestamp(
      account.updatedAt ??
        createdAt,
      "updatedAt"
    );


  if (
    updatedAt <
      createdAt
  ) {

    throw new Error(
      "Invalid staff updatedAt"
    );
  }


  const result =
    await db
      .prepare(`
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
          ?1,
          ?2,
          ?3,
          ?4,
          ?5,
          ?6,
          ?7,
          ?8,
          ?9,
          ?10,
          0,
          NULL,
          NULL,
          NULL,
          ?11,
          ?12,
          ?13
        )
      `)
      .bind(
        id,
        login,
        displayName,
        role,
        status,
        verifier.passwordAlgorithm,
        verifier.passwordIterations,
        verifier.passwordSalt,
        verifier.passwordHash,
        tokenVersion,
        passwordChangedAt,
        createdAt,
        updatedAt
      )
      .run();


  const changes =
    requireRunResult(
      result,
      {
        maxChanges:
          1
      }
    );


  if (
    changes !== 1
  ) {

    throw new Error(
      "Invalid staff account insert result"
    );
  }


  const persisted =
    await getStaffAccountById(
      env,
      id
    );


  if (!persisted) {

    throw new Error(
      "Staff account readback failed"
    );
  }


  return persisted;
}


// =========================================
// COMPLETE ACCOUNT UPDATE
// =========================================

async function completeAccountUpdate(
  env,
  accountId,
  result
) {

  const changes =
    requireRunResult(
      result,
      {
        maxChanges:
          1
      }
    );


  const account =
    await getStaffAccountById(
      env,
      accountId
    );


  if (
    changes === 1
  ) {

    if (!account) {

      throw new Error(
        "Staff account update readback failed"
      );
    }


    return account;
  }


  if (!account) {

    return null;
  }


  throw new Error(
    "Staff account update conflict"
  );
}


// =========================================
// FAILED LOGIN
// =========================================

export async function recordStaffLoginFailure(
  env,
  accountId,
  options = {}
) {

  const id =
    requiredText(
      accountId,
      "id"
    );


  const failedAt =
    requiredTimestamp(
      options.failedAt ??
        Date.now(),
      "failedAt"
    );


  const lockThreshold =
    requiredPositiveInteger(
      options.lockThreshold ??
        STAFF_LOGIN_LOCK_THRESHOLD,
      "lockThreshold"
    );


  if (
    lockThreshold >
      100
  ) {

    throw new Error(
      "Invalid staff lockThreshold"
    );
  }


  const lockDurationMs =
    requiredPositiveInteger(
      options.lockDurationMs ??
        STAFF_LOGIN_LOCK_DURATION_MS,
      "lockDurationMs"
    );


  const lockedUntil =
    failedAt +
    lockDurationMs;


  if (
    !Number.isSafeInteger(
      lockedUntil
    )
  ) {

    throw new Error(
      "Invalid staff lockedUntil"
    );
  }


  const db =
    requireDatabase(
      env
    );


  const result =
    await db
      .prepare(`
        UPDATE staff_accounts

        SET
          failed_login_count =
            CASE
              WHEN locked_until IS NOT NULL
                AND locked_until <= ?2
              THEN 1

              ELSE
                failed_login_count + 1
            END,

          last_failed_login_at =
            ?2,

          locked_until =
            CASE
              WHEN locked_until IS NOT NULL
                AND locked_until > ?2
              THEN locked_until

              WHEN (
                CASE
                  WHEN locked_until IS NOT NULL
                    AND locked_until <= ?2
                  THEN 1

                  ELSE
                    failed_login_count + 1
                END
              ) >= ?3
              THEN ?4

              ELSE NULL
            END,

          updated_at =
            CASE
              WHEN updated_at >= ?2
              THEN updated_at + 1

              ELSE ?2
            END

        WHERE id = ?1
      `)
      .bind(
        id,
        failedAt,
        lockThreshold,
        lockedUntil
      )
      .run();


  return completeAccountUpdate(
    env,
    id,
    result
  );
}


// =========================================
// SUCCESSFUL LOGIN
// =========================================

export async function recordStaffLoginSuccess(
  env,
  accountId,
  loginAt = Date.now()
) {

  const id =
    requiredText(
      accountId,
      "id"
    );


  const timestamp =
    requiredTimestamp(
      loginAt,
      "loginAt"
    );


  const db =
    requireDatabase(
      env
    );


  const result =
    await db
      .prepare(`
        UPDATE staff_accounts

        SET
          failed_login_count = 0,
          locked_until = NULL,
          last_login_at = ?2,

          updated_at =
            CASE
              WHEN updated_at >= ?2
              THEN updated_at + 1

              ELSE ?2
            END

        WHERE id = ?1
      `)
      .bind(
        id,
        timestamp
      )
      .run();


  return completeAccountUpdate(
    env,
    id,
    result
  );
}


// =========================================
// TOKEN VERSION
// =========================================

export async function incrementStaffTokenVersion(
  env,
  accountId,
  updatedAt = Date.now()
) {

  const id =
    requiredText(
      accountId,
      "id"
    );


  const timestamp =
    requiredTimestamp(
      updatedAt,
      "updatedAt"
    );


  const db =
    requireDatabase(
      env
    );


  const result =
    await db
      .prepare(`
        UPDATE staff_accounts

        SET
          token_version =
            token_version + 1,

          updated_at =
            CASE
              WHEN updated_at >= ?2
              THEN updated_at + 1

              ELSE ?2
            END

        WHERE id = ?1
      `)
      .bind(
        id,
        timestamp
      )
      .run();


  return completeAccountUpdate(
    env,
    id,
    result
  );
}


// =========================================
// GET SESSION BY ID
// =========================================

export async function getStaffSessionById(
  env,
  sessionId
) {

  const id =
    String(
      sessionId ?? ""
    )
      .trim();


  if (!id) {

    return null;
  }


  const db =
    requireDatabase(
      env
    );


  const row =
    await db
      .prepare(`
        ${STAFF_SESSION_SELECT}

        WHERE id = ?1

        LIMIT 1
      `)
      .bind(
        id
      )
      .first();


  return mapStaffSessionRow(
    row
  );
}


// =========================================
// GET SESSION BY REFRESH HASH
// =========================================
//
// Lookup accepts only the SHA-256 digest.
//
// Plaintext refresh-token must be hashed
// in staffAuthCrypto before this function
// is called.
// =========================================

export async function getStaffSessionByRefreshTokenHash(
  env,
  refreshTokenHash
) {

  const hash =
    requireRefreshTokenHash(
      refreshTokenHash
    );


  const db =
    requireDatabase(
      env
    );


  const row =
    await db
      .prepare(`
        ${STAFF_SESSION_SELECT}

        WHERE refresh_token_hash = ?1

        LIMIT 1
      `)
      .bind(
        hash
      )
      .first();


  return mapStaffSessionRow(
    row
  );
}


// =========================================
// INSERT SESSION
// =========================================
//
// Used after successful login.
//
// The caller creates:
//
// - session id
// - family id
// - plaintext refresh token
// - SHA-256 refresh-token hash
//
// Only the HASH is supplied here.
// =========================================

export async function insertStaffSession(
  env,
  session
) {

  if (
    !session
    ||
    typeof session !==
      "object"
    ||
    Array.isArray(
      session
    )
  ) {

    throw new Error(
      "Invalid staff session"
    );
  }


  const id =
    requiredText(
      session.id,
      "sessionId"
    );


  const accountId =
    requiredText(
      session.accountId,
      "accountId"
    );


  const familyId =
    requiredText(
      session.familyId,
      "familyId"
    );


  const refreshTokenHash =
    requireRefreshTokenHash(
      session.refreshTokenHash
    );


  const createdAt =
    requiredTimestamp(
      session.createdAt,
      "sessionCreatedAt"
    );


  const expiresAt =
    requiredTimestamp(
      session.expiresAt,
      "sessionExpiresAt"
    );


  if (
    expiresAt <=
      createdAt
  ) {

    throw new Error(
      "Invalid staff session expiry"
    );
  }


  const db =
    requireDatabase(
      env
    );


  const result =
    await db
      .prepare(`
        INSERT INTO staff_sessions (
          id,
          account_id,
          family_id,
          refresh_token_hash,
          created_at,
          expires_at,
          last_used_at,
          revoked_at,
          replaced_by_session_id
        )
        VALUES (
          ?1,
          ?2,
          ?3,
          ?4,
          ?5,
          ?6,
          NULL,
          NULL,
          NULL
        )
      `)
      .bind(
        id,
        accountId,
        familyId,
        refreshTokenHash,
        createdAt,
        expiresAt
      )
      .run();


  const changes =
    requireRunResult(
      result,
      {
        maxChanges:
          1
      }
    );


  if (
    changes !==
      1
  ) {

    throw new Error(
      "Invalid staff session insert result"
    );
  }


  const persisted =
    await getStaffSessionById(
      env,
      id
    );


  if (!persisted) {

    throw new Error(
      "Staff session readback failed"
    );
  }


  return persisted;
}


// =========================================
// ROTATE REFRESH SESSION
// =========================================
//
// Rotation is security-critical.
//
// Two statements execute in one D1 batch:
//
// 1. INSERT replacement session only if
//    current session is still active.
//
// 2. Revoke current session and point it
//    to the replacement.
//
// INSERT uses SELECT from the authoritative
// current session, so account_id/family_id
// cannot be supplied or forged by client.
//
// Concurrent refresh requests:
//
// request A:
//   insert replacement -> 1
//   revoke old         -> 1
//
// request B:
//   old already revoked
//   insert replacement -> 0
//   revoke old         -> 0
//
// B therefore cannot create a second valid
// descendant from the same refresh token.
// =========================================

export async function rotateStaffSession(
  env,
  currentRefreshTokenHash,
  replacement,
  rotatedAt = Date.now()
) {

  const currentHash =
    requireRefreshTokenHash(
      currentRefreshTokenHash
    );


  if (
    !replacement
    ||
    typeof replacement !==
      "object"
    ||
    Array.isArray(
      replacement
    )
  ) {

    throw new Error(
      "Invalid staff replacement session"
    );
  }


  const replacementId =
    requiredText(
      replacement.id,
      "replacementSessionId"
    );


  const replacementHash =
    requireRefreshTokenHash(
      replacement.refreshTokenHash
    );


  if (
    replacementHash ===
      currentHash
  ) {

    throw new Error(
      "Invalid staff replacement token"
    );
  }


  const timestamp =
    requiredTimestamp(
      rotatedAt,
      "rotatedAt"
    );


  const replacementExpiresAt =
    requiredTimestamp(
      replacement.expiresAt,
      "replacementExpiresAt"
    );


  if (
    replacementExpiresAt <=
      timestamp
  ) {

    throw new Error(
      "Invalid staff replacement expiry"
    );
  }


  const db =
    requireDatabase(
      env
    );


  const insertReplacement =
    db
      .prepare(`
        INSERT INTO staff_sessions (
          id,
          account_id,
          family_id,
          refresh_token_hash,
          created_at,
          expires_at,
          last_used_at,
          revoked_at,
          replaced_by_session_id
        )

        SELECT
          ?1,
          current.account_id,
          current.family_id,
          ?2,
          ?3,
          ?4,
          NULL,
          NULL,
          NULL

        FROM staff_sessions
          AS current

        WHERE current.refresh_token_hash = ?5
          AND current.revoked_at IS NULL
          AND current.replaced_by_session_id IS NULL
          AND current.expires_at > ?3

        LIMIT 1
      `)
      .bind(
        replacementId,
        replacementHash,
        timestamp,
        replacementExpiresAt,
        currentHash
      );


  const revokeCurrent =
    db
      .prepare(`
        UPDATE staff_sessions

        SET
          last_used_at = ?3,
          revoked_at = ?3,
          replaced_by_session_id = ?1

        WHERE refresh_token_hash = ?5
          AND revoked_at IS NULL
          AND replaced_by_session_id IS NULL
          AND expires_at > ?3

          AND EXISTS (
            SELECT 1

            FROM staff_sessions
              AS replacement

            WHERE replacement.id = ?1
              AND replacement.refresh_token_hash = ?2
              AND replacement.account_id =
                    staff_sessions.account_id
              AND replacement.family_id =
                    staff_sessions.family_id
          )
      `)
      .bind(
        replacementId,
        replacementHash,
        timestamp,
        replacementExpiresAt,
        currentHash
      );


  let results;


  try {

    results =
      await db.batch([
        insertReplacement,
        revokeCurrent
      ]);

  } catch (
    error
  ) {

    throw new Error(
      "Staff session rotation failed"
    );
  }


  if (
    !Array.isArray(
      results
    )
    ||
    results.length !==
      2
  ) {

    throw new Error(
      "Invalid staff session rotation result"
    );
  }


  const insertChanges =
    requireRunResult(
      results[0],
      {
        maxChanges:
          1
      }
    );


  const revokeChanges =
    requireRunResult(
      results[1],
      {
        maxChanges:
          1
      }
    );


  if (
    insertChanges === 1
    &&
    revokeChanges === 1
  ) {

    const session =
      await getStaffSessionById(
        env,
        replacementId
      );


    if (!session) {

      throw new Error(
        "Staff session rotation readback failed"
      );
    }


    return {
      ok: true,
      reason: null,
      session
    };
  }


  if (
    insertChanges !==
      revokeChanges
  ) {

    throw new Error(
      "Inconsistent staff session rotation"
    );
  }


  // Both statements changed zero rows.
  //
  // Determine the reason from the
  // authoritative original session.
  const current =
    await getStaffSessionByRefreshTokenHash(
      env,
      currentHash
    );


  if (!current) {

    return {
      ok: false,
      reason:
        "not_found",
      session: null
    };
  }


  if (
    current.revokedAt !==
      null
    ||
    current.replacedBySessionId !==
      null
  ) {

    return {
      ok: false,
      reason:
        "revoked",
      session:
        current
    };
  }


  if (
    current.expiresAt <=
      timestamp
  ) {

    return {
      ok: false,
      reason:
        "expired",
      session:
        current
    };
  }


  return {
    ok: false,
    reason:
      "conflict",
    session:
      current
  };
}


// =========================================
// REVOKE ONE SESSION
// =========================================
//
// Used for normal logout.
//
// Revocation is idempotent:
//
// already-revoked session remains revoked
// and is returned without creating an error.
// =========================================

export async function revokeStaffSession(
  env,
  refreshTokenHash,
  revokedAt = Date.now()
) {

  const hash =
    requireRefreshTokenHash(
      refreshTokenHash
    );


  const timestamp =
    requiredTimestamp(
      revokedAt,
      "revokedAt"
    );


  const db =
    requireDatabase(
      env
    );


  const result =
    await db
      .prepare(`
        UPDATE staff_sessions

        SET
          revoked_at = ?2

        WHERE refresh_token_hash = ?1
          AND revoked_at IS NULL
      `)
      .bind(
        hash,
        timestamp
      )
      .run();


  const changes =
    requireRunResult(
      result,
      {
        maxChanges:
          1
      }
    );


  const session =
    await getStaffSessionByRefreshTokenHash(
      env,
      hash
    );


  if (!session) {

    return {
      ok: false,
      reason:
        "not_found",
      revoked:
        false,
      session:
        null
    };
  }


  return {
    ok: true,
    reason: null,
    revoked:
      changes === 1,
    session
  };
}


// =========================================
// REVOKE SESSION FAMILY
// =========================================
//
// Security use case:
//
// a previously rotated refresh token is
// presented again.
//
// That indicates possible token replay.
//
// Service layer can revoke the entire
// family, including the currently active
// replacement session.
// =========================================

export async function revokeStaffSessionFamily(
  env,
  familyId,
  revokedAt = Date.now()
) {

  const family =
    requiredText(
      familyId,
      "familyId"
    );


  const timestamp =
    requiredTimestamp(
      revokedAt,
      "revokedAt"
    );


  const db =
    requireDatabase(
      env
    );


  const result =
    await db
      .prepare(`
        UPDATE staff_sessions

        SET
          revoked_at = ?2

        WHERE family_id = ?1
          AND revoked_at IS NULL
      `)
      .bind(
        family,
        timestamp
      )
      .run();


  const changes =
    requireRunResult(
      result
    );


  return {
    ok: true,
    revokedCount:
      changes
  };
}


// =========================================
// REVOKE ALL ACCOUNT SESSIONS
// =========================================
//
// Used for:
//
// - password change
// - forced logout
// - administrative security action
//
// token_version invalidation and session
// revocation are separate controls.
// =========================================

export async function revokeStaffSessionsForAccount(
  env,
  accountId,
  revokedAt = Date.now()
) {

  const id =
    requiredText(
      accountId,
      "accountId"
    );


  const timestamp =
    requiredTimestamp(
      revokedAt,
      "revokedAt"
    );


  const db =
    requireDatabase(
      env
    );


  const result =
    await db
      .prepare(`
        UPDATE staff_sessions

        SET
          revoked_at = ?2

        WHERE account_id = ?1
          AND revoked_at IS NULL
      `)
      .bind(
        id,
        timestamp
      )
      .run();


  const changes =
    requireRunResult(
      result
    );


  return {
    ok: true,
    revokedCount:
      changes
  };
}