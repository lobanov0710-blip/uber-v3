import { PASSENGER_PUSH_REDACTED_TOKEN } from "./passengerPushLifecycle.js";

// Storage only. Caller MUST authenticate a dedicated passenger_push:manage
// grant. No public endpoints, no FCM sending, no staff session access.
// No token/PII is emitted to logs or returned through public APIs.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requiredDatabase(env) {
  if (!env?.DB) throw new Error("Passenger push DB unavailable");
  return env.DB;
}

function validUuid(value) {
  return typeof value === "string" && UUID.test(value);
}

function validMillis(value) {
  return Number.isSafeInteger(value) && value > 0;
}

// Atomic INSERT ... SELECT: if order became terminal, no device is written.
// Conflict permits token rotation only within the SAME existing order and
// only when the local registration has not been revoked. Re-assignment of
// installationId to another order is explicitly blocked.
export async function upsertPassengerPushDevice(env, data) {
  const { orderId, installationId, fcmToken, updatedAt, expiresAt } = data || {};
  if (!validUuid(orderId) || !validUuid(installationId)
    || typeof fcmToken !== "string" || !fcmToken
    || fcmToken.length > 4096 || /\s/.test(fcmToken)
    || !validMillis(updatedAt) || !validMillis(expiresAt)
    || expiresAt <= updatedAt) {
    throw new Error("Invalid passenger push registration");
  }

  const result = await requiredDatabase(env).prepare(`
    INSERT INTO passenger_push_devices (
      installation_id, order_id, platform, fcm_token,
      created_at, updated_at, expires_at, revoked_at
    )
    SELECT ?1, o.id, 'android', ?3, ?4, ?4, ?5, NULL
      FROM orders AS o
     WHERE o.id = ?2
       AND o.status IN ('new', 'taken', 'in_progress')
    ON CONFLICT(installation_id) DO UPDATE SET
      fcm_token = excluded.fcm_token,
      updated_at = excluded.updated_at,
      expires_at = excluded.expires_at
    WHERE passenger_push_devices.order_id = excluded.order_id
      AND passenger_push_devices.revoked_at IS NULL
      AND passenger_push_devices.updated_at <= excluded.updated_at
  `).bind(installationId, orderId, fcmToken, updatedAt, expiresAt).run();

  if (result?.success !== true) throw new Error("Passenger push write failed");
  const changes = result?.meta?.changes;
  if (!Number.isSafeInteger(changes) || changes < 0 || changes > 1) {
    throw new Error("Invalid passenger push write result");
  }
  return { ok: changes === 1 };
}

// Keep an ownership-bound tombstone: an unexpired replayed grant cannot
// re-register a revoked installation. The scheduled cleanup is future work.
// Non-matching ownership is indistinguishable from an already revoked row.
export async function revokePassengerPushDevice(env, orderId, installationId, now) {
  if (!validUuid(orderId) || !validUuid(installationId) || !validMillis(now)) {
    throw new Error("Invalid passenger push revoke");
  }
  // Keep the standalone internal helper consistent with the transactional API:
  // never leave an already-revoked plaintext FCM token behind.
  const result = await requiredDatabase(env).prepare(`
    UPDATE passenger_push_devices
       SET revoked_at = COALESCE(revoked_at, ?3),
           fcm_token = ?4,
           updated_at = MAX(updated_at, ?3)
     WHERE installation_id = ?1 AND order_id = ?2
       AND (revoked_at IS NULL OR fcm_token <> ?4)
  `).bind(installationId, orderId, now, PASSENGER_PUSH_REDACTED_TOKEN).run();

  if (result?.success !== true) throw new Error("Passenger push revoke failed");
  const changes = result?.meta?.changes;
  if (!Number.isSafeInteger(changes) || changes < 0 || changes > 1) {
    throw new Error("Invalid passenger push revoke result");
  }
  return { ok: true };
}
