// One atomic per-order sliding-window guard; auth and authoritative D1
// ownership MUST be checked before calling. Does not log identifiers.
const WINDOW_MS = 60_000;
const MAX_GRANTS = 5;

export async function allowPassengerPushGrant(env, orderId, now = Date.now()) {
  if (!env?.DB || typeof orderId !== "string"
      || !Number.isSafeInteger(now) || now <= 0) {
    throw new Error("Passenger push rate limiter unavailable");
  }
  const windowStart = now - WINDOW_MS;
  const result = await env.DB.prepare(`
    INSERT INTO passenger_push_grant_limits (order_id, window_start, attempts)
    VALUES (?1, ?2, 1)
    ON CONFLICT(order_id) DO UPDATE SET
      window_start = CASE
        WHEN passenger_push_grant_limits.window_start <= ?3
          THEN excluded.window_start
        ELSE passenger_push_grant_limits.window_start END,
      attempts = CASE
        WHEN passenger_push_grant_limits.window_start <= ?3 THEN 1
        ELSE passenger_push_grant_limits.attempts + 1 END
    WHERE passenger_push_grant_limits.window_start <= ?3
       OR passenger_push_grant_limits.attempts < ?4
  `).bind(orderId, now, windowStart, MAX_GRANTS).run();

  if (result?.success !== true || !Number.isSafeInteger(result?.meta?.changes)
      || result.meta.changes < 0 || result.meta.changes > 1) {
    throw new Error("Passenger push rate limiter failed");
  }
  return result.meta.changes === 1;
}
