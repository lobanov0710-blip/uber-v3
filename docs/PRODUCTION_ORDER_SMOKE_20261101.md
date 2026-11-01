# ORDER-SMOKE-01 — one controlled real order, 01.11.2026

**Owner permission:** «проверку можно делать с реальными созданиями заказов». Start with exactly **one** order and **one** new quote, not a batch. This authorizes controlled test creation but **not** deployment, schema migration, deletion, or additional writes.

## Scope and production guardrails

- Target: existing active production Worker `uber-v3` (Dashboard UI showed `aab6dd14`, 100% traffic) through installed Android emulator package `ru.transferservis.app.productiontest` and production PHP API `https://transfer-servis52.ru/`.
- Real production orders may notify the Telegram bot and driver FCM recipients. Use test-only marker in the **comment**: `E2E-PROD-20261101-01 / ТЕСТ, НЕ ВЫПОЛНЯТЬ`. Alert operations staff/driver recipients when appropriate.
- Use **owner-controlled** valid customer name and phone. Do not share personal phone, tokens, webhook URLs, signed passenger access capabilities or other secrets in a PR/chat.
- Pick a future trip date accepted by the app. A real production order is a live business record and may need a normal administrative cancellation after validation.
- The previous quote `7616a64c-d438-4e04-ace4-7eb03dcb6baf` was created at 09:59:03 UTC on 01.11 and has a 30-minute TTL. **Do not reuse** it for order submission.
- This verifies the **currently deployed** Worker. PR #9's canonical-place fix is merged only to GitHub `main` and has not been deployed; do not claim the test covers it.

## Execution on owner's emulator

1. Confirm the installed app is `productiontest`; no rebuild or redeploy is required.
2. Enter NN → Moscow, `comfort`. Press **Calculate** exactly once. Record `quoteId` from diagnostic block and production API address.
3. Continue to **Create order**. Use only owner-controlled contact details; set a future date and the marker from this document in the comment field.
4. Press the submit button **once only**. If HTTP/UI status is ambiguous, do **not** press again; check D1 by the exact `quoteId` first. Android has a pending-submission recovery mechanism.
5. Record the order result or exact error; never paste full accessToken or private contact details.

## Read-only D1 query after submit

Cloudflare Dashboard → D1 → **`transfer-servis52-core`** → Console. Insert the exact new UUID in the quoted literal below; **do not run any INSERT/UPDATE/DELETE**:

~~~sql
SELECT
  q.id AS quote_id,
  datetime(q.created_at / 1000, 'unixepoch') AS quote_created_utc,
  q.tariff,
  q.distance_km,
  q.duration_minutes,
  q.price_rub AS quote_price_rub,
  CASE WHEN q.consumed_at IS NULL THEN 'AVAILABLE_OR_EXPIRED'
       ELSE 'CONSUMED' END AS quote_use_state,
  COUNT(o.id) AS orders_for_quote,
  MAX(o.id) AS order_id,
  MAX(o.status) AS order_status,
  MAX(o.price_rub) AS order_price_rub
FROM quotes AS q
LEFT JOIN orders AS o ON o.quote_id = q.id
WHERE q.id = '<EXACT_NEW_QUOTE_ID>'
GROUP BY q.id;
~~~

**Expected for a successful first submission:** 1 row for the quote, `quote_use_state=CONSUMED`, `orders_for_quote=1`, `order_status=new` (unless workflow advanced), price matches quote, `order_id` nonempty. If `orders_for_quote=0`, no order was found; do not immediately retry without diagnosing. If 2+, halt and investigate potential invariant violation.

Verify the **actual** Telegram test-marker message in the intended live chat; check FCM delivery/driver app only if the driver is available and logs/recipient are safe to inspect. An HTTP 201 order response or D1 row alone **does not prove notification delivery**; Telegram errors are best-effort and caught, and FCM may be asynchronously scheduled.

## Recovery and closeout

- If result is unknown, first query by `quoteId` and inspect pending-submission state, then follow the existing app's idempotent recovery path. Do not manually craft multiple POSTs.
- Record `quoteId`, `orderId`, `order_status`, notification observation, and whether manual cancellation is necessary. Avoid PII.
- Handle any cancellation through existing authenticated staff workflow only, with owner authorization and audit; do not silently delete a production order or remove historic test data.
- No release of PR #9/PR #10 or production Worker deployment is part of this protocol.

## Unit-test coverage

`tests/orders.test.mjs` now covers a real-world failure **using only mock D1 and mocked Telegram**: the first quoted order persists even when Telegram returns HTTP 500; repeating the same quote and customer payload recovers the same order and does not create another D1 transaction or send a second Telegram message. This is a unit/regression test, **not proof of live delivery**.
