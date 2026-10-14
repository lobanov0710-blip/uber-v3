// =========================================
// STAFF ACCOUNT ADMIN REPOSITORY
// Cloudflare D1
// =========================================
//
// Administrative management of staff
// accounts.
//
// This module is intentionally separate
// from staffAuthRepository.js.
//
// It manages:
//
// - safe staff account listing
// - driver account creation
// - driver status changes
// - driver password reset
// - administrative audit records
// - session revocation after security
//   changes
//
// It NEVER:
//
// - stores plaintext passwords
// - returns password verifier data
// - manages admin accounts through the API
// - trusts client-selected roles
//
// D1 remains authoritative.
// =========================================


import {
  STAFF_PASSWORD_ALGORITHM,
  STAFF_PASSWORD_ITERATIONS
} from "./staffAuthCrypto.js";


// =========================================
// CONSTANTS
// =========================================

const LOGIN_PATTERN =
  /^[a-z0-9][a-z0-9._-]{2,63}$/;


const STAFF_ID_PATTERN =
  /^staff_[A-Za-z0-9_-]{8,94}$/;


const AUDIT_ID_PATTERN =
  /^staff-audit_[A-Za-z0-9_-]{8,88}$/;


const STAFF_STATUSES =
  new Set([
    "pending",
    "active",
    "suspended",
    "disabled"
  ]);


const MANAGED_STATUSES =
  new Set([
    "active",
    "suspended",
    "disabled"
  ]);


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
      `Invalid staff admin ${field}`
    );
  }


  return text;
}


// =========================================
// STAFF ID
// =========================================

function requireStaffId(
  value,
  field = "accountId"
) {

  const id =
    requiredText(
      value,
      field
    );


  if (
    !STAFF_ID_PATTERN.test(
      id
    )
  ) {

    throw new Error(
      `Invalid staff admin ${field}`
    );
  }


  return id;
}


// =========================================
// AUDIT ID
// =========================================

function requireAuditId(
  value
) {

  const id =
    requiredText(
      value,
      "auditId"
    );


  if (
    !AUDIT_ID_PATTERN.test(
      id
    )
  ) {

    throw new Error(
      "Invalid staff admin auditId"
    );
  }


  return id;
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
      "Invalid staff admin login"
    );
  }


  return login;
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
    displayName.length > 100
    ||
    /[\u0000-\u001F\u007F]/.test(
      displayName
    )
  ) {

    throw new Error(
      "Invalid staff admin displayName"
    );
  }


  return displayName;
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
      `Invalid staff admin ${field}`
    );
  }


  return number;
}


// =========================================
// TIMESTAMP
// =========================================

function requireTimestamp(
  value,
  field
) {

  return requiredPositiveInteger(
    value,
    field
  );
}


// =========================================
// STATUS
// =========================================

function requireExistingStatus(
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
      "Invalid staff admin status"
    );
  }


  return status;
}


