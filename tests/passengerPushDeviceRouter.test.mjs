import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { signJWT } from "../src/core/auth.js";
import router from "../src/router.js";
import { PASSENGER_PUSH_SCOPE } from "../src/core/passengerPushGrant.js";
import { allowPassengerPushGrant } from "../src/core/passengerPushRateLimit.js";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const PUSH_SECRET = "passenger-push-secret-for-CI-isolated-application-long-key";
const ORDER_SECRET = "passenger-order-secret-for-CI-isolated-application-key";
const PROXY_SECRET = "proxy-hmac-secret-for-CI-isolated-application-key";
const STAFF_SECRET = "staff-jwt-secret-for-CI-isolated-application-long-key";
const ORDER = "68516805-d870-4bc9-ac4a-43995df5bc05";
const INSTALL = "5d98e332-05e9-4e90-a4e1-bc61c1342030";
const envBase = {
  PASSENGER_PUSH_API_ENABLED: "true",
  PASSENGER_PUSH_DEVICES_ENABLED: "true",
  PASSENGER_PUSH_GRANT_SECRET: PUSH_SECRET,
  PASSENGER_ORDER_SECRET: ORDER_SECRET,
  PROXY_HMAC_SECRET: PROXY_SECRET,
  JWT_SECRET: STAFF_SECRET
};

function database() {
  const calls = [];
  const used = new Set();
  const nonces = new Set();
  const devices = new Map();
  const rateTimes = [];
  const DB = {
    prepare(sql) {
      const entry = { sql, args: [] };
      calls.push(entry);
      const stmt = {
        bind(...args) { entry.args = args; return stmt; },
        async run() {
          if (/INSERT OR IGNORE INTO passenger_push_proxy_nonces/.test(sql)) {
            if (nonces.has(entry.args[0])) {
              return { success: true, meta: { changes: 0 } };
            }
            nonces.add(entry.args[0]);
          }
          if (/INSERT INTO passenger_push_grant_events/.test(sql)) {
            const now = entry.args[2], cutoff = entry.args[3];
            const inWindow = rateTimes.filter(time => time > cutoff).length;
            if (inWindow >= 5) return { success: true, meta: { changes: 0 } };
            rateTimes.push(now);
          }
          return { success: true, meta: { changes: 1 } };
        },
        async first() {
          if (/FROM orders/.test(sql) && entry.args[0] === ORDER) {
            return { id: ORDER, status: "new" };
          }
          return null;
        }
      };
      return stmt;
    },
    async batch(statements) {
      assert.equal(statements.length, 2);
      const claim = calls[calls.length - 2], write = calls[calls.length - 1];
      assert.match(claim.sql, /INSERT INTO passenger_push_grant_uses/);
      const [id, order, install] = claim.args;
      if (used.has(id)) throw new Error("UNIQUE constraint failed: grant_id");
      assert.equal(order, ORDER);
      assert.equal(install, INSTALL);
      const previous = devices.get(install);
      let changes = 0;
      if (/INSERT INTO passenger_push_devices/.test(write.sql)) {
        if (!previous || previous.order === order && !previous.revoked) {
          devices.set(install, { order, revoked: false, token: write.args[2] });
          changes = 1;
        }
      } else {
        assert.match(write.sql, /UPDATE passenger_push_devices/);
        if (previous && previous.order === order && !previous.revoked) {
          previous.revoked = true; changes = 1;
        }
      }
      used.add(id);
      return [{ success: true, meta: { changes: 1 } },
              { success: true, meta: { changes } }];
    }
  };
  return { DB, calls, used, devices };
}

async function grant(jti = crypto.randomUUID(), extra = {}) {
  return signJWT(PUSH_SECRET, {
    scope: PASSENGER_PUSH_SCOPE,
    sub: ORDER,
    installationId: INSTALL,
    jti, ...extra
  }, 120);
}

