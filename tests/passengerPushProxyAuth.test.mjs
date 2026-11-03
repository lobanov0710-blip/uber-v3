import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import {
  verifyPassengerPushProxyRequest, prunePassengerPushProxyNonces
} from "../src/core/passengerPushProxyAuth.js";
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const KEY = "only-for-v2-proxy-unit-tests-64-byte-independent-key";
const GRANT = "/passenger/push-grant";
const DEVICE = "/passenger/push-device";
const NOW = 1793700000000;

function localDB() {
  const seen = new Map();
  const DB = {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() {
              if (/INSERT OR IGNORE INTO passenger_push_proxy_nonces/.test(sql)) {
                if (seen.has(args[0])) return { success: true, meta: { changes: 0 } };
                seen.set(args[0], args[1]);
                return { success: true, meta: { changes: 1 } };
              }
              if (/DELETE FROM passenger_push_proxy_nonces/.test(sql)) {
                let removed = 0;
                for (const [nonce, time] of seen) {
                  if (time <= args[0]) { seen.delete(nonce); removed++; }
                }
                return { success: true, meta: { changes: removed } };
              }
              throw new Error("Unexpected SQL");
            }
          };
        }
      };
    }
  };
  return { DB, seen };
}

async function signature(method, path, body, timestamp, nonce, legacy = false) {
  const canonical = legacy
    ? [String(timestamp), path, body].join("\n")
    : ["PASSENGER-PUSH-V2", method, String(timestamp),
      path, nonce, body].join("\n");
  const key = await crypto.subtle.importKey("raw",
    new TextEncoder().encode(KEY),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return Array.from(new Uint8Array(await crypto.subtle.sign(
    "HMAC", key, new TextEncoder().encode(canonical)
  )), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function signed({ method = "POST", path = GRANT, body = "{}",
  now = NOW, nonce = crypto.randomUUID().replaceAll("-", ""), legacy = false,
  signedMethod = method, signedPath = path, signedBody = body,
  noNonce = false, noSignature = false, noTimestamp = false,
  tamperedNonce = false } = {}) {
  const timestamp = Math.floor(now / 1000);
  const headers = { "Content-Type": "application/json" };
  if (!noTimestamp) headers["X-Proxy-Timestamp"] = String(timestamp);
  if (!noNonce) headers["X-Proxy-Nonce"] = tamperedNonce
    ? "f".repeat(32) : nonce;
  if (!noSignature) headers["X-Proxy-Signature"] =
    await signature(signedMethod, signedPath, signedBody, timestamp, nonce, legacy);
  return new Request("https://worker.invalid" + path, { method, body, headers });
}

async function test(label, fn) {
  try { await fn(); console.log("PASS:", label); }
  catch (e) { process.exitCode = 1; console.error("FAIL:", label, e); }
}

await test("nonce is atomically consumed once under concurrent replay", async () => {
  const { DB, seen } = localDB(), env = { DB, PROXY_HMAC_SECRET: KEY };
  const nonce = "a".repeat(32);
  const request1 = await signed({ nonce });
  const request2 = await signed({ nonce });
  const [a, b] = await Promise.all([
    verifyPassengerPushProxyRequest(request1, env, GRANT, NOW),
    verifyPassengerPushProxyRequest(request2, env, GRANT, NOW)
  ]);
  assert.deepEqual([a.ok, b.ok].sort(), [false, true]);
  assert.equal(seen.size, 1);
});

await test("unique nonces for same body and timestamp are independent", async () => {
  const env = { PROXY_HMAC_SECRET: KEY, DB: localDB().DB };
  assert.equal((await verifyPassengerPushProxyRequest(
    await signed({ nonce: "a".repeat(32) }), env, GRANT, NOW)).ok, true);
  assert.equal((await verifyPassengerPushProxyRequest(
    await signed({ nonce: "b".repeat(32) }), env, GRANT, NOW)).ok, true);
});

await test("legacy v1 HMAC, method/body/path/nonce tampering fail", async () => {
  const { DB, seen } = localDB(), env = { DB, PROXY_HMAC_SECRET: KEY };
  const inputs = [
    { legacy: true },
    { method: "DELETE", path: DEVICE, signedMethod: "POST" },
    { signedPath: DEVICE },
    { signedBody: '{"changed":true}' },
    { tamperedNonce: true },
    { noNonce: true }, { noSignature: true }, { noTimestamp: true },
    { now: NOW - 700000 },
    { now: NOW + 700000 }
  ];
  for (const item of inputs) {
    const req = await signed(item);
    const r = await verifyPassengerPushProxyRequest(
      req, env, new URL(req.url).pathname, NOW
    );
    assert.equal(r.ok, false);
    assert.equal(r.status, 403);
  }
  assert.equal(seen.size, 0);
});

await test("signed DELETE allowed only for device route", async () => {
  const { DB } = localDB(), env = { DB, PROXY_HMAC_SECRET: KEY };
  const del = await signed({ path: DEVICE, method: "DELETE" });
  assert.equal((await verifyPassengerPushProxyRequest(del, env, DEVICE, NOW)).ok, true);
  const invalid = await signed({ path: GRANT, method: "DELETE" });
  assert.equal((await verifyPassengerPushProxyRequest(invalid, env, GRANT, NOW)).status, 403);
});

await test("missing D1/secret causes 503, not false success", async () => {
  assert.equal((await verifyPassengerPushProxyRequest(
    await signed(), { PROXY_HMAC_SECRET: KEY }, GRANT, NOW)).status, 503);
  assert.equal((await verifyPassengerPushProxyRequest(
    await signed(), { DB: localDB().DB }, GRANT, NOW)).status, 503);
});

await test("old nonce cleanup does not permit replay of expired timestamp", async () => {
  const { DB, seen } = localDB(), env = { DB, PROXY_HMAC_SECRET: KEY };
  const first = await signed({ now: NOW, nonce: "a".repeat(32) });
  assert.equal((await verifyPassengerPushProxyRequest(first, env, GRANT, NOW)).ok, true);
  assert.deepEqual(await prunePassengerPushProxyNonces(env, NOW + 1200001),
    { purged: 1 });
  assert.equal(seen.size, 0);
  const replay = await signed({ now: NOW, nonce: "a".repeat(32) });
  assert.equal((await verifyPassengerPushProxyRequest(
    replay, env, GRANT, NOW + 1200001)).status, 403);
});

if (!process.exitCode) console.log("PASSENGER_PUSH_PROXY_V2_UNIT_TESTS=PASS");
