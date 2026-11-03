import assert from "node:assert/strict";
import { createHmac, randomBytes, webcrypto } from "node:crypto";
import { signJWT } from "../src/core/auth.js";

// Runs only with a local workerd spawned using --local and a temporary fake
// D1 binding. Guard against all non-loopback origins before any network call.
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const readKey = "push01h-ci-passenger-read-fake-key-at-least-32-characters";
const pushKey = "push01h-ci-passenger-push-fake-key-at-least-32-characters";
const hmacKey = "push01h-ci-proxy-hmac-fake-key-at-least-32-characters";
const ORDER = "68516805-d870-4bc9-ac4a-43995df5bc05";
const INSTALL = "5d98e332-05e9-4e90-a4e1-bc61c1342030";
const port = Number(process.env.TS52_LOCAL_WORKER_PORT);
assert.ok(Number.isInteger(port) && port > 1024 && port < 65536);
const origin = new URL("http://127.0.0.1:" + port);
assert.equal(origin.hostname, "127.0.0.1");
assert.equal(origin.protocol, "http:");

function signature(method, route, raw, nonce, epoch) {
  const canonical = ["PASSENGER-PUSH-V2", method, String(epoch),
    route, nonce, raw].join("\n");
  return createHmac("sha256", hmacKey).update(canonical).digest("hex");
}

async function request(method, route, data, settings = {}) {
  assert.ok(route === "/passenger/push-grant" || route === "/passenger/push-device");
  const raw = JSON.stringify(data);
  const nonce = settings.nonce || randomBytes(16).toString("hex");
  const epoch = settings.epoch || Math.floor(Date.now() / 1000);
  const headers = {
    "Content-Type": "application/json",
    "X-Proxy-Timestamp": String(epoch),
    "X-Proxy-Nonce": nonce,
    "X-Proxy-Signature": signature(method, route, raw, nonce, epoch)
  };
  const result = await fetch(origin + route, {
    method, headers, body: raw, redirect: "error"
  });
  return { status: result.status, data: await result.json(), nonce };
}

const health = await fetch(origin);
assert.equal(health.status, 200, "Local Worker must respond to health");
assert.equal((await health.json()).ok, true);

const readToken = await signJWT(readKey, {
  sub: ORDER, scope: "passenger_order:read"
}, 1800);

async function grant(nonce) {
  const response = await request("POST", "/passenger/push-grant", {
    accessToken: readToken, installationId: INSTALL
  }, nonce ? { nonce } : {});
  assert.equal(response.status, 200, "Grant requires actual local D1 order");
  assert.equal(typeof response.data.grantToken, "string");
  return response.data.grantToken;
}

const firstNonce = randomBytes(16).toString("hex");
const first = await grant(firstNonce);

// Exactly identical authenticated request nonce must never issue twice.
const duplicate = await request("POST", "/passenger/push-grant", {
  accessToken: readToken, installationId: INSTALL
}, { nonce: firstNonce });
assert.equal(duplicate.status, 403);

const register = await request("POST", "/passenger/push-device", {
  grantToken: first, platform: "android", token: "test-not-an-actual-fcm-token"
});
assert.equal(register.status, 200);
assert.deepEqual(register.data, { ok: true });

// A *fresh HMAC nonce* cannot replay an already consumed push grant.
const replay = await request("POST", "/passenger/push-device", {
  grantToken: first, platform: "android", token: "test-other-token"
});
assert.equal(replay.status, 409);

const revoke = await request("DELETE", "/passenger/push-device", {
  grantToken: await grant()
});
assert.equal(revoke.status, 200);

const blocked = await request("POST", "/passenger/push-device", {
  grantToken: await grant(), platform: "android", token: "must-not-register"
});
assert.equal(blocked.status, 409);

const noGrant = await request("POST", "/passenger/push-grant", {
  accessToken: "invalid", installationId: INSTALL
});
assert.equal(noGrant.status, 403);

console.log("PUSH01H_REAL_LOCAL_WORKER_D1=PASS");
