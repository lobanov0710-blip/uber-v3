import { PASSENGER_PUSH_REDACTED_TOKEN } from "./passengerPushLifecycle.js";

// PUSH-01C: authoritative one-use grant consumption + device change.
// D1 batch() runs as a single transaction and rolls back on any SQL error.
// In particular a duplicate grant_id fails the INSERT and prevents write.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validPrincipal(principal) {
  return principal && ["orderId", "installationId", "grantId"]
    .every(key => typeof principal[key] === "string" && UUID.test(principal[key]));
}

function requireDb(env) {
  if (!env?.DB || typeof env.DB.batch !== "function"
      || typeof env.DB.prepare !== "function") {
    throw new Error("Passenger push transactional D1 unavailable");
  }
  return env.DB;
}

function claim(db, principal, now) {
  return db.prepare(`
    INSERT INTO passenger_push_grant_uses
      (grant_id, order_id, installation_id, used_at)
    VALUES (?1, ?2, ?3, ?4)
  `).bind(principal.grantId, principal.orderId, principal.installationId, now);
}

function validateBatch(results) {
  if (!Array.isArray(results) || results.length !== 2
      || results.some(r => r?.success !== true
        || !Number.isSafeInteger(r?.meta?.changes)
        || r.meta.changes < 0 || r.meta.changes > 1)) {
    throw new Error("Invalid passenger push transaction response");
  }
  if (results[0].meta.changes !== 1) {
    throw new Error("Passenger push grant not consumed");
  }
  return results[1].meta.changes === 1;
}

export async function registerPassengerPushOnce(
  env, principal, fcmToken, now, expiresAt
) {
  if (!validPrincipal(principal) || !Number.isSafeInteger(now) || now <= 0
      || !Number.isSafeInteger(expiresAt) || expiresAt <= now
      || typeof fcmToken !== "string" || !fcmToken || fcmToken.length > 4096
      || fcmToken === PASSENGER_PUSH_REDACTED_TOKEN
      || /\s/.test(fcmToken)) {
    throw new Error("Invalid passenger push registration");
  }
  const db = requireDb(env);
  const grantClaim = claim(db, principal, now);
  const write = db.prepare(`
    INSERT INTO passenger_push_devices
      (installation_id, order_id, platform, fcm_token,
       created_at, updated_at, expires_at, revoked_at)
    SELECT ?1, o.id, 'android', ?3, ?4, ?4, ?5, NULL
      FROM orders AS o
     WHERE o.id = ?2 AND o.status IN ('new', 'taken', 'in_progress')
    ON CONFLICT(installation_id) DO UPDATE SET
      fcm_token = excluded.fcm_token,
      updated_at = excluded.updated_at,
      expires_at = excluded.expires_at
    WHERE passenger_push_devices.order_id = excluded.order_id
      AND passenger_push_devices.revoked_at IS NULL
      AND passenger_push_devices.updated_at <= excluded.updated_at
  `).bind(principal.installationId, principal.orderId, fcmToken, now, expiresAt);
  return validateBatch(await db.batch([grantClaim, write]));
}

export async function revokePassengerPushOnce(env, principal, now) {
  if (!validPrincipal(principal) || !Number.isSafeInteger(now) || now <= 0) {
    throw new Error("Invalid passenger push revoke");
  }
  const db = requireDb(env);
  const grantClaim = claim(db, principal, now);
  const revoke = db.prepare(`
    UPDATE passenger_push_devices
       SET revoked_at = ?3
     WHERE installation_id = ?1 AND order_id = ?2 AND revoked_at IS NULL
  `).bind(principal.installationId, principal.orderId, now);
  // No existing device is an acceptable idempotent revoke. But grant jti
  // must still be consumed exactly once even when no row matched.
  await db.batch([grantClaim, revoke]).then(validateBatch);
  return true;
}
