import assert from "node:assert/strict";
import { redactPassengerPushTokensBatch }
  from "../src/core/passengerPushMaintenanceBatch.js";

const NOW = 1793700000000;
const flags = {
  APP_ENV: "production",
  PASSENGER_PUSH_MAINTENANCE_ENABLED: "true"
};

function dbFixture(count = 3, changes = 2, failOn = "") {
  const calls = [];
  const DB = {
    prepare(sql) {
      const record = { sql, args: [] };
      calls.push(record);
      return {
        bind(...args) {
          record.args = args;
          return this;
        },
        async first() {
          if (failOn === "preview") throw new Error("Offline D1");
          return { count };
        },
        async run() {
          if (failOn === "update") throw new Error("Offline D1");
          return { success: true, meta: { changes } };
        }
      };
    }
  };
  return { DB, calls };
}
async function test(name, fn) {
  try { await fn(); console.log("✓", name); }
  catch (error) { process.exitCode = 1; console.error("✘", name, error); }
}

await test("default dry run previews but never mutates or logs token", async () => {
  const { DB, calls } = dbFixture();
  assert.deepEqual(await redactPassengerPushTokensBatch({ DB }, { now: NOW }), {
    dryRun: true, eligibleUpToLimit: 3, redacted: 0, limit: 50
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /SELECT COUNT\(\*\) AS count/);
  assert.deepEqual(calls[0].args, ["__REDACTED__", NOW, 50]);
});

await test("only exact approved flags allow a write; no DB attempt otherwise", async () => {
  for (const env of [
    {}, { APP_ENV: "production" },
    { APP_ENV: "staging", PASSENGER_PUSH_MAINTENANCE_ENABLED: "true" },
    { APP_ENV: "Production", PASSENGER_PUSH_MAINTENANCE_ENABLED: "true" },
    { APP_ENV: "production", PASSENGER_PUSH_MAINTENANCE_ENABLED: "TRUE" }
  ]) {
    const { DB, calls } = dbFixture();
    await assert.rejects(() => redactPassengerPushTokensBatch(
      { ...env, DB }, { now: NOW, execute: true }
    ), /execution disabled/);
    assert.equal(calls.length, 0);
  }
});

await test("explicit run re-evaluates D1 with a bounded SQL UPDATE", async () => {
  const { DB, calls } = dbFixture(50, 37);
  const result = await redactPassengerPushTokensBatch(
    { ...flags, DB }, { now: NOW, limit: 50, execute: true }
  );
  assert.deepEqual(result, {
    dryRun: false, eligibleUpToLimit: 50, redacted: 37, limit: 50
  });
  assert.equal(calls.length, 2);
  assert.match(calls[1].sql, /UPDATE passenger_push_devices/);
  assert.match(calls[1].sql, /SET fcm_token = \?1/);
  assert.match(calls[1].sql, /revoked_at = COALESCE\(revoked_at, \?2\)/);
  assert.match(calls[1].sql, /ORDER BY d.expires_at, d.installation_id/);
  assert.match(calls[1].sql, /LIMIT \?3/);
  assert.deepEqual(calls[1].args, ["__REDACTED__", NOW, 50]);
});

await test("zero eligible rows bypass write after exact preview", async () => {
  const { DB, calls } = dbFixture(0, 0);
  assert.equal((await redactPassengerPushTokensBatch(
    { ...flags, DB }, { now: NOW, execute: true }
  )).redacted, 0);
  assert.equal(calls.length, 1);
});

await test("invalid limits, timestamps or execution state fail before D1", async () => {
  const { DB, calls } = dbFixture();
  for (const options of [
    { now: 0 }, { now: 1.5 }, { limit: 0, now: NOW },
    { limit: 101, now: NOW }, { limit: 1.1, now: NOW },
    { execute: "true", now: NOW }
  ]) {
    await assert.rejects(() => redactPassengerPushTokensBatch(
      { ...flags, DB }, options
    ), /Invalid passenger push cleanup arguments/);
  }
  assert.equal(calls.length, 0);
});

await test("fail closed for missing DB, rejected queries and bad counts", async () => {
  await assert.rejects(() =>
    redactPassengerPushTokensBatch(flags, { now: NOW }),
    /D1 unavailable/);
  for (const [count, changes, failure] of [
    [101, 0, ""], [-1, 0, ""], [null, 0, ""],
    [1, 2, ""], [1, 1, "preview"], [1, 1, "update"]
  ]) {
    const { DB } = dbFixture(count, changes, failure);
    await assert.rejects(() => redactPassengerPushTokensBatch(
      { ...flags, DB }, { now: NOW, execute: true, limit: 1 }
    ), /cleanup (preview|write) (invalid|unavailable)/);
  }
});

if (!process.exitCode) console.log("PASSENGER_PUSH_BOUNDED_MAINTENANCE=PASS");
