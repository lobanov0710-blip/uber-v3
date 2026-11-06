// =========================================
// STAFF PUSH DELIVERY REPOSITORY
// Cloudflare D1
// =========================================
//
// Read-side used by FCM delivery.
//
// A push registration row alone is NOT
// enough to authorize delivery.
//
// Every target must still belong to:
// - active driver account
// - same registered session family
// - at least one currently active session
//   in that family.
//
// This prevents stale rows from receiving
// push after logout/session revocation.
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


export async function listActiveDriverPushTargets(
  env,
  now = Date.now()
) {

  const timestamp =
    Number(
      now
    );


  if (
    !Number.isSafeInteger(
      timestamp
    )
    ||
    timestamp <= 0
  ) {

    throw new Error(
      "Invalid push delivery timestamp"
    );
  }


  const db =
    requireDatabase(
      env
    );


  const result =
    await db
      .prepare(`
        SELECT
          p.installation_id,
          p.account_id,
          p.session_family_id,
          p.fcm_token

        FROM staff_push_devices p

        INNER JOIN staff_accounts a
          ON a.id = p.account_id

        WHERE p.platform = 'android'
          AND a.role = 'driver'
          AND a.status = 'active'

          AND EXISTS (
            SELECT 1

            FROM staff_sessions s

            WHERE s.account_id = p.account_id
              AND s.family_id = p.session_family_id
              AND s.revoked_at IS NULL
              AND s.replaced_by_session_id IS NULL
              AND s.expires_at > ?1
          )
      `)
      .bind(
        timestamp
      )
      .all();


  if (
    result?.success !== true
    ||
    !Array.isArray(
      result?.results
    )
  ) {

    throw new Error(
      "Staff push target query failed"
    );
  }


  return result.results
    .map(
      row => ({
        installationId:
          clean(
            row?.installation_id
          ),

        accountId:
          clean(
            row?.account_id
          ),

        sessionFamilyId:
          clean(
            row?.session_family_id
          ),

        fcmToken:
          clean(
            row?.fcm_token
          )
      })
    )
    .filter(
      target =>
        target.installationId.length === 36
        &&
        target.accountId.length > 0
        &&
        target.sessionFamilyId.length > 0
        &&
        target.fcmToken.length > 0
        &&
        target.fcmToken.length <= 4096
    );
}


// =========================================
// ACTIVE DRIVER PUSH TARGETS BY ACCOUNT
// =========================================
//
// Used for order-status events that belong
// only to the driver assigned to an order.
//
// The same authorization invariants as the
// broadcast query apply:
// - active driver account
// - same registered session family
// - active non-replaced session
// =========================================

export async function listActiveDriverPushTargetsForAccount(
  env,
  accountId,
  now = Date.now()
) {

  const account =
    clean(
      accountId
    );


  if (!account) {

    throw new Error(
      "Invalid push target account id"
    );
  }


  const timestamp =
    Number(
      now
    );


  if (
    !Number.isSafeInteger(
      timestamp
    )
    ||
    timestamp <= 0
  ) {

    throw new Error(
      "Invalid push delivery timestamp"
    );
  }


  const db =
    requireDatabase(
      env
    );


  const result =
    await db
      .prepare(`
        SELECT
          p.installation_id,
          p.account_id,
          p.session_family_id,
          p.fcm_token

        FROM staff_push_devices p

        INNER JOIN staff_accounts a
          ON a.id = p.account_id

        WHERE p.platform = 'android'
          AND a.role = 'driver'
          AND a.status = 'active'
          AND p.account_id = ?2

          AND EXISTS (
            SELECT 1

            FROM staff_sessions s

            WHERE s.account_id = p.account_id
              AND s.family_id = p.session_family_id
              AND s.revoked_at IS NULL
              AND s.replaced_by_session_id IS NULL
              AND s.expires_at > ?1
          )
      `)
      .bind(
        timestamp,
        account
      )
      .all();


  if (
    result?.success !== true
    ||
    !Array.isArray(
      result?.results
    )
  ) {

    throw new Error(
      "Staff push target query failed"
    );
  }


  return result.results
    .map(
      row => ({
        installationId:
          clean(
            row?.installation_id
          ),

        accountId:
          clean(
            row?.account_id
          ),

        sessionFamilyId:
          clean(
            row?.session_family_id
          ),

        fcmToken:
          clean(
            row?.fcm_token
          )
      })
    )
    .filter(
      target =>
        target.installationId.length === 36
        &&
        target.accountId === account
        &&
        target.sessionFamilyId.length > 0
        &&
        target.fcmToken.length > 0
        &&
        target.fcmToken.length <= 4096
    );
}
