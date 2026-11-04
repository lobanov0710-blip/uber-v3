import assert from "node:assert/strict";
import { findEligiblePassengerPushTarget } from "../src/core/passengerPushDeliveryEligibility.js";

const ORDER = "68516805-d870-4bc9-ac4a-43995df5bc05";
const INSTALL = "5d98e332-05e9-4e90-a4e1-bc61c1342030";
const NOW = 1793700000000;
const flags = {
  APP_ENV: "production",
  PASSENGER_PUSH_DELIVERY_ENABLED: "true",
  PASSENGER_PUSH_API_ENABLED: "true",
  PASSENGER_PUSH_DEVICES_ENABLED: "true"
};
const validRow = {
  order_id: ORDER, installation_id: INSTALL, platform: "android",
  fcm_token: "local-placeholder-fcm", updated_at: NOW - 1000,
  expires_at: NOW + 60000, revoked_at: null, order_status: "taken"
};

function fakeDb(row = validRow, failing = false) {
  const calls = [];
  const DB = {
    prepare(sql) {
      const call = { sql, args: [] };
      calls.push(call);
      return {
        bind(...args) { call.args = args; return this; },
        async first() {
          if (failing) throw new Error("D1 unavailable");
          return row;
        }
      };
    }
  };
  return { DB, calls };
}
async function testCase(name, run) {
  try { await run(); console.log("✓", name); }
  catch (error) { process.exitCode = 1; console.error("✘", name, error); }
}

await testCase("delivery is disabled by default and never queries D1", async () => {
  for (const missing of ["APP_ENV", "PASSENGER_PUSH_DELIVERY_ENABLED",
    "PASSENGER_PUSH_API_ENABLED", "PASSENGER_PUSH_DEVICES_ENABLED"]) {
    const { DB, calls } = fakeDb();
    const env = { ...flags, DB };
    delete env[missing];
    assert.equal(await findEligiblePassengerPushTarget(env, ORDER, INSTALL, NOW), null);
    assert.equal(calls.length, 0);
  }
  for (const value of ["staging", "test", "Production", ""]) {
    const { DB, calls } = fakeDb();
    assert.equal(await findEligiblePassengerPushTarget(
      { ...flags, APP_ENV: value, DB }, ORDER, INSTALL, NOW
    ), null);
    assert.equal(calls.length, 0);
  }
});

await testCase("fresh SQL query uses exact owner, installation and status", async () => {
  const { DB, calls } = fakeDb();
  const result = await findEligiblePassengerPushTarget({ ...flags, DB }, ORDER, INSTALL, NOW);
  assert.deepEqual(result, {
    orderId: ORDER, installationId: INSTALL, fcmToken: validRow.fcm_token
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, [ORDER, INSTALL, NOW, "__REDACTED__"]);
  for (const condition of ["INNER JOIN orders AS o", "d.revoked_at IS NULL",
    "d.expires_at > ?3", "d.updated_at <= ?3",
    "o.status IN ('new', 'taken', 'in_progress')", "d.fcm_token <> ?4"]) {
    assert.ok(calls[0].sql.includes(condition), "Missing SQL invariant: " + condition);
  }
});

await testCase("not registered or unavailable D1 cannot authorize sending", async () => {
  assert.equal(await findEligiblePassengerPushTarget(
    { ...flags, DB: fakeDb(null).DB }, ORDER, INSTALL, NOW
  ), null);
  await assert.rejects(() => findEligiblePassengerPushTarget(
    flags, ORDER, INSTALL, NOW
  ), /DB unavailable/);
  await assert.rejects(() => findEligiblePassengerPushTarget(
    { ...flags, DB: fakeDb(validRow, true).DB }, ORDER, INSTALL, NOW
  ), /eligibility query failed/);
});

await testCase("malformed, revoked, expired and terminal responses fail closed", async () => {
  const badRows = [
    {}, { ...validRow, order_id: crypto.randomUUID() },
    { ...validRow, installation_id: crypto.randomUUID() },
    { ...validRow, platform: "ios" }, { ...validRow, order_status: "done" },
    { ...validRow, order_status: "canceled" },
    { ...validRow, order_status: "unknown" },
    { ...validRow, revoked_at: NOW - 100 },
    { ...validRow, expires_at: NOW }, { ...validRow, updated_at: NOW + 1 },
    { ...validRow, fcm_token: "__REDACTED__" },
    { ...validRow, fcm_token: "" },
    { ...validRow, fcm_token: "invalid\ntoken" }
  ];
  for (const row of badRows) {
    await assert.rejects(() => findEligiblePassengerPushTarget(
      { ...flags, DB: fakeDb(row).DB }, ORDER, INSTALL, NOW
    ), /eligibility result invalid/);
  }
});

await testCase("invalid IDs and time fail before SQL", async () => {
  const { DB, calls } = fakeDb();
  for (const [id, installation, time] of [
    ["bad", INSTALL, NOW], [ORDER, "bad", NOW],
    [ORDER, INSTALL, 0], [ORDER, INSTALL, 1.5]
  ]) {
    await assert.rejects(() => findEligiblePassengerPushTarget(
      { ...flags, DB }, id, installation, time
    ), /Invalid passenger delivery target/);
  }
  assert.equal(calls.length, 0);
});

if (!process.exitCode) console.log("PASSENGER_PUSH_DELIVERY_ELIGIBILITY=PASS");
