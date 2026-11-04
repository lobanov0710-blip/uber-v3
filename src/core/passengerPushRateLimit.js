// PUSH-01J. Atomic rolling 60-second window: 4 manage + 1 reserved revoke.
// No increase to the five-total ceiling, no authentication bypass.
//
// Call ONLY after read capability and authoritative order verification.
// Per-order quota is NOT an anonymous IP/WAF abuse safeguard.
const WINDOW_MS = 60_000;
const MAX_TOTAL_GRANTS = 5;
const MAX_MANAGE_GRANTS = 4;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function allowPassengerPushGrant(
  env, orderId, now = Date.now(), purpose = "manage"
) {
  if (!env?.DB || typeof env.DB.prepare !== "function") {
    throw new Error("Passenger push limiter DB unavailable");
  }
  if (typeof orderId !== "string" || !UUID.test(orderId)) {
    throw new Error("Passenger push limiter invalid order");
  }
  if (!Number.isSafeInteger(now) || now <= WINDOW_MS) {
    throw new Error("Passenger push limiter invalid clock");
  }
  if (purpose !== "manage" && purpose !== "revoke") {
    throw new Error("Passenger push limiter invalid purpose");
  }
  // Purpose is chosen only by the validated issuer request, never a client flag.
  const maximum = purpose === "revoke" ? MAX_TOTAL_GRANTS : MAX_MANAGE_GRANTS;
  const eventId = crypto.randomUUID();
  const result = await env.DB.prepare(`
    INSERT INTO passenger_push_grant_events
      (event_id, order_id, created_at)
    SELECT ?1, ?2, ?3
     WHERE (SELECT COUNT(*)
              FROM passenger_push_grant_events
             WHERE order_id = ?2 AND created_at > ?4) < ?5
  `).bind(eventId, orderId.toLowerCase(), now, now - WINDOW_MS, maximum).run();

  if (result?.success !== true || !Number.isSafeInteger(result?.meta?.changes)
      || result.meta.changes < 0 || result.meta.changes > 1) {
    throw new Error("Passenger push rate limiter failed");
  }
  return result.meta.changes === 1;
}
