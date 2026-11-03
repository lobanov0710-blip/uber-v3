// PUSH-01D. Atomic true rolling 60-second window: count individual
// successful issuance events. A pair of adjacent windows cannot bypass
// the five-issuance ceiling.
//
// Call ONLY after read capability and authoritative order verification.
// Per-order quota is NOT an anonymous IP/WAF abuse safeguard.
const WINDOW_MS = 60_000;
const MAX_GRANTS = 5;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function allowPassengerPushGrant(env, orderId, now = Date.now()) {
  if (!env?.DB || typeof env.DB.prepare !== "function") {
    throw new Error("Passenger push limiter DB unavailable");
  }
  if (typeof orderId !== "string" || !UUID.test(orderId)) {
    throw new Error("Passenger push limiter invalid order");
  }
  if (!Number.isSafeInteger(now) || now <= WINDOW_MS) {
    throw new Error("Passenger push limiter invalid clock");
  }
  const eventId = crypto.randomUUID();
  const result = await env.DB.prepare(`
    INSERT INTO passenger_push_grant_events
      (event_id, order_id, created_at)
    SELECT ?1, ?2, ?3
     WHERE (SELECT COUNT(*)
              FROM passenger_push_grant_events
             WHERE order_id = ?2 AND created_at > ?4) < ?5
  `).bind(eventId, orderId.toLowerCase(), now, now - WINDOW_MS, MAX_GRANTS).run();

  if (result?.success !== true || !Number.isSafeInteger(result?.meta?.changes)
      || result.meta.changes < 0 || result.meta.changes > 1) {
    throw new Error("Passenger push rate limiter failed");
  }
  return result.meta.changes === 1;
}
