import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { signJWT } from "../src/core/auth.js";
import { PASSENGER_PUSH_SCOPE, verifyPassengerPushGrant }
  from "../src/core/passengerPushGrant.js";
import { registerPassengerDevice, unregisterPassengerDevice }
  from "../src/core/passengerPushDeviceService.js";
import { upsertPassengerPushDevice, revokePassengerPushDevice }
  from "../src/core/passengerPushDeviceRepository.js";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const SECRET = "passenger-push-only-secret-64-characters-isolated-from-all-other-keys";
const ORDER_A = "68516805-d870-4bc9-ac4a-43995df5bc05";
const ORDER_B = "16d9080a-72f1-439b-8d82-1eff62f28df0";
const INSTALL_A = "5d98e332-05e9-4e90-a4e1-bc61c1342030";
const INSTALL_B = "de96d36a-f64a-4d22-a31d-7cf80564f78a";
const now = Date.now();
const env = { PASSENGER_PUSH_GRANT_SECRET: SECRET };

function createDb(changes = 1) {
  const calls = [];
  const DB = {
    prepare(sql) {
      const call = { sql, args: null };
      calls.push(call);
      const stmt = {
        bind(...args) { call.args = args; return stmt; },
        async run() { return { success: true, meta: { changes } }; }
      };
      return stmt;
    }
    ,
    async batch(statements) {
      assert.equal(statements.length, 2);
      return [
        { success: true, meta: { changes: 1 } },
        { success: true, meta: { changes } }
      ];
    }
  };
  return { DB, calls };
}

async function grant(extra = {}, secret = SECRET) {
  return signJWT(secret, {
    sub: ORDER_A,
    scope: PASSENGER_PUSH_SCOPE,
    installationId: INSTALL_A,
    jti: crypto.randomUUID(),
    ...extra
  }, 120);
}

async function test(name, fn) {
  try { await fn(); console.log("✓", name); }
  catch (e) { process.exitCode = 1; console.error("✘", name, e); }
}

await test("valid dedicated signed grant binds exact order and installation", async () => {
  const g = await grant();
  const authorized = await verifyPassengerPushGrant(env, g);
  assert.equal(authorized.orderId, ORDER_A);
  assert.equal(authorized.installationId, INSTALL_A);
  assert.equal(typeof authorized.expiresAt, "number");
});

await test("read-only scope cannot be used for passenger push writes", async () => {
  const { DB, calls } = createDb();
  const g = await grant({ scope: "passenger_order:read" });
  const result = await registerPassengerDevice(
    { ...env, DB }, g, { platform: "android", token: "fcm.test_1" }
  );
  assert.equal(result.status, 403);
  assert.equal(calls.length, 0);
});

await test("staff/other HMAC, missing or shared secret fails closed", async () => {
  const { DB, calls } = createDb();
  const g = await grant();
  for (const config of [
    { DB }, { ...env, DB, PASSENGER_ORDER_SECRET: SECRET },
    { ...env, DB, JWT_SECRET: SECRET }, { ...env, DB, PROXY_HMAC_SECRET: SECRET }
  ]) {
    const result = await registerPassengerDevice(
      config, g, { platform: "android", token: "fcm.test_1" }
    );
    assert.equal(result.status, 403);
  }
  const forged = await grant({}, "completely-different-signed-key-64-char-for-another-application");
  assert.equal((await registerPassengerDevice(
    { ...env, DB }, forged, { platform: "android", token: "fcm.test_1" }
  )).status, 403);
  assert.equal(calls.length, 0);
});

await test("client-supplied orderId and installationId are forbidden", async () => {
  const { DB, calls } = createDb();
  const g = await grant();
  for(const extra of [
    { orderId: ORDER_B },
    { installationId: INSTALL_B },
    { accessToken: "secret" },
    { fcmToken: "another-secret" }
  ]) {
    const result = await registerPassengerDevice(
      { ...env, DB }, g,
      { platform: "android", token: "fcm.test_1", ...extra }
    );
    assert.equal(result.status, 400);
  }
  assert.equal(calls.length, 0);
});

await test("token whitespace, oversize and wrong platform fail without writing", async () => {
  const { DB, calls } = createDb();
  const g = await grant();
  for (const input of [
    { platform: "ios", token: "fcm.test_1" },
    { platform: "android", token: "with space" },
    { platform: "android", token: "x".repeat(4097) },
    { platform: "android", token: "" },
    { platform: "android" },
  ]) {
    assert.equal((await registerPassengerDevice({ ...env, DB }, g, input)).status, 400);
  }
  assert.equal(calls.length, 0);
});

