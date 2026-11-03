import { verifyJWT } from "./auth.js";

// This verifier is intentionally NOT connected to router.js. A future,
// separate credential issuer must first verify passenger_order:read ownership.
// NEVER treat a read-only passenger order capability as a write grant.
export const PASSENGER_PUSH_SCOPE = "passenger_push:manage";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_GRANT_SECONDS = 300;

export async function verifyPassengerPushGrant(env, token, now = Date.now()) {
  const secret = env?.PASSENGER_PUSH_GRANT_SECRET;
  const isDistinct = typeof secret === "string" && secret.length >= 32
    && [env?.PASSENGER_ORDER_SECRET, env?.JWT_SECRET, env?.PROXY_HMAC_SECRET]
      .every(value => !value || value !== secret);

  if (!isDistinct || typeof token !== "string" || token.length > 8192) {
    return null;
  }

  const payload = await verifyJWT(secret, token);
  if (!payload || payload.scope !== PASSENGER_PUSH_SCOPE
    || typeof payload.sub !== "string"
    || typeof payload.installationId !== "string"
    || !UUID.test(payload.sub) || !UUID.test(payload.installationId)
    || typeof payload.jti !== "string" || !UUID.test(payload.jti)
    || !Number.isSafeInteger(payload.exp)
    || !Number.isSafeInteger(payload.iat)
    || payload.exp <= payload.iat
    || payload.exp - payload.iat > MAX_GRANT_SECONDS
    || payload.iat * 1000 > now + 60_000
    || payload.exp * 1000 <= now) {
    return null;
  }

  return {
    orderId: payload.sub.toLowerCase(),
    installationId: payload.installationId.toLowerCase(),
    grantId: payload.jti.toLowerCase(),
    expiresAt: payload.exp * 1000
  };
}
