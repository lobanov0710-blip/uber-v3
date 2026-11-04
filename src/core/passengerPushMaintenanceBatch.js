import { PASSENGER_PUSH_REDACTED_TOKEN } from "./passengerPushLifecycle.js";

// PUSH-01M. Prepared operator-only, bounded token redaction.
// NO cron, HTTP handler or automatic invocation. No Firebase operation.
const MAX_BATCH_SIZE = 100;
const DEFAULT_BATCH_SIZE = 50;

function validTime(now) {
  return Number.isSafeInteger(now) && now > 0;
}
function requiredDb(env) {
  if (!env?.DB || typeof env.DB.prepare !== "function") {
    throw new Error("Passenger push cleanup D1 unavailable");
  }
  return env.DB;
}

export async function redactPassengerPushTokensBatch(
  env, { now = Date.now(), limit = DEFAULT_BATCH_SIZE, execute = false } = {}
) {
  if (!validTime(now) || !Number.isSafeInteger(limit)
      || limit < 1 || limit > MAX_BATCH_SIZE
      || typeof execute !== "boolean") {
    throw new Error("Invalid passenger push cleanup arguments");
  }

  // By default, only a read-only preview is possible. Even a direct call
  // with execute=true cannot mutate real D1 without two separate opt-ins.
  if (execute && (env?.APP_ENV !== "production"
      || env?.PASSENGER_PUSH_MAINTENANCE_ENABLED !== "true")) {
    throw new Error("Passenger push cleanup execution disabled");
  }

  const db = requiredDb(env);
  let preview;
  try {
    preview = await db.prepare(`
      SELECT COUNT(*) AS count
        FROM (
          SELECT d.installation_id
            FROM passenger_push_devices AS d
           WHERE d.fcm_token <> ?1
             AND (d.revoked_at IS NOT NULL
                  OR d.expires_at <= ?2
                  OR EXISTS (
                    SELECT 1 FROM orders AS o
                     WHERE o.id = d.order_id
                       AND o.status IN ('done', 'canceled')))
           ORDER BY d.expires_at, d.installation_id
           LIMIT ?3
        )
    `).bind(PASSENGER_PUSH_REDACTED_TOKEN, now, limit).first();
  } catch {
    throw new Error("Passenger push cleanup preview unavailable");
  }
  if (!Number.isSafeInteger(preview?.count)
      || preview.count < 0 || preview.count > limit) {
    throw new Error("Passenger push cleanup preview invalid");
  }

  if (!execute || preview.count === 0) {
    return {
      dryRun: !execute, eligibleUpToLimit: preview.count,
      redacted: 0, limit
    };
  }

  // Re-evaluate eligibility inside the UPDATE statement: the preview
  // may already be stale. Never redact more than 'limit' tokens.
  let result;
  try {
    result = await db.prepare(`
      UPDATE passenger_push_devices
         SET fcm_token = ?1,
             revoked_at = COALESCE(revoked_at, ?2),
             updated_at = MAX(updated_at, ?2)
       WHERE installation_id IN (
           SELECT d.installation_id
             FROM passenger_push_devices AS d
            WHERE d.fcm_token <> ?1
              AND (d.revoked_at IS NOT NULL
                   OR d.expires_at <= ?2
                   OR EXISTS (
                     SELECT 1 FROM orders AS o
                      WHERE o.id = d.order_id
                        AND o.status IN ('done', 'canceled')))
            ORDER BY d.expires_at, d.installation_id
            LIMIT ?3
       )
         AND fcm_token <> ?1
    `).bind(PASSENGER_PUSH_REDACTED_TOKEN, now, limit).run();
  } catch {
    throw new Error("Passenger push cleanup write unavailable");
  }
  if (result?.success !== true
      || !Number.isSafeInteger(result?.meta?.changes)
      || result.meta.changes < 0 || result.meta.changes > limit) {
    throw new Error("Passenger push cleanup write invalid");
  }
  return {
    dryRun: false, eligibleUpToLimit: preview.count,
    redacted: result.meta.changes, limit
  };
}
