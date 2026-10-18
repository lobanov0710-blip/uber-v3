// =========================================
// STAFF PUSH DEVICE REPOSITORY
// Cloudflare D1
// =========================================
//
// Persistence only.
//
// This module does not authenticate users.
// Authoritative staff authorization remains
// in staffAuthorization.js.
//
// FCM tokens are sensitive routing values.
// Never log them or include them in errors.
// =========================================


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
// VALIDATION
// =========================================

function requiredText(
  value,
  field,
  maxLength
) {

  const text =
    String(
      value ?? ""
    )
      .trim();


  if (
    !text
    ||
    text.length > maxLength
  ) {

    throw new Error(
      `Invalid staff push device ${field}`
    );
  }


  return text;
}


function requiredTimestamp(
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
      "Invalid staff push device timestamp"
    );
  }


  return timestamp;
}


// =========================================
// UPSERT
// =========================================
//
// installation_id is stable for one local
// application installation.
//
// FCM token may rotate independently.
//
// Re-authentication by another staff account
// on the same installation transfers the
// installation to that current authenticated
// account/session family.
// =========================================

export async function upsertStaffPushDevice(
  env,
  device
) {

  if (
    !device
    ||
    typeof device !==
      "object"
    ||
    Array.isArray(
      device
    )
  ) {

    throw new Error(
      "Invalid staff push device"
    );
  }


  const installationId =
    requiredText(
      device.installationId,
      "installationId",
      36
    );


  const accountId =
    requiredText(
      device.accountId,
      "accountId",
      100
    );


  const sessionFamilyId =
    requiredText(
      device.sessionFamilyId,
      "sessionFamilyId",
      100
    );


  const platform =
    requiredText(
      device.platform,
      "platform",
      20
    );


  if (
    platform !== "android"
  ) {

    throw new Error(
      "Invalid staff push device platform"
    );
  }


  const fcmToken =
    requiredText(
      device.fcmToken,
      "fcmToken",
      4096
    );


  const timestamp =
    requiredTimestamp(
      device.updatedAt
    );


  const db =
    requireDatabase(
      env
    );


  const result =
    await db
      .prepare(`
        INSERT INTO staff_push_devices (
          installation_id,
          account_id,
          session_family_id,
          platform,
          fcm_token,
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
          ?6
        )

        ON CONFLICT (
          installation_id
        )
        DO UPDATE SET
          account_id =
            excluded.account_id,

          session_family_id =
            excluded.session_family_id,

          platform =
            excluded.platform,

          fcm_token =
            excluded.fcm_token,

          updated_at =
            CASE
              WHEN staff_push_devices.updated_at >=
                excluded.updated_at
              THEN
                staff_push_devices.updated_at + 1

              ELSE
                excluded.updated_at
            END
      `)
      .bind(
        installationId,
        accountId,
        sessionFamilyId,
        platform,
        fcmToken,
        timestamp
      )
      .run();


  if (
    result?.success !== true
  ) {

    throw new Error(
      "Staff push device upsert failed"
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
    changes !== 1
  ) {

    throw new Error(
      "Invalid staff push device upsert result"
    );
  }


  return {
    ok: true
  };
}


// =========================================
// DELETE
// =========================================
//
// account_id is part of the predicate.
//
// Therefore one authenticated staff account
// cannot unregister another account's
// installation even if installation_id is
// guessed or leaked.
//
// Deletion is idempotent.
// =========================================

export async function deleteStaffPushDevice(
  env,
  accountId,
  installationId
) {

  const account =
    requiredText(
      accountId,
      "accountId",
      100
    );


  const installation =
    requiredText(
      installationId,
      "installationId",
      36
    );


  const db =
    requireDatabase(
      env
    );


  const result =
    await db
      .prepare(`
        DELETE FROM staff_push_devices

        WHERE installation_id = ?1
          AND account_id = ?2
      `)
      .bind(
        installation,
        account
      )
      .run();


  if (
    result?.success !== true
  ) {

    throw new Error(
      "Staff push device delete failed"
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
    ||
    changes > 1
  ) {

    throw new Error(
      "Invalid staff push device delete result"
    );
  }


  return {
    ok: true,
    changed:
      changes === 1
  };
}
