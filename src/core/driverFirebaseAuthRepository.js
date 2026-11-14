// =========================================
// DRIVER FIREBASE AUTH REPOSITORY
// =========================================
//
// D1 persistence for Firebase -> staff session
// exchange. Raw Firebase ID tokens and raw
// refresh tokens never reach this module.
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


function clean(
  value
) {

  return String(
    value ?? ""
  )
    .trim();
}


function requireText(
  value,
  name
) {

  const text =
    clean(
      value
    );


  if (!text) {

    throw new Error(
      `invalid firebase exchange ${name}`
    );
  }


  return text;
}


function requireTimestamp(
  value,
  name
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
      `invalid firebase exchange ${name}`
    );
  }


  return number;
}


function requireRunResult(
  result,
  expectedChanges = 1
) {

  if (
    result?.success !==
      true
  ) {

    throw new Error(
      "firebase exchange D1 operation failed"
    );
  }


  const changes =
    Number(
      result?.meta?.changes ??
      0
    );


  if (
    !Number.isSafeInteger(
      changes
    )
    ||
    changes !==
      expectedChanges
  ) {

    throw new Error(
      "firebase exchange D1 change count mismatch"
    );
  }
}


function mapIdentityRow(
  row
) {

  if (!row) {

    return null;
  }


  return {
    firebaseUid:
      clean(
        row.firebase_uid
      ),

    firebaseProjectId:
      clean(
        row.firebase_project_id
      ),

    normalizedPhone:
      clean(
        row.normalized_phone
      ),

    staffAccountId:
      clean(
        row.staff_account_id
      ),

    account: {
      id:
        clean(
          row.staff_account_id
        ),

      displayName:
        clean(
          row.display_name
        ),

      role:
        clean(
          row.role
        )
          .toLowerCase(),

      status:
        clean(
          row.account_status
        )
          .toLowerCase(),

      tokenVersion:
        Number(
          row.token_version
        )
    },

    registrationStatus:
      clean(
        row.registration_status
      )
        .toLowerCase(),

    identityStatus:
      clean(
        row.identity_status
      )
        .toLowerCase()
  };
}


export async function findDriverFirebaseIdentity(
  env,
  {
    firebaseUid,
    normalizedPhone
  }
) {

  const uid =
    requireText(
      firebaseUid,
      "firebaseUid"
    );


  const phone =
    requireText(
      normalizedPhone,
      "normalizedPhone"
    );


  const db =
    requireDatabase(
      env
    );


  const result =
    await db
      .prepare(`
        SELECT
          i.firebase_uid,
          i.firebase_project_id,
          i.staff_account_id,
          i.normalized_phone,

          a.display_name,
          a.role,
          a.status AS account_status,
          a.token_version,

          p.registration_status,
          p.identity_status

        FROM driver_firebase_identities i

        INNER JOIN staff_accounts a
          ON a.id = i.staff_account_id

        INNER JOIN driver_profiles p
          ON p.staff_account_id =
             i.staff_account_id

        WHERE i.firebase_uid = ?1
           OR i.normalized_phone = ?2

        LIMIT 2
      `)
      .bind(
        uid,
        phone
      )
      .all();


  if (
    result?.success !==
      true
    ||
    !Array.isArray(
      result?.results
    )
  ) {

    throw new Error(
      "firebase identity query failed"
    );
  }


  if (
    result.results.length ===
      0
  ) {

    return {
      kind:
        "missing",

      identity:
        null
    };
  }


  const exact =
    result.results
      .map(
        mapIdentityRow
      )
      .find(
        item =>
          item
          &&
          item.firebaseUid === uid
          &&
          item.normalizedPhone === phone
      );


  if (
    exact
    &&
    result.results.length === 1
  ) {

    return {
      kind:
        "match",

      identity:
        exact
    };
  }


  return {
    kind:
      "conflict",

    identity:
      exact ??
      mapIdentityRow(
        result.results[0]
      )
  };
}


export async function isFirebaseExchangeReplay(
  env,
  tokenDigest
) {

  const digest =
    requireText(
      tokenDigest,
      "tokenDigest"
    );


  const db =
    requireDatabase(
      env
    );


  const row =
    await db
      .prepare(`
        SELECT token_digest

        FROM driver_firebase_exchange_replay

        WHERE token_digest = ?1

        LIMIT 1
      `)
      .bind(
        digest
      )
      .first();


  return Boolean(
    row
  );
}


function sessionInsertStatement(
  db,
  session
) {

  return db
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
      requireText(
        session.id,
        "sessionId"
      ),
      requireText(
        session.accountId,
        "sessionAccountId"
      ),
      requireText(
        session.familyId,
        "sessionFamilyId"
      ),
      requireText(
        session.refreshTokenHash,
        "refreshTokenHash"
      ),
      requireTimestamp(
        session.createdAt,
        "sessionCreatedAt"
      ),
      requireTimestamp(
        session.expiresAt,
        "sessionExpiresAt"
      )
    );
}


function replayInsertStatement(
  db,
  data
) {

  return db
    .prepare(`
      INSERT INTO driver_firebase_exchange_replay (
        token_digest,
        firebase_uid,
        installation_id,
        token_expires_at,
        consumed_at
      )
      VALUES (
        ?1,
        ?2,
        ?3,
        ?4,
        ?5
      )
    `)
    .bind(
      requireText(
        data.tokenDigest,
        "tokenDigest"
      ),
      requireText(
        data.firebaseUid,
        "firebaseUid"
      ),
      requireText(
        data.installationId,
        "installationId"
      ),
      requireTimestamp(
        data.tokenExpiresAt,
        "tokenExpiresAt"
      ),
      requireTimestamp(
        data.now,
        "consumedAt"
      )
    );
}