function requireManagedStatus(
  value
) {

  const status =
    requiredText(
      value,
      "newStatus"
    )
      .toLowerCase();


  if (
    !MANAGED_STATUSES.has(
      status
    )
  ) {

    throw new Error(
      "Invalid staff admin newStatus"
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
    typeof value !== "object"
    ||
    Array.isArray(
      value
    )
  ) {

    throw new Error(
      "Invalid staff admin password verifier"
    );
  }


  const passwordAlgorithm =
    String(
      value.passwordAlgorithm ??
      ""
    )
      .trim()
      .toLowerCase();


  const passwordIterations =
    Number(
      value.passwordIterations
    );


  const passwordSalt =
    String(
      value.passwordSalt ??
      ""
    );


  const passwordHash =
    String(
      value.passwordHash ??
      ""
    );


  if (
    passwordAlgorithm !==
      STAFF_PASSWORD_ALGORITHM
    ||
    passwordIterations !==
      STAFF_PASSWORD_ITERATIONS
    ||
    !/^[A-Za-z0-9_-]{22}$/.test(
      passwordSalt
    )
    ||
    !/^[A-Za-z0-9_-]{43}$/.test(
      passwordHash
    )
  ) {

    throw new Error(
      "Invalid staff admin password verifier"
    );
  }


  return {
    passwordAlgorithm,
    passwordIterations,
    passwordSalt,
    passwordHash
  };
}


// =========================================
// PUBLIC ACCOUNT ROW
// =========================================
//
// Password verifier metadata is
// intentionally excluded.
// =========================================

function mapAccountSummary(
  row
) {

  if (
    !row
    ||
    typeof row !== "object"
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

    tokenVersion:
      Number(
        row.token_version
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
// SAFE ACCOUNT SELECT
// =========================================

const ACCOUNT_SUMMARY_SELECT = `
  SELECT
    id,
    login,
    display_name,
    role,
    status,
    token_version,
    created_at,
    updated_at
  FROM staff_accounts
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
      "Staff admin D1 operation failed"
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
      "Invalid staff admin D1 result"
    );
  }


  if (
    maxChanges !== null
    &&
    changes > maxChanges
  ) {

    throw new Error(
      "Invalid staff admin D1 change count"
    );
  }


  return changes;
}


// =========================================
// GET ACCOUNT SUMMARY BY ID
// =========================================

export async function getStaffAccountSummaryById(
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
        ${ACCOUNT_SUMMARY_SELECT}

        WHERE id = ?1

        LIMIT 1
      `)
      .bind(
        id
      )
      .first();


  return mapAccountSummary(
    row
  );
}


// =========================================
// GET ACCOUNT SUMMARY BY LOGIN
// =========================================

export async function getStaffAccountSummaryByLogin(
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
        ${ACCOUNT_SUMMARY_SELECT}

        WHERE login = ?1

        LIMIT 1
      `)
      .bind(
        normalizedLogin
      )
      .first();


  return mapAccountSummary(
    row
  );
}


// =========================================
// LIST STAFF ACCOUNTS
// =========================================

export async function listStaffAccountSummaries(
  env
) {

  const db =
    requireDatabase(
      env
    );


  const result =
    await db
      .prepare(`
        ${ACCOUNT_SUMMARY_SELECT}

        ORDER BY
          role ASC,
          display_name COLLATE NOCASE ASC,
          login COLLATE NOCASE ASC,
          id ASC
      `)
      .all();


  if (
    result?.success === false
  ) {

    throw new Error(
      "Staff account list failed"
    );
  }


  const rows =
    Array.isArray(
      result?.results
    )
      ? result.results
      : [];


  return rows
    .map(
      mapAccountSummary
    )
    .filter(
      Boolean
    );
}


// =========================================
// CREATE DRIVER + AUDIT
// =========================================
//
// API-managed staff accounts are always:
//
// role   = driver
// status = active
//
// Client input cannot select another role
// or create an administrator.
//
// The account insert and audit insert run
// inside one D1 batch transaction.
// =========================================

export async function createDriverAccountWithAudit(
  env,
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

    throw new Error(
      "Invalid staff admin create input"
    );
  }


  const db =
    requireDatabase(
      env
    );


  const actorAccountId =
    requireStaffId(
      input.actorAccountId,
      "actorAccountId"
    );


  const targetAccountId =
    requireStaffId(
      input.targetAccountId,
      "targetAccountId"
    );


  const auditId =
    requireAuditId(
      input.auditId
    );


  const login =
    requireLogin(
      input.login
    );


  const displayName =
    requireDisplayName(
      input.displayName
    );


  const verifier =
    requirePasswordVerifier(
      input.passwordVerifier
    );


  const createdAt =
    requireTimestamp(
      input.createdAt,
      "createdAt"
    );


  const createAccount =
    db
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

        SELECT
          ?1,
          ?2,
          ?3,
          'driver',
          'active',
          ?4,
          ?5,
          ?6,
          ?7,
          1,
          0,
          NULL,
          NULL,
          NULL,
          ?8,
          ?8,
          ?8

        FROM staff_accounts
          AS actor

        WHERE actor.id = ?9
          AND actor.role = 'admin'
          AND actor.status = 'active'

          AND NOT EXISTS (
            SELECT 1

            FROM staff_accounts
              AS existing

            WHERE existing.id = ?1
              OR existing.login = ?2
          )
      `)
      .bind(
        targetAccountId,
        login,
        displayName,
        verifier.passwordAlgorithm,
        verifier.passwordIterations,
        verifier.passwordSalt,
        verifier.passwordHash,
        createdAt,
        actorAccountId
      );


  const insertAudit =
    db
      .prepare(`
        INSERT INTO staff_admin_audit (
          id,
          actor_account_id,
          target_account_id,
          action,
          previous_status,
          new_status,
          created_at
        )

        SELECT
          ?1,
          actor.id,
          target.id,
          'account_created',
          NULL,
          NULL,
          ?2

        FROM staff_accounts
          AS actor

        JOIN staff_accounts
          AS target
          ON target.id = ?3

        WHERE actor.id = ?4
          AND actor.role = 'admin'
          AND actor.status = 'active'

          AND target.role = 'driver'
          AND target.status = 'active'
          AND target.login = ?5
          AND target.created_at = ?2
          AND target.updated_at = ?2
          AND target.password_changed_at = ?2
          AND target.password_hash = ?6
      `)
      .bind(
        auditId,
        createdAt,
        targetAccountId,
        actorAccountId,
        login,
        verifier.passwordHash
      );


  let results;


  try {

    results =
      await db.batch([
        createAccount,
        insertAudit
      ]);

  } catch (
    error
  ) {

    throw new Error(
      "Staff driver account creation failed"
    );
  }


  if (
    !Array.isArray(
      results
    )
    ||
    results.length !== 2
  ) {

    throw new Error(
      "Invalid staff driver creation result"
    );
  }


  const accountChanges =
    requireRunResult(
      results[0],
      {
        maxChanges: 1
      }
    );


  const auditChanges =
    requireRunResult(
      results[1],
      {
        maxChanges: 1
      }
    );


  if (
    accountChanges !==
      auditChanges
  ) {

    throw new Error(
      "Inconsistent staff driver creation"
    );
  }


  if (
    accountChanges === 0
  ) {

    return {
      ok: false,
      reason:
        "conflict",
      account:
        null
    };
  }


  const account =
    await getStaffAccountSummaryById(
      env,
      targetAccountId
    );


  if (!account) {

    throw new Error(
      "Staff driver creation readback failed"
    );
  }


  return {
    ok: true,
    reason: null,
    account
  };
}


// =========================================
// CHANGE DRIVER STATUS + AUDIT
// =========================================
//
// Only role=driver can be modified.
//
// Every actual administrative status
// change:
//
// - increments token_version
// - revokes all active sessions
// - records an audit row
//
// Reactivating an account does not revive
// old access or refresh credentials.
// =========================================

export async function changeDriverStatusWithAudit(
  env,
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

    throw new Error(
      "Invalid staff admin status input"
    );
  }


  const db =
    requireDatabase(
      env
    );


  const actorAccountId =
    requireStaffId(
      input.actorAccountId,
      "actorAccountId"
    );


  const targetAccountId =
    requireStaffId(
      input.targetAccountId,
      "targetAccountId"
    );


  const auditId =
    requireAuditId(
      input.auditId
    );


  const expectedStatus =
    requireExistingStatus(
      input.expectedStatus
    );


  const newStatus =
    requireManagedStatus(
      input.newStatus
    );


  const expectedTokenVersion =
    requiredPositiveInteger(
      input.expectedTokenVersion,
      "expectedTokenVersion"
    );


  const changedAt =
    requireTimestamp(
      input.changedAt,
      "changedAt"
    );


  if (
    expectedStatus ===
      newStatus
  ) {

    return {
      ok: false,
      reason:
        "no_change",
      account:
        await getStaffAccountSummaryById(
          env,
          targetAccountId
        )
    };
  }


  // Audit is intentionally inserted first.
  //
  // It succeeds only while the exact
  // expected target state is still current.
  //
  // The following UPDATE requires that same
  // audit row to exist.
  //
  // db.batch() makes the sequence
  // transactional.
  const insertAudit =
    db
      .prepare(`
        INSERT INTO staff_admin_audit (
          id,
          actor_account_id,
          target_account_id,
          action,
          previous_status,
          new_status,
          created_at
        )

        SELECT
          ?1,
          actor.id,
          target.id,
          'status_changed',
          target.status,
          ?2,
          ?3

        FROM staff_accounts
          AS actor

        JOIN staff_accounts
          AS target
          ON target.id = ?4

        WHERE actor.id = ?5
          AND actor.role = 'admin'
          AND actor.status = 'active'

          AND target.role = 'driver'
          AND target.status = ?6
          AND target.token_version = ?7
          AND target.status <> ?2
      `)
      .bind(
        auditId,
        newStatus,
        changedAt,
        targetAccountId,
        actorAccountId,
        expectedStatus,
        expectedTokenVersion
      );


  const updateAccount =
    db
      .prepare(`
        UPDATE staff_accounts

        SET
          status = ?1,
          token_version =
            token_version + 1,

          updated_at =
            CASE
              WHEN updated_at >= ?2
              THEN updated_at + 1

              ELSE ?2
            END

        WHERE id = ?3
          AND role = 'driver'
          AND status = ?4
          AND token_version = ?5

          AND EXISTS (
            SELECT 1

            FROM staff_admin_audit

            WHERE id = ?6
              AND actor_account_id = ?7
              AND target_account_id = ?3
              AND action = 'status_changed'
              AND previous_status = ?4
              AND new_status = ?1
          )
      `)
      .bind(
        newStatus,
        changedAt,
        targetAccountId,
        expectedStatus,
        expectedTokenVersion,
        auditId,
        actorAccountId
      );


  const revokeSessions =
    db
      .prepare(`
        UPDATE staff_sessions

        SET
          revoked_at =
            CASE
              WHEN created_at > ?2
              THEN created_at

              ELSE ?2
            END

        WHERE account_id = ?1
          AND revoked_at IS NULL

          AND EXISTS (
            SELECT 1

            FROM staff_admin_audit

            WHERE id = ?3
              AND actor_account_id = ?4
              AND target_account_id = ?1
              AND action = 'status_changed'
          )
      `)
      .bind(
        targetAccountId,
        changedAt,
        auditId,
        actorAccountId
      );


  let results;


  try {

    results =
      await db.batch([
        insertAudit,
        updateAccount,
        revokeSessions
      ]);

  } catch (
    error
  ) {

    throw new Error(
      "Staff driver status change failed"
    );
  }


  if (
    !Array.isArray(
      results
    )
    ||
    results.length !== 3
  ) {

    throw new Error(
      "Invalid staff driver status result"
    );
  }


  const auditChanges =
    requireRunResult(
      results[0],
      {
        maxChanges: 1
      }
    );


  const accountChanges =
    requireRunResult(
      results[1],
      {
        maxChanges: 1
      }
    );


  requireRunResult(
    results[2]
  );


  if (
    auditChanges !==
      accountChanges
  ) {

    throw new Error(
      "Inconsistent staff driver status change"
    );
  }


  const account =
    await getStaffAccountSummaryById(
      env,
      targetAccountId
    );


  if (
    auditChanges === 0
  ) {

    if (!account) {

      return {
        ok: false,
        reason:
          "not_found",
        account:
          null
      };
    }


    if (
      account.role !==
        "driver"
    ) {

      return {
        ok: false,
        reason:
          "not_driver",
        account
      };
    }


    if (
      account.status ===
        newStatus
    ) {

      return {
        ok: false,
        reason:
          "no_change",
        account
      };
    }


    return {
      ok: false,
      reason:
        "conflict",
      account
    };
  }


  if (!account) {

    throw new Error(
      "Staff driver status readback failed"
    );
  }


  return {
    ok: true,
    reason: null,
    account
  };
}


