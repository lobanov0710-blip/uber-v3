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

const originalFetch = globalThis.fetch;
let fetchCount = 0;
globalThis.fetch = async () => {
  fetchCount++;
  throw new Error("Unexpected outbound notification request");
};

try {
  // Default OFF; even accidentally copied production credentials/flag alone
  // cannot cause a Telegram or FCM call from staging.
  for (const enabled of [undefined, "false", "yes", "1"]) {
    const tg = await tgSend(
      {
        APP_ENV: "staging",
        STAGING_TELEGRAM_ENABLED: enabled,
        TG_BOT_TOKEN: "accidental-production-token",
        TG_CHAT_ID: "123456789",
        STAGING_TG_BOT_TOKEN: "test-token",
        STAGING_TG_CHAT_ID: "-100987"
      },
      "Synthetic order notification"
    );
    assert.deepEqual(tg, { ok: true, skipped: true });
  }
  assert.equal(fetchCount, 0);

  // Opting in WITHOUT separate staging bot/chat must fail closed. Production
  // credentials are never used as a fallback.
  await assert.rejects(
    () => tgSend({
      APP_ENV: "staging",
      STAGING_TELEGRAM_ENABLED: "true",
      TG_BOT_TOKEN: "production-token",
      TG_CHAT_ID: "production-chat"
    }, "Synthetic order"),
    /STAGING_TG_BOT_TOKEN is missing/
  );
  await assert.rejects(
    () => tgSend({
      APP_ENV: "staging",
      STAGING_TELEGRAM_ENABLED: "true",
      STAGING_TG_BOT_TOKEN: "test-token",
      TG_CHAT_ID: "production-chat"
    }, "Synthetic order"),
    /STAGING_TG_CHAT_ID is missing/
  );
  assert.equal(fetchCount, 0);

  // FCM stays OFF in staging regardless of the Telegram opt-in.
  const env = {
    APP_ENV: "staging",
    STAGING_TELEGRAM_ENABLED: "true",
    DB: {
      prepare() {
        throw new Error("Staging push must not query driver targets");
      }
    },
    FIREBASE_PROJECT_ID: "production-project"
  };
  const push = await notifyActiveDriversOfNewOrder(
    env,
    ORDER_ID,
    1700000000000
  );
  assert.deepEqual(push, {
    ok: true,
    attempted: 0,
    delivered: 0,
    removed: 0,
    skipped: true
  });
  assert.equal(fetchCount, 0);

  // Mock Telegram API: no network or production Telegram message is sent.
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      async json() {
        return { ok: true, result: { message_id: 314, chat: { id: "-100987" } } };
      }
    };
  };

  const stagingResult = await tgSend(
    {
      APP_ENV: "staging",
      STAGING_TELEGRAM_ENABLED: "true",
      STAGING_TG_BOT_TOKEN: "separate-test-token",
      STAGING_TG_CHAT_ID: "-100987",
      TG_BOT_TOKEN: "must-not-be-used",
      TG_CHAT_ID: "must-not-be-used"
    },
    "Synthetic new order"
  );
  assert.equal(stagingResult.ok, true);
  assert.equal(stagingResult.messageId, 314);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.telegram.org/botseparate-test-token/sendMessage");
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.chat_id, "-100987");
  assert.equal(body.text, "[ТЕСТ / STAGING] Synthetic new order");

  // Production behavior/credentials stay independent of staging switches.
  const prodResult = await tgSend(
    {
      APP_ENV: "production",
      STAGING_TELEGRAM_ENABLED: "true",
      TG_BOT_TOKEN: "production-token",
      TG_CHAT_ID: "-100123",
      STAGING_TG_BOT_TOKEN: "must-not-be-used",
      STAGING_TG_CHAT_ID: "must-not-be-used"
    },
    "Production order"
  );
  assert.equal(prodResult.ok, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, "https://api.telegram.org/botproduction-token/sendMessage");
  const prodBody = JSON.parse(calls[1].options.body);
  assert.equal(prodBody.chat_id, "-100123");
  assert.equal(prodBody.text, "Production order");
} finally {
  globalThis.fetch = originalFetch;
}

// Do not silently alter production authorization or error behavior.
await assert.rejects(
  () => tgSend({ APP_ENV: "production" }, "Notification"),
  /TG_BOT_TOKEN is missing/
);
await assert.rejects(
  () => notifyActiveDriversOfNewOrder(
    { APP_ENV: "production" },
    "invalid-order-id",
    1700000000000
  ),
  /Invalid order id/
);

console.log("✓ staging Telegram disabled by default and fail-closed without test credentials");
console.log("✓ opt-in staging Telegram uses dedicated test bot and marked message");
console.log("✓ staging FCM remains disabled, production notification behavior unchanged");