function auditInsertStatement(
  db,
  data
) {

  return db
    .prepare(`
      INSERT INTO audit_events (
        id,
        actor_account_id,
        action,
        target_type,
        target_id,
        outcome,
        request_id,
        created_at
      )
      VALUES (
        ?1,
        ?2,
        'driver.firebase_session_exchange',
        'staff_account',
        ?2,
        'success',
        ?3,
        ?4
      )
    `)
    .bind(
      requireText(
        data.auditId,
        "auditId"
      ),
      requireText(
        data.staffAccountId,
        "staffAccountId"
      ),
      requireText(
        data.requestId,
        "requestId"
      ),
      requireTimestamp(
        data.now,
        "auditCreatedAt"
      )
    );
}


export async function commitExistingFirebaseExchange(
  env,
  data
) {

  const db =
    requireDatabase(
      env
    );


  const statements = [
    replayInsertStatement(
      db,
      data
    ),

    db
      .prepare(`
        UPDATE driver_firebase_identities

        SET
          last_auth_time = ?5,
          last_verified_at = ?6

        WHERE firebase_uid = ?1
          AND firebase_project_id = ?2
          AND normalized_phone = ?3
          AND staff_account_id = ?4
      `)
      .bind(
        requireText(
          data.firebaseUid,
          "firebaseUid"
        ),
        requireText(
          data.firebaseProjectId,
          "firebaseProjectId"
        ),
        requireText(
          data.normalizedPhone,
          "normalizedPhone"
        ),
        requireText(
          data.staffAccountId,
          "staffAccountId"
        ),
        requireTimestamp(
          data.authTime,
          "authTime"
        ),
        requireTimestamp(
          data.now,
          "lastVerifiedAt"
        )
      ),

    sessionInsertStatement(
      db,
      data.session
    ),

    auditInsertStatement(
      db,
      data
    )
  ];


  const results =
    await db.batch(
      statements
    );


  if (
    !Array.isArray(
      results
    )
    ||
    results.length !==
      statements.length
  ) {

    throw new Error(
      "firebase exchange transaction failed"
    );
  }


  for (
    const result of results
  ) {

    requireRunResult(
      result
    );
  }


  return {
    ok:
      true
  };
}


export async function commitNewFirebaseExchange(
  env,
  data
) {

  const db =
    requireDatabase(
      env
    );


  const account =
    data.account;


  const verifier =
    account?.passwordVerifier;


  const now =
    requireTimestamp(
      data.now,
      "createdAt"
    );


  const statements = [

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
        VALUES (
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
          ?8,
          ?8,
          ?8,
          ?8
        )
      `)
      .bind(
        requireText(
          account?.id,
          "staffAccountId"
        ),
        requireText(
          account?.login,
          "staffLogin"
        ),
        requireText(
          account?.displayName,
          "displayName"
        ),
        requireText(
          verifier?.passwordAlgorithm,
          "passwordAlgorithm"
        ),
        Number(
          verifier?.passwordIterations
        ),
        requireText(
          verifier?.passwordSalt,
          "passwordSalt"
        ),
        requireText(
          verifier?.passwordHash,
          "passwordHash"
        ),
        now
      ),

    db
      .prepare(`
        INSERT INTO driver_profiles (
          staff_account_id,
          normalized_phone,
          registration_status,
          region,
          identity_status,
          created_at,
          updated_at
        )
        VALUES (
          ?1,
          ?2,
          'draft',
          NULL,
          'pending',
          ?3,
          ?3
        )
      `)
      .bind(
        requireText(
          account?.id,
          "staffAccountId"
        ),
        requireText(
          data.normalizedPhone,
          "normalizedPhone"
        ),
        now
      ),

    db
      .prepare(`
        INSERT INTO driver_availability (
          driver_id,
          active_vehicle_id,
          state,
          revision,
          updated_at
        )
        VALUES (
          ?1,
          NULL,
          'off_line',
          1,
          ?2
        )
      `)
      .bind(
        requireText(
          account?.id,
          "staffAccountId"
        ),
        now
      ),

    db
      .prepare(`
        INSERT INTO driver_firebase_identities (
          firebase_uid,
          firebase_project_id,
          staff_account_id,
          normalized_phone,
          last_auth_time,
          last_verified_at,
          created_at
        )
        VALUES (
          ?1,
          ?2,
          ?3,
          ?4,
          ?5,
          ?6,
          ?6
        )
      `)
      .bind(
        requireText(
          data.firebaseUid,
          "firebaseUid"
        ),
        requireText(
          data.firebaseProjectId,
          "firebaseProjectId"
        ),
        requireText(
          account?.id,
          "staffAccountId"
        ),
        requireText(
          data.normalizedPhone,
          "normalizedPhone"
        ),
        requireTimestamp(
          data.authTime,
          "authTime"
        ),
        now
      ),

    replayInsertStatement(
      db,
      data
    ),

    sessionInsertStatement(
      db,
      data.session
    ),

    auditInsertStatement(
      db,
      {
        ...data,
        staffAccountId:
          account?.id
      }
    )
  ];


  const results =
    await db.batch(
      statements
    );


  if (
    !Array.isArray(
      results
    )
    ||
    results.length !==
      statements.length
  ) {

    throw new Error(
      "firebase exchange transaction failed"
    );
  }


  for (
    const result of results
  ) {

    requireRunResult(
      result
    );
  }


  return {
    ok:
      true
  };
}
