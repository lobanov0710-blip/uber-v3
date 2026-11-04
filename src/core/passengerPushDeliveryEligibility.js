import { PASSENGER_PUSH_REDACTED_TOKEN } from "./passengerPushLifecycle.js";

// PUSH-01K: read-side authorization for a FUTURE passenger-FCM sender.
// It does not dispatch, cache, log or expose HTTP access to FCM tokens.
// Every outgoing message must perform a fresh lookup immediately before send.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIVE_STATUSES = new Set(["new", "taken", "in_progress"]);

export async function findEligiblePassengerPushTarget(
  env, orderId, installationId, now = Date.now()
) {
  if (typeof orderId !== "string" || !UUID.test(orderId)
      || typeof installationId !== "string" || !UUID.test(installationId)
      || !Number.isSafeInteger(now) || now <= 0) {
    throw new Error("Invalid passenger delivery target");
  }

  // Independent opt-in: existing registration/API flags do not enable
  // outgoing FCM. Never authorize a delivery in staging/unspecified APP_ENV.
  if (env?.PASSENGER_PUSH_DELIVERY_ENABLED !== "true"
      || env?.PASSENGER_PUSH_API_ENABLED !== "true"
      || env?.PASSENGER_PUSH_DEVICES_ENABLED !== "true"
      || env?.APP_ENV !== "production") {
    return null;
  }
  if (!env?.DB || typeof env.DB.prepare !== "function") {
    throw new Error("Passenger push delivery DB unavailable");
  }

  let row;
  try {
    row = await env.DB.prepare(`
      SELECT d.installation_id, d.order_id, d.platform, d.fcm_token,
             d.updated_at, d.expires_at, d.revoked_at,
             o.status AS order_status
        FROM passenger_push_devices AS d
        INNER JOIN orders AS o ON o.id = d.order_id
       WHERE d.order_id = ?1
         AND d.installation_id = ?2
         AND d.platform = 'android'
         AND d.revoked_at IS NULL
         AND d.expires_at > ?3
         AND d.updated_at <= ?3
         AND d.fcm_token <> ?4
         AND o.status IN ('new', 'taken', 'in_progress')
       LIMIT 1
    `).bind(orderId.toLowerCase(), installationId.toLowerCase(),
      now, PASSENGER_PUSH_REDACTED_TOKEN).first();
  } catch {
    throw new Error("Passenger push delivery eligibility query failed");
  }

  if (row === null) return null;

  // Re-check even the result shape; malformed D1 responses fail closed.
  if (!row || typeof row !== "object"
      || row.order_id !== orderId.toLowerCase()
      || row.installation_id !== installationId.toLowerCase()
      || row.platform !== "android"
      || !ACTIVE_STATUSES.has(row.order_status)
      || row.revoked_at !== null
      || !Number.isSafeInteger(row.updated_at) || row.updated_at > now
      || !Number.isSafeInteger(row.expires_at) || row.expires_at <= now
      || typeof row.fcm_token !== "string"
      || row.fcm_token.length < 1 || row.fcm_token.length > 4096
      || row.fcm_token === PASSENGER_PUSH_REDACTED_TOKEN
      || /\s/.test(row.fcm_token)) {
    throw new Error("Passenger push delivery eligibility result invalid");
  }
  return {
    orderId: row.order_id,
    installationId: row.installation_id,
    fcmToken: row.fcm_token
  };
}
