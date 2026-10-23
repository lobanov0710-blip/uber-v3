import assert from "node:assert/strict";
import { tgSend } from "../src/core/telegram.js";
import { notifyActiveDriversOfNewOrder } from "../src/core/staffPushNotificationService.js";
import { isStagingEnvironment } from "../src/core/deploymentEnvironment.js";

const ORDER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

assert.equal(isStagingEnvironment({ APP_ENV: "staging" }), true);
assert.equal(isStagingEnvironment({ APP_ENV: " STAGING " }), true);
assert.equal(isStagingEnvironment({ APP_ENV: "production" }), false);
assert.equal(isStagingEnvironment({}), false);
assert.equal(isStagingEnvironment(undefined), false);

// An accidental staging secret must never result in an outbound request.
const originalFetch = globalThis.fetch;
let fetchCount = 0;
globalThis.fetch = async () => {
  fetchCount++;
  throw new Error("Staging must not make outbound notification requests");
};

try {
  const tg = await tgSend(
    {
      APP_ENV: "staging",
      TG_BOT_TOKEN: "accidental-production-token",
      TG_CHAT_ID: "123456789"
    },
    "Synthetic order notification"
  );
  assert.equal(tg.ok, true);
  assert.equal(tg.skipped, true);
  assert.equal(fetchCount, 0);

  // No D1 reads or FCM credentials are required when staging notifications
  // are disabled. A non-empty staging driver table is safe too.
  const env = {
    APP_ENV: "staging",
    DB: {
      prepare() {
        throw new Error("Staging push must not query driver targets");
      }
    },
    FIREBASE_PROJECT_ID: "production-project"
  };
  const push = await notifyActiveDriversOfNewOrder(env, ORDER_ID);
  assert.deepEqual(push, {
    ok: true,
    attempted: 0,
    delivered: 0,
    removed: 0,
    skipped: true
  });
  assert.equal(fetchCount, 0);
} finally {
  globalThis.fetch = originalFetch;
}

// Do not silently alter production authorization or error behavior.
await assert.rejects(
  () => tgSend({ APP_ENV: "production" }, "Notification"),
  /TG_BOT_TOKEN is missing/
);
await assert.rejects(
  () => notifyActiveDriversOfNewOrder({ APP_ENV: "production" }, "invalid-order-id"),
  /Invalid order id/
);

console.log("✓ staging Telegram and FCM notifications disabled");
console.log("✓ production notification behavior unchanged");