async function signedRequest(method, payload, options = {}) {
  const path = options.path || "/passenger/push-device";
  const body = JSON.stringify(payload);
  const timestamp = String(options.timestamp ?? Math.floor(Date.now() / 1000));
  const headers = { "Content-Type": "application/json" };
  if (!options.missingHmac) {
    const nonce = options.nonce || crypto.randomUUID().replaceAll("-", "");
    const canonical = ["PASSENGER-PUSH-V2", method,
      timestamp, path, nonce, body].join("\n");
    const key = await crypto.subtle.importKey("raw",
      new TextEncoder().encode(PROXY_SECRET),
      { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const buffer = new Uint8Array(await crypto.subtle.sign(
      "HMAC", key, new TextEncoder().encode(canonical)));
    headers["X-Proxy-Timestamp"] = timestamp;
    if (!options.noNonce) headers["X-Proxy-Nonce"] = nonce;
    headers["X-Proxy-Signature"] = Array.from(buffer, b =>
      b.toString(16).padStart(2, "0")).join("");
  }
  if (options.badHmac) headers["X-Proxy-Signature"] = "0".repeat(64);
  return new Request("https://worker.test" + path, {
    method, headers, body: method === "GET" ? undefined : body
  });
}

async function test(name, fn) {
  try { await fn(); console.log("✓", name); }
  catch (error) { console.error("✘", name, error); process.exitCode = 1; }
}

await test("POST registers only once; replayed grant cannot rotate token", async () => {
  const db = database();
  const currentGrant = await grant();
  const payload = { grantToken: currentGrant, platform: "android", token: "fcm-one" };
  const first = await router(await signedRequest("POST", payload),
    { ...envBase, DB: db.DB });
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("Cache-Control"), "no-store");
  assert.equal(db.devices.get(INSTALL).token, "fcm-one");

  const second = await router(await signedRequest("POST",
    { ...payload, token: "fcm-other" }), { ...envBase, DB: db.DB });
  assert.equal(second.status, 409);
  assert.equal(db.devices.get(INSTALL).token, "fcm-one");
  assert.equal(db.used.size, 1);
});

await test("new grant revokes only own installation and prevents reinsertion", async () => {
  const db = database();
  assert.equal((await router(await signedRequest("POST", {
    grantToken: await grant(), platform: "android", token: "fcm-one"
  }), { ...envBase, DB: db.DB })).status, 200);
  const revoked = await router(await signedRequest("DELETE", {
    grantToken: await grant()
  }), { ...envBase, DB: db.DB });
  assert.equal(revoked.status, 200);
  assert.equal(db.devices.get(INSTALL).revoked, true);
  assert.equal((await router(await signedRequest("POST", {
    grantToken: await grant(), platform: "android", token: "fcm-replay"
  }), { ...envBase, DB: db.DB })).status, 409);
});

await test("missing flags and missing HMAC fail before any D1 operation", async () => {
  const db = database(), data = {
    grantToken: await grant(), platform: "android", token: "fcm"
  };
  for (const opt of [{ missingHmac: true }, { badHmac: true }]) {
    const result = await router(await signedRequest("POST", data, opt),
      { ...envBase, DB: db.DB });
    assert.equal(result.status, 403);
  }
  for (const missing of [
    { PASSENGER_PUSH_API_ENABLED: undefined },
    { PASSENGER_PUSH_DEVICES_ENABLED: undefined }
  ]) {
    const result = await router(await signedRequest("POST", data),
      { ...envBase, ...missing, DB: db.DB });
    assert.equal(result.status, 503);
  }
  assert.equal(db.calls.length, 0);
});

await test("body cannot contain orderId, installationId or read-only token", async () => {
  const db = database(), token = await grant();
  for (const payload of [
    { grantToken: token, platform: "android", token: "fcm", orderId: ORDER },
    { grantToken: token, platform: "android", token: "fcm", installationId: INSTALL },
    { grantToken: token, platform: "android", token: "fcm", accessToken: "stolen" },
    { grantToken: token, token: "fcm" },
    { grantToken: token, platform: "android", token: "fcm", status: "taken" }
  ]) {
    const result = await router(await signedRequest("POST", payload),
      { ...envBase, DB: db.DB });
    assert.equal(result.status, 400);
  }
  // Valid HMAC consumes a nonce, but must never attempt device writes.
  assert.equal(db.calls.filter(x => /passenger_push_grant_uses|passenger_push_devices/.test(x.sql)).length, 0);
});

await test("GET rejected; DELETE rejects additional attacker fields", async () => {
  const db = database(), token = await grant();
  assert.equal((await router(await signedRequest("GET", { grantToken: token }),
    { ...envBase, DB: db.DB })).status, 405);
  assert.equal((await router(await signedRequest("DELETE", {
    grantToken: token, orderId: ORDER
  }), { ...envBase, DB: db.DB })).status, 400);
  assert.equal(db.calls.filter(x => /passenger_push_grant_uses|passenger_push_devices/.test(x.sql)).length, 0);
});

await test("identical HMAC nonce replay is rejected before grant consumption", async () => {
  const db = database(), token = await grant();
  const data = { grantToken: token, platform: "android", token: "fcm" };
  const nonce = "a".repeat(32);
  const request1 = await signedRequest("POST", data, { nonce });
  const request2 = await signedRequest("POST", data, { nonce });
  const first = await router(request1, { ...envBase, DB: db.DB });
  assert.equal(first.status, 200);
  const second = await router(request2, { ...envBase, DB: db.DB });
  assert.equal(second.status, 403);
  assert.equal(db.used.size, 1);
  assert.equal(db.devices.get(INSTALL).token, "fcm");
});

await test("atomic D1 rate limiter allows 5 grants per order per minute", async () => {
  const db = database();
  for (let i = 0; i < 5; i++) {
    assert.equal(await allowPassengerPushGrant({ DB: db.DB }, ORDER, 1793700000000 + i), true);
  }
  assert.equal(await allowPassengerPushGrant({ DB: db.DB }, ORDER, 1793700000006), false);
  assert.equal(await allowPassengerPushGrant({ DB: db.DB }, ORDER, 1793700059999), false);
  assert.equal(await allowPassengerPushGrant({ DB: db.DB }, ORDER, 1793700060000), true);
  assert.equal(await allowPassengerPushGrant({ DB: db.DB }, ORDER, 1793700060000), false);
  assert.equal(await allowPassengerPushGrant({ DB: db.DB }, ORDER, 1793700060100), true);
});

if (!process.exitCode) console.log("✓ PASSENGER PUSH DEVICE ROUTER AND RATE TESTS PASSED");