// =========================================
// RESET DRIVER PASSWORD + AUDIT
// =========================================
//
// Only role=driver can be modified.
//
// Password plaintext is hashed before
// reaching this repository.
//
// A successful reset:
//
// - replaces verifier metadata
// - increments token_version
// - clears login lock/failure state
// - revokes all active sessions
// - records an audit row
// =========================================

export async function resetDriverPasswordWithAudit(
  env,
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

    throw new Error(
      "Invalid staff admin password reset input"
    );
  }


  const db =
    requireDatabase(
      env
    );


  const actorAccountId =
    requireStaffId(
      input.actorAccountId,
      "actorAccountId"
    );


  const targetAccountId =
    requireStaffId(
      input.targetAccountId,
      "targetAccountId"
    );


  const auditId =
    requireAuditId(
      input.auditId
    );


  const expectedTokenVersion =
    requiredPositiveInteger(
      input.expectedTokenVersion,
      "expectedTokenVersion"
    );


  const verifier =
    requirePasswordVerifier(
      input.passwordVerifier
    );


  const changedAt =
    requireTimestamp(
      input.changedAt,
      "changedAt"
    );


  const insertAudit =
    db
      .prepare(`
        INSERT INTO staff_admin_audit (
          id,
          actor_account_id,
          target_account_id,
          action,
          previous_status,
          new_status,
          created_at
        )

        SELECT
          ?1,
          actor.id,
          target.id,
          'password_reset',
          NULL,
          NULL,
          ?2

        FROM staff_accounts
          AS actor

        JOIN staff_accounts
          AS target
          ON target.id = ?3

        WHERE actor.id = ?4
          AND actor.role = 'admin'
          AND actor.status = 'active'

          AND target.role = 'driver'
          AND target.token_version = ?5
          AND target.created_at <= ?2
      `)
      .bind(
        auditId,
        changedAt,
        targetAccountId,
        actorAccountId,
        expectedTokenVersion
      );


  const updateAccount =
    db
      .prepare(`
        UPDATE staff_accounts

        SET
          password_algorithm = ?1,
          password_iterations = ?2,
          password_salt = ?3,
          password_hash = ?4,

          token_version =
            token_version + 1,

          failed_login_count = 0,
          locked_until = NULL,
          last_failed_login_at = NULL,

          password_changed_at = ?5,

          updated_at =
            CASE
              WHEN updated_at >= ?5
              THEN updated_at + 1

              ELSE ?5
            END

        WHERE id = ?6
          AND role = 'driver'
          AND token_version = ?7

          AND EXISTS (
            SELECT 1

            FROM staff_admin_audit

            WHERE id = ?8
              AND actor_account_id = ?9
              AND target_account_id = ?6
              AND action = 'password_reset'
          )
      `)
      .bind(
        verifier.passwordAlgorithm,
        verifier.passwordIterations,
        verifier.passwordSalt,
        verifier.passwordHash,
        changedAt,
        targetAccountId,
        expectedTokenVersion,
        auditId,
        actorAccountId
      );


  const revokeSessions =
    db
      .prepare(`
        UPDATE staff_sessions

        SET
          revoked_at =
            CASE
              WHEN created_at > ?2
              THEN created_at

              ELSE ?2
            END

        WHERE account_id = ?1
          AND revoked_at IS NULL

          AND EXISTS (
            SELECT 1

            FROM staff_admin_audit

            WHERE id = ?3
              AND actor_account_id = ?4
              AND target_account_id = ?1
              AND action = 'password_reset'
          )
      `)
      .bind(
        targetAccountId,
        changedAt,
        auditId,
        actorAccountId
      );


  let results;


  try {

    results =
      await db.batch([
        insertAudit,
        updateAccount,
        revokeSessions
      ]);

  } catch (
    error
  ) {

    throw new Error(
      "Staff driver password reset failed"
    );
  }


  if (
    !Array.isArray(
      results
    )
    ||
    results.length !== 3
  ) {

    throw new Error(
      "Invalid staff driver password reset result"
    );
  }


  const auditChanges =
    requireRunResult(
      results[0],
      {
        maxChanges: 1
      }
    );


  const accountChanges =
    requireRunResult(
      results[1],
      {
        maxChanges: 1
      }
    );


  requireRunResult(
    results[2]
  );


  if (
    auditChanges !==
      accountChanges
  ) {

    throw new Error(
      "Inconsistent staff driver password reset"
    );
  }


  const account =
    await getStaffAccountSummaryById(
      env,
      targetAccountId
    );


  if (
    auditChanges === 0
  ) {

    if (!account) {

      return {
        ok: false,
        reason:
          "not_found",
        account:
          null
      };
    }


    if (
      account.role !==
        "driver"
    ) {

      return {
        ok: false,
        reason:
          "not_driver",
        account
      };
    }


    return {
      ok: false,
      reason:
        "conflict",
      account
    };
  }


  if (!account) {

    throw new Error(
      "Staff driver password reset readback failed"
    );
  }


  return {
    ok: true,
    reason: null,
    account
  };
}