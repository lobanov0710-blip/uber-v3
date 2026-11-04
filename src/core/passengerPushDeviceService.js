import { verifyPassengerPushGrant } from "./passengerPushGrant.js";
import { PASSENGER_PUSH_REDACTED_TOKEN } from "./passengerPushLifecycle.js";
import {
  registerPassengerPushOnce, revokePassengerPushOnce
} from "./passengerPushDeviceTransactions.js";

// Provisional renewal window, NOT final notification retention policy.
// Can be changed only after contract review and mobile-registration design.
const REGISTRATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 60_000;

const forbidden = () => ({ ok: false, status: 403, error: "forbidden" });
const badRequest = () => ({ ok: false, status: 400, error: "invalid push device" });
const conflict = () => ({ ok: false, status: 409, error: "registration not available" });

function exactKeys(input, keys) {
  return input && typeof input === "object" && !Array.isArray(input)
    && Object.keys(input).length === keys.length
    && Object.keys(input).every(key => keys.includes(key));
}

// Deliberately no HTTP handler. "grantToken" is not the read-only
// passenger_order:read token. It must be minted by a future, separate,
// verified-ownership flow that is NOT part of this PR.
export async function registerPassengerDevice(env, grantToken, input, now = Date.now()) {
  const principal = await verifyPassengerPushGrant(env, grantToken, now);
  if (!principal) return forbidden();
  if (!exactKeys(input, ["platform", "token"])
    || input.platform !== "android"
    || typeof input.token !== "string"
    || input.token.length < 1 || input.token.length > 4096
    || input.token === PASSENGER_PUSH_REDACTED_TOKEN
    || /\s/.test(input.token)
    || !Number.isSafeInteger(now) || now <= 0) {
    return badRequest();
  }
  const expiresAt = now + REGISTRATION_TTL_MS;
  if (!Number.isSafeInteger(expiresAt)
    || principal.expiresAt + MAX_CLOCK_SKEW_MS < now) {
    return forbidden();
  }
  try {
    const stored = await registerPassengerPushOnce(
      env, principal, input.token, now, expiresAt
    );
    return stored ? { ok: true } : conflict();
  } catch {
    // D1 transactional constraint failure (replayed jti) or unavailable DB:
    // do not reveal token, order, install ID or row-existence information.
    return conflict();
  }
}

export async function unregisterPassengerDevice(env, grantToken, now = Date.now()) {
  // DELETE accepts the narrow revoke-only scope, but POST remains manage-only.
  // Legacy manage-grant DELETE is accepted for backwards compatibility.
  const principal = await verifyPassengerPushGrant(env, grantToken, now, true);
  if (!principal) return forbidden();
  try {
    await revokePassengerPushOnce(env, principal, now);
    return { ok: true };
  } catch {
    return conflict();
  }
}
