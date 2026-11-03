import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { signJWT } from "../src/core/auth.js";
import router from "../src/router.js";
import { issuePassengerPushGrant } from "../src/core/passengerPushGrantIssuer.js";
import { verifyPassengerPushGrant } from "../src/core/passengerPushGrant.js";
import { allowPassengerPushGrant } from "../src/core/passengerPushRateLimit.js";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const ORDER_SECRET = "passenger-order-capability-secret-only-for-tests-32bytes";
const PUSH_SECRET = "passenger-push-grant-independent-secret-only-for-tests-32bytes";
const PROXY_SECRET = "proxy-hmac-secret-only-for-tests-32bytes-limited";
const STAFF_SECRET = "staff-jwt-secret-only-for-tests-32bytes-limited";
const ID_A = "68516805-d870-4bc9-ac4a-43995df5bc05";
const ID_B = "16d9080a-72f1-439b-8d82-1eff62f28df0";
const INSTALL = "5d98e332-05e9-4e90-a4e1-bc61c1342030";

const baseEnv = {
  PASSENGER_PUSH_API_ENABLED: "true",
  PASSENGER_PUSH_GRANT_SECRET: PUSH_SECRET,
  PASSENGER_ORDER_SECRET: ORDER_SECRET,
  PROXY_HMAC_SECRET: PROXY_SECRET,
  JWT_SECRET: STAFF_SECRET
};
const calls = [];

function orderRow(id, status = "new") {
  return {
    id, quote_id: null, name: "Test", phone: "+79990000000",
    route: "City A → City B", from_place: "City A", to_place: "City B",
    trip_date: "2026-12-15", comment: "", tariff: "comfort",
    distance_km: 1, duration_minutes: 1, price_rub: 100,
    status, driver_id: null, created_at: 1000, updated_at: 1000
  };
}
function database(row = orderRow(ID_A)) {
  return {
    prepare(sql) {
      const state = { sql, args: [] };
      calls.push(state);
      return {
        bind(...values) { state.args = values; return this; },
        async first() {
          return /FROM orders/i.test(sql) && state.args[0] === row?.id ? row : null;
        },
        async run() {
          return { success: true, meta: { changes: 1 } };
        }
      };
    }
  };
}
async function readToken(orderId = ID_A, secret = ORDER_SECRET, scope = "passenger_order:read") {
  return signJWT(secret, { sub: orderId, scope }, 1800);
}
async function signature(path, body, timestamp, nonce, method = "POST") {
  const canonical = ["PASSENGER-PUSH-V2", method, String(timestamp),
    path, nonce, body].join("\n");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(PROXY_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(canonical)));
  return Array.from(digest, b => b.toString(16).padStart(2,"0")).join("");
}
async function request(payload, options = {}) {
  const path = options.path || "/passenger/push-grant";
  const body = JSON.stringify(payload);
  const timestamp = options.timestamp ?? Math.floor(Date.now()/1000);
  const headers = { "Content-Type": "application/json" };
  if (options.signed !== false) {
    const nonce = options.nonce || crypto.randomUUID().replaceAll("-", "");
    headers["X-Proxy-Timestamp"] = String(timestamp);
    if (!options.noNonce) headers["X-Proxy-Nonce"] = nonce;
    headers["X-Proxy-Signature"] = await signature(path, body, timestamp, nonce);
  }
  if (options.invalidSignature) headers["X-Proxy-Signature"] = "0".repeat(64);
  return new Request("https://worker.example" + path, {
    method: options.method || "POST", headers, body: options.method === "GET" ? undefined : body
  });
}
async function test(name, fn) {
  try { await fn(); console.log("✓", name); }
  catch (error) { process.exitCode = 1; console.error("✘", name, error); }
}

await test("grant rate limiter accepts signed order in mock D1", async () => {
  calls.length = 0;
  const allowed = await allowPassengerPushGrant({ DB: database() }, ID_A);
  assert.equal(allowed, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].args[1], ID_A);
});

await test("authorized grant uses only order from verified passenger read token", async () => {
  calls.length = 0;
  const env = { ...baseEnv, DB: database() };
  const result = await issuePassengerPushGrant(env, {
    accessToken: await readToken(), installationId: INSTALL
  });
  assert.equal(result.ok, true, `grant error=${result.error || "none"} status=${result.status || "none"}`);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].args[0], ID_A);
  assert.equal(calls[1].args[1], ID_A);
  const verified = await verifyPassengerPushGrant(env, result.grantToken);
  assert.equal(verified.orderId, ID_A);
  assert.equal(verified.installationId, INSTALL);
  assert.ok(verified.expiresAt > Date.now());
  assert.ok(verified.expiresAt <= Date.now() + 122_000);
});

