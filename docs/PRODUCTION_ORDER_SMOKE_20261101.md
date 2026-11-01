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

## FCM follow-up: count eligible registered driver devices (read-only)

For the confirmed order `68516805-d870-4bc9-ac4a-43995df5bc05`, owner opened the details **manually** in legacy package `ru.transferservis.transferdriver` (AppOps `POST_NOTIFICATION: ignore`). Thus order-list visibility is PASS but FCM receipt/display is **UNVERIFIED**. A distinct current package `ru.transferservis.driver` has `POST_NOTIFICATIONS: granted=true` and on 01.11 `am start -W` returned `Status: ok`, already running `DriverMainActivity`. Do not confuse packages or infer FCM arrival from a successful app launch.

Cloudflare Dashboard → D1 → `transfer-servis52-core` → Console. This strictly **SELECT-only** query mirrors `src/core/staffPushDeliveryRepository.js` authorization requirements and returns **aggregate counts only**; it does not select `fcm_token`, installation IDs, or staff identities. An absent `staff_push_devices` table means migration/deployment state needs investigation; do not automatically migrate production.

~~~sql
SELECT
  COUNT(*) AS registered_android_installations,
  COALESCE(SUM(
    CASE WHEN a.role = 'driver' AND a.status = 'active'
      THEN 1 ELSE 0 END
  ), 0) AS active_driver_registrations,
  COALESCE(SUM(
    CASE
      WHEN a.role = 'driver'
       AND a.status = 'active'
       AND EXISTS (
         SELECT 1
         FROM staff_sessions AS s
         WHERE s.account_id = p.account_id
           AND s.family_id = p.session_family_id
           AND s.revoked_at IS NULL
           AND s.replaced_by_session_id IS NULL
           AND s.expires_at > CAST(strftime('%s', 'now') AS INTEGER) * 1000
       )
      THEN 1 ELSE 0 END
  ), 0) AS eligible_fcm_targets
FROM staff_push_devices AS p
LEFT JOIN staff_accounts AS a ON a.id = p.account_id
WHERE p.platform = 'android';
~~~

**Interpretation:** `eligible_fcm_targets=0` means the delivery query currently has no eligible target; nonzero means only that registrations/sessions are eligible **now**, not that the earlier push succeeded or that a specific Android package owns a matching token. Do not query tokens or print full `dumpsys` output containing private identifiers. Check current driver's UI before any additional live push test.

**Observed owner result (01.11.2026):** `registered_android_installations=2`, `active_driver_registrations=2`, `eligible_fcm_targets=2` — server registration/eligibility **PASS at query time**, actual FCM delivery **UNVERIFIED**. Driver package `ru.transferservis.driver` was confirmed to open via `am start -W` (already-running `DriverMainActivity`), and its notification runtime permission was granted. This does not prove either D1 registration belongs to it.

For the next notification delivery smoke, first safely close/cancel prior test order via an authenticated admin action to avoid live test backlog. Then use **one new**, visibly marked order, leaving the modern `ru.transferservis.driver` app installed, signed in and capable of displaying system notifications. Observe the notification shade **before manually opening or refreshing the order list**. Record whether a system notification for the new order appears; no notification does not by itself pinpoint FCM transport versus client filtering. Any new test needs a fresh unexpired quote. Do not use `ru.transferservis.transferdriver` to judge current client behavior; it has Android AppOps `POST_NOTIFICATION: ignore`.


## Recovery and closeout

- If result is unknown, first query by `quoteId` and inspect pending-submission state, then follow the existing app's idempotent recovery path. Do not manually craft multiple POSTs.
- Record `quoteId`, `orderId`, `order_status`, notification observation, and whether manual cancellation is necessary. Avoid PII.
- Handle any cancellation through existing authenticated staff workflow only, with owner authorization and audit; do not silently delete a production order or remove historic test data.
- No release of PR #9/PR #10 or production Worker deployment is part of this protocol.

## Authenticated admin cancellation (pending owner execution)

