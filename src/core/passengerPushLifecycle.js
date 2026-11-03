// PUSH-01D: explicitly invoked maintenance, NOT scheduled or routed.
// Redact plaintext FCM tokens, retain revocation tombstones for replay safety.
const REDACTED_TOKEN = "__REDACTED__";
const USED_GRANT_RETENTION_MS = 60 * 60 * 1000;
const RATE_EVENT_RETENTION_MS = 5 * 60 * 1000;

function requireDb(env) {
  if (!env?.DB || typeof env.DB.prepare !== "function") {
    throw new Error("Passenger push lifecycle DB unavailable");
  }
  return env.DB;
}

function validTime(now) {
  return Number.isSafeInteger(now) && now > USED_GRANT_RETENTION_MS;
}

function validChanges(result) {
  if (result?.success !== true
      || !Number.isSafeInteger(result?.meta?.changes)
      || result.meta.changes < 0) {
    throw new Error("Passenger push lifecycle write failed");
  }
  return result.meta.changes;
}

export async function previewPassengerPushMaintenance(env, now = Date.now()) {
  if (!validTime(now)) throw new Error("Invalid passenger push maintenance time");
  const db = requireDb(env);
  const row = await db.prepare(`
    SELECT COUNT(*) AS count
      FROM passenger_push_devices AS d
     WHERE d.fcm_token <> ?1
       AND (d.revoked_at IS NOT NULL
            OR d.expires_at <= ?2
            OR EXISTS (
                 SELECT 1 FROM orders AS o
                  WHERE o.id = d.order_id
                    AND o.status IN ('done', 'canceled')))
  `).bind(REDACTED_TOKEN, now).first();

  if (!Number.isSafeInteger(row?.count) || row.count < 0) {
    throw new Error("Passenger push maintenance preview failed");
  }
  return { eligibleDeviceTokens: row.count };
}

/**
 * Redact FCM tokens for revoked/expired/terminal registrations. Keep an
 * installation-id tombstone to block re-registration of revoked devices.
 * Retain jti records at least one hour (max JWT TTL 300 sec + clock skew),
 * and grant event records at least five minutes (60 sec sliding window).
 *
 * This function is intentionally NOT scheduled until a separate approval.
 * It never sends FCM or modifies orders/staff state.
 */
export async function maintainPassengerPushData(env, now = Date.now()) {
  if (!validTime(now)) throw new Error("Invalid passenger push maintenance time");
  const db = requireDb(env);

  const redacted = validChanges(await db.prepare(`
    UPDATE passenger_push_devices
       SET fcm_token = ?1,
           revoked_at = COALESCE(revoked_at, ?2),
           updated_at = MAX(updated_at, ?2)
     WHERE fcm_token <> ?1
       AND (revoked_at IS NOT NULL
            OR expires_at <= ?2
            OR EXISTS (
                SELECT 1 FROM orders AS o
                 WHERE o.id = passenger_push_devices.order_id
                   AND o.status IN ('done', 'canceled')))
  `).bind(REDACTED_TOKEN, now).run());

  const expiredEvents = validChanges(await db.prepare(`
    DELETE FROM passenger_push_grant_events WHERE created_at <= ?1
  `).bind(now - RATE_EVENT_RETENTION_MS).run());

  const expiredGrants = validChanges(await db.prepare(`
    DELETE FROM passenger_push_grant_uses WHERE used_at <= ?1
  `).bind(now - USED_GRANT_RETENTION_MS).run());

  return { redacted, expiredEvents, expiredGrants };
}

export const PASSENGER_PUSH_REDACTED_TOKEN = REDACTED_TOKEN;