await test("wrong read token scope and another order fail without exposing information", async () => {
  const cases = [
    [await readToken(ID_B), 403, 1],
    [await readToken(ID_A, ORDER_SECRET, "staff"), 403, 0],
    [await readToken(ID_A, STAFF_SECRET), 403, 0],
    ["", 400, 0]
  ];
  for (const [token, expected, dbCalls] of cases) {
    calls.length = 0;
    const result = await issuePassengerPushGrant(
      { ...baseEnv, DB: database() },
      { accessToken: token, installationId: INSTALL }
    );
    assert.equal(result.status, expected);
    assert.equal(calls.length, dbCalls);
  }
});

await test("completed/canceled orders are not eligible for push grant", async () => {
  for (const status of ["done", "canceled"]) {
    const result = await issuePassengerPushGrant({
      ...baseEnv, DB: database(orderRow(ID_A, status))
    }, { accessToken: await readToken(), installationId: INSTALL });
    assert.equal(result.status, 403);
  }
});

await test("fail closed when feature disabled or secret missing/colliding", async () => {
  for (const env of [
    { ...baseEnv, PASSENGER_PUSH_API_ENABLED: "false" },
    { ...baseEnv, PASSENGER_PUSH_GRANT_SECRET: undefined },
    { ...baseEnv, PASSENGER_PUSH_GRANT_SECRET: ORDER_SECRET },
    { ...baseEnv, PASSENGER_PUSH_GRANT_SECRET: STAFF_SECRET },
    { ...baseEnv, PASSENGER_PUSH_GRANT_SECRET: PROXY_SECRET }
  ]) {
    const result = await issuePassengerPushGrant(
      { ...env, DB: database() }, { accessToken: await readToken(), installationId: INSTALL }
    );
    assert.equal(result.status, 503);
  }
});

await test("request shape rejects unknown orderId, token and invalid installation", async () => {
  for (const input of [
    { accessToken: await readToken(), installationId: INSTALL, orderId: ID_B },
    { accessToken: await readToken(), installationId: INSTALL, fcmToken: "secret" },
    { accessToken: await readToken(), installationId: "not-uuid" },
    { accessToken: await readToken() },
    null
  ]) {
    const r = await issuePassengerPushGrant(
      { ...baseEnv, DB: database() }, input
    );
    assert.equal(r.status, 400);
  }
});

await test("new POST endpoint requires HMAC and does not cache grant", async () => {
  calls.length = 0;
  const env = { ...baseEnv, DB: database() };
  const payload = { accessToken: await readToken(), installationId: INSTALL };
  const response = await router(await request(payload), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const data = await response.json();
  assert.equal(data.ok, true);
  assert.ok((await verifyPassengerPushGrant(env, data.grantToken)) !== null);
  assert.equal(calls.length, 3);
  assert.match(calls[0].sql, /INSERT OR IGNORE INTO passenger_push_proxy_nonces/);
  assert.equal(calls[1].args[0], ID_A);
  assert.equal(calls[2].args[1], ID_A);
});

await test("route rejects missing HMAC, invalid HMAC and expired timestamp", async () => {
  for (const options of [
    { signed: false },
    { noNonce: true },
    { invalidSignature: true },
    { timestamp: Math.floor(Date.now()/1000) - 700 }
  ]) {
    calls.length = 0;
    const result = await router(await request(
      { accessToken: await readToken(), installationId: INSTALL }, options
    ), { ...baseEnv, DB: database() });
    assert.equal(result.status, 403);
    assert.equal(calls.length, 0);
  }
});

await test("route never becomes public without explicit feature flag", async () => {
  calls.length = 0;
  const response = await router(await request(
    { accessToken: await readToken(), installationId: INSTALL }
  ), { ...baseEnv, DB: database(), PASSENGER_PUSH_API_ENABLED: undefined });
  assert.equal(response.status, 503);
  assert.equal(calls.length, 0);
});

await test("route rejects invalid method and does not touch D1", async () => {
  calls.length = 0;
  const response = await router(await request(
    { accessToken: await readToken(), installationId: INSTALL }, { method: "GET" }
  ), { ...baseEnv, DB: database() });
  assert.equal(response.status, 405);
  assert.equal(calls.length, 0);
});

if (!process.exitCode) console.log("✓ ALL PASSENGER PUSH GRANT ISSUER TESTS PASSED");