await test("registration SQL is scoped to D1 order and protects against hijacking", async () => {
  const { DB, calls } = createDb();
  const result = await registerPassengerDevice(
    { ...env, DB }, await grant(),
    { platform: "android", token: "fcm.test_2" }
  );
  assert.deepEqual(result, { ok: true });
  assert.equal(calls.length, 2);
  assert.match(calls[0].sql, /INSERT INTO passenger_push_grant_uses/i);
  assert.match(calls[1].sql, /INSERT INTO passenger_push_devices/i);
  assert.match(calls[1].sql, /FROM orders AS o/i);
  assert.match(calls[1].sql, /o\.status IN \('new', 'taken', 'in_progress'\)/i);
  assert.match(calls[1].sql, /passenger_push_devices\.order_id = excluded\.order_id/i);
  assert.match(calls[1].sql, /revoked_at IS NULL/i);
  assert.equal(calls[1].args[0], INSTALL_A);
  assert.equal(calls[1].args[1], ORDER_A);
  assert.equal(calls[1].args[2], "fcm.test_2");
  assert.ok(calls[1].args[4] > calls[1].args[3]);
});

await test("terminal, missing or hijacked order produces a generic conflict", async () => {
  const { DB, calls } = createDb(0);
  assert.deepEqual(await registerPassengerDevice(
    { ...env, DB }, await grant(),
    { platform: "android", token: "fcm.test_2" }
  ), { ok: false, status: 409, error: "registration not available" });
  assert.equal(calls.length, 2);
});

await test("revoke SQL retains tombstone and scopes by order + installation", async () => {
  const { DB, calls } = createDb();
  const result = await unregisterPassengerDevice({ ...env, DB }, await grant());
  assert.deepEqual(result, { ok: true });
  assert.match(calls[1].sql, /UPDATE passenger_push_devices/i);
  assert.match(calls[1].sql, /SET revoked_at = COALESCE\(revoked_at, \?3\)/i);
  assert.match(calls[1].sql, /fcm_token = \?4/i);
  assert.match(calls[1].sql, /installation_id = \?1 AND order_id = \?2/i);
  assert.match(calls[1].sql, /revoked_at IS NULL OR fcm_token <> \?4/i);
  assert.equal(calls[1].args[0], INSTALL_A);
  assert.equal(calls[1].args[1], ORDER_A);
  assert.equal(calls[1].args[3], "__REDACTED__");
  assert.equal(calls[0].args[0] !== calls[1].args[0], true);
});

await test("standalone repository revoke redacts token and preserves ownership", async () => {
  const { DB, calls } = createDb(1);
  assert.deepEqual(await revokePassengerPushDevice(
    { DB }, ORDER_A, INSTALL_A, now
  ), { ok: true });
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /fcm_token = \\?4/i);
  assert.match(calls[0].sql, /COALESCE\\(revoked_at, \\?3\\)/i);
  assert.match(calls[0].sql, /installation_id = \\?1 AND order_id = \\?2/i);
  assert.deepEqual(calls[0].args, [INSTALL_A, ORDER_A, now, "__REDACTED__"]);
});

await test("revoke is idempotent if no matching row", async () => {
  const { DB } = createDb(0);
  assert.deepEqual(await unregisterPassengerDevice(
    { ...env, DB }, await grant()
  ), { ok: true });
});

await test("repository rejects D1 errors and malformed identities", async () => {
  const { DB } = createDb(2);
  await assert.rejects(
    () => upsertPassengerPushDevice({ DB }, {
      orderId: ORDER_A, installationId: INSTALL_A,
      fcmToken: "fcm.test_2", updatedAt: now, expiresAt: now + 5000
    }), /Invalid passenger push write result/
  );
  await assert.rejects(() => revokePassengerPushDevice(
    { DB }, ORDER_B, "invalid", now
  ), /Invalid passenger push revoke/);
});

await test("time-bounded grants and wrong scope reject before database read", async () => {
  const farFutureGrant = await grant();
  const { DB, calls } = createDb();
  const result = await registerPassengerDevice(
    { ...env, DB }, farFutureGrant,
    { platform: "android", token: "fcm.test_2" },
    Date.now() + 600000
  );
  assert.equal(result.status, 403);
  assert.equal(calls.length, 0);
});

if (!process.exitCode) console.log("✓ ALL PASSENGER PUSH DEVICE TESTS PASSED");