**Owner confirmed they have backend admin credentials, 01.11.2026.** The first real order must be closed using the documented admin-only `POST /orders/{orderId}/status`, **not** by direct D1 update or by having a driver accept it. Exact order UUID: `68516805-d870-4bc9-ac4a-43995df5bc05`. Source reviewed: `src/router.js`, `src/core/orderRepository.js`, frozen `docs/API_CONTRACT_V1.md`. Driver `ApiClient.BASE_URL` is `https://uber-v3.lobanov0710.workers.dev/`. Cloudflare live version provenance is still not fully mapped to Git, so success and D1 status must be verified; failures are not grounds to bypass auth.

Run locally in Windows PowerShell; it prompts for credentials, does not display JWT, confirms the exact order ID, and logs out in `finally`. Do not paste credentials or full command output containing API tokens to GitHub. The host is **production**, so the status change is real.

~~~powershell
$base = "https://uber-v3.lobanov0710.workers.dev"
$orderId = "68516805-d870-4bc9-ac4a-43995df5bc05"
$credential = Get-Credential -Message "Production staff ADMIN login"
$auth = $null
try {
    $loginJson = @{
        login = $credential.UserName
        password = $credential.GetNetworkCredential().Password
    } | ConvertTo-Json -Compress
    $auth = Invoke-RestMethod -Method Post -Uri "$base/staff/login" -ContentType "application/json; charset=utf-8" -Body $loginJson -ErrorAction Stop
    if ($auth.ok -ne $true -or $auth.staff.role -ne "admin" -or [string]::IsNullOrWhiteSpace($auth.accessToken)) {
        throw "Authenticated staff is not an active admin"
    }
    $confirmation = Read-Host "Enter CANCEL to cancel order $orderId"
    if ($confirmation -ne "CANCEL") {
        Write-Host "CANCEL_ABORTED"
    } else {
        $response = Invoke-RestMethod -Method Post -Uri "$base/orders/$orderId/status" -Headers @{ Authorization = "Bearer $($auth.accessToken)" } -ContentType "application/json; charset=utf-8" -Body '{"status":"canceled"}' -ErrorAction Stop
        if ($response.ok -eq $true -and $response.order.id -eq $orderId -and $response.order.status -eq "canceled") {
            Write-Host "CANCEL_PASS order_id=$orderId status=canceled"
        } else {
            Write-Host "CANCEL_UNCONFIRMED; check production D1"
        }
    }
} catch {
    Write-Host ("CANCEL_ERROR: " + $_.Exception.GetType().Name)
    Write-Host "Do not retry blindly; verify order status in production D1"
} finally {
    if ($auth -and $auth.refreshToken) {
        try {
            $logoutJson = @{ refreshToken = $auth.refreshToken } | ConvertTo-Json -Compress
            $null = Invoke-RestMethod -Method Post -Uri "$base/staff/logout" -ContentType "application/json; charset=utf-8" -Body $logoutJson -ErrorAction Stop
            Write-Host "STAFF_LOGOUT=PASS"
        } catch {
            Write-Host "STAFF_LOGOUT=UNCONFIRMED"
        }
    }
    Remove-Variable -Name credential,loginJson,logoutJson,auth,response -ErrorAction SilentlyContinue
}
~~~

After execution, independently verify in D1 Console using a SELECT-only query:

~~~sql
SELECT id, quote_id, status, driver_id IS NOT NULL AS assigned_to_driver, updated_at
FROM orders
WHERE id = '68516805-d870-4bc9-ac4a-43995df5bc05';
~~~

Expected `status=canceled`. No order must be silently deleted; prior `quoteId` and price history must remain intact. An absent or different status is a blocker. This closeout is **pending confirmation**, not yet done.

## Unit-test coverage

`tests/orders.test.mjs` now covers a real-world failure **using only mock D1 and mocked Telegram**: the first quoted order persists even when Telegram returns HTTP 500; repeating the same quote and customer payload recovers the same order and does not create another D1 transaction or send a second Telegram message. This is a unit/regression test, **not proof of live delivery**.
