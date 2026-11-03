# PUSH-01B — выдача узкого пассажирского push-grant

**Дата:** 03.11.2026  
**Статус:** изолированная feature-ветка поверх PUSH-01A; **не развёрнуто, флаг отключён**.  
**Основание:** [Пассажирское ТЗ v0.2](https://github.com/lobanov0710-blip/TransferServis/blob/master/docs/PASSENGER_APP_TECHNICAL_SPEC_V0_2.md), PUSH-01…06.  
**Договор API:** новый аддитивный контур, `API_CONTRACT_V1.md` остаётся FROZEN.  
**Порядок:** backend PUSH-01A PR №13 → PUSH-01B backend (этот PR) → отдельный PHP gateway PR.

## Функциональный минимум

1. `issuePassengerPushGrant(env, input)` принимает только `{accessToken, installationId}`; произвольный `orderId` и FCM token в request запрещены.
2. `verifyPassengerOrderAccess()` проверяет подпись, scope `passenger_order:read` и срок действия исходного capability. Источник `orderId` — исключительно подписанный `sub`, после чего `getOrderById()` сверяет актуальный заказ D1.
3. Только статусы `new/taken/in_progress` допускают выдачу. Для `done/canceled`, чужого ID, неверного scope или подписи — общий `403`.
4. `signJWT()` создаёт новый grant `scope=passenger_push:manage`, `sub=orderId`, `installationId`, TTL **120 секунд**. Ключ `PASSENGER_PUSH_GRANT_SECRET` должен быть отдельным от staff JWT, proxy HMAC и `PASSENGER_ORDER_SECRET`. Для grant не используется старый accessToken в качестве write-креденшела.
5. Новый `POST /passenger/push-grant` в `router.js` доступен **только** если `PASSENGER_PUSH_API_ENABLED === "true"`, и даже тогда требует валидной HMAC по точному пути/сырому body. По умолчанию HTTP 503 до авторизации и обращения к базе.
6. Успешный ответ: `{ok:true,grantToken,expiresAt}`, `Cache-Control: no-store`. Других данных о заказе не выдавать.
7. `registerPassengerDevice`/revoke из PUSH-01A **не подключены к router**. Нельзя использовать issuer route как API регистрации токенов или полноценную FCM-доставку.

## Безопасность и блокирующие решения

- Bearer `passenger_order:read` является доказательством владения только в пределах модели текущего заказа. Если он утечёт, выдача grant тоже потенциально доступна злоумышленнику: до включения нужно усиление защиты (rate limit, серверная защита от replay/abuse и план отзыва). Флаг должен остаться выключенным, пока эти задачи не закрыты.
- Время жизни read capability может достигать недель. Issuer **не** создаёт дополнительной бессрочной авторизации; каждый grant отдельный и живёт максимум 120 сек.
- Это **не** один раз использованный токен: `jti`/replay-cache и nonce нужно согласовать до production. Отдельный D1 порядок выдачи/отзыва токена остаётся будущим этапом.
- PHP gateway (отдельный репозиторий) требует аналогичного явного локального enable-флага, TLS и проверки формата; ни один private secret или enable-флаг в Git не коммитить.
- Worker/Cloudflare D1 не мигрировались, переменные и secrets production не изменены.
- Staff JWT / `/staff/push-device` / FCM водителей / quotes и заказы не изменены.
- PASSENGER_PUSH_API_ENABLED **не** добавляется в текущий `wrangler.toml` и не должен включаться без разрешения владельца.

## Quality gates

- `npm test` на цепочке PUSH-01A+01B с проверкой подписи, актуального D1 status, чужого scope, чужого orderId, HMAC, выключенного флага, токена и отсутствия write-операций.
- Исходный SQL тест миграций 0001–0005 в изолированной SQLite сохраняется.
- Принятие этой подготовительной кодовой части **не** является разрешением на реальную регистрацию или доставку push.

**Остаётся PUSH-01C/02:** rate limiting/replay, PHP integration contract tests, реальная обработка регистрации, Firebase Android config, FCM listener, добровольное разрешение, delivery/outbox/dedupe и production rollout только после отдельного подтверждения владельца.
