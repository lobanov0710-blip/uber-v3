import { signJWT } from "./auth.js";
import { verifyPassengerOrderAccess } from "./passengerOrderAccess.js";
import { getOrderById } from "./orderRepository.js";
import { PASSENGER_PUSH_SCOPE, PASSENGER_PUSH_REVOKE_SCOPE } from "./passengerPushGrant.js";
import { allowPassengerPushGrant } from "./passengerPushRateLimit.js";

// Only a time-limited, order-scoped grant is minted here. The existing
// passenger_order:read token is NOT accepted by push-device write operations.
// An explicit deployment flag and dedicated, distinct key are mandatory.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GRANT_TTL_SECONDS = 120;
const ACTIVE_STATUSES = new Set(["new", "taken", "in_progress"]);
const TERMINAL_STATUSES = new Set(["done", "canceled"]);

const forbidden = () => ({ ok: false, status: 403, error: "forbidden" });
const unavailable = () => ({ ok: false, status: 503, error: "passenger push unavailable" });
const badRequest = () => ({ ok: false, status: 400, error: "invalid push grant request" });

function validGrantSecret(env) {
  const secret = env?.PASSENGER_PUSH_GRANT_SECRET;
  return typeof secret === "string" && secret.length >= 32
    && [env?.PASSENGER_ORDER_SECRET, env?.JWT_SECRET, env?.PROXY_HMAC_SECRET]
      .every(other => !other || secret !== other);
}

// Grant issuance is intentionally separate from token/device registration.
// There is no side-effect on order status, staff sessions or push devices.
export async function issuePassengerPushGrant(env, input) {
  if (env?.PASSENGER_PUSH_API_ENABLED !== "true" || !validGrantSecret(env)) {
    return unavailable();
  }
  if (!input || typeof input !== "object" || Array.isArray(input)
      || !Object.hasOwn(input, "accessToken")
      || !Object.hasOwn(input, "installationId")
      || !(Object.keys(input).length === 2
        || (Object.keys(input).length === 3
          && Object.hasOwn(input, "operation")
          && input.operation === "revoke"))) {
    return badRequest();
  }

  // Backwards-compatible 2-field form remains manage-only.
  // The explicit 3-field revoke request can NEVER mint a manage grant.
  const revokeOnly = input.operation === "revoke";
  const { accessToken, installationId } = input;
  if (typeof accessToken !== "string"
      || accessToken.length < 1 || accessToken.length > 8192
      || typeof installationId !== "string" || !UUID.test(installationId)) {
    return badRequest();
  }

  let access;
  try {
    access = await verifyPassengerOrderAccess(env, accessToken);
  } catch {
    return unavailable();
  }
  if (access?.ok !== true || !UUID.test(access.orderId)) {
    return forbidden();
  }

  let order;
  try {
    order = await getOrderById(env, access.orderId);
  } catch {
    return unavailable();
  }

  if (!order || order.id.toLowerCase() !== access.orderId.toLowerCase()
      || !(ACTIVE_STATUSES.has(order.status)
        || (revokeOnly && TERMINAL_STATUSES.has(order.status)))) {
    return forbidden();
  }

  // Fail-closed issuance quota, atomically checked against D1.
  let allowed;
  try {
    allowed = await allowPassengerPushGrant(
      env, order.id, Date.now(), revokeOnly ? "revoke" : "manage"
    );
  } catch {
    return unavailable();
  }
  if (!allowed) {
    return { ok: false, status: 429, error: "rate limited" };
  }

  const signed = await signJWT(env.PASSENGER_PUSH_GRANT_SECRET, {
    sub: order.id.toLowerCase(),
    scope: revokeOnly ? PASSENGER_PUSH_REVOKE_SCOPE : PASSENGER_PUSH_SCOPE,
    installationId: installationId.toLowerCase(),
    jti: crypto.randomUUID()
  }, GRANT_TTL_SECONDS);

  return {
    ok: true,
    grantToken: signed,
    expiresAt: (Math.floor(Date.now() / 1000) + GRANT_TTL_SECONDS) * 1000
  };
}
