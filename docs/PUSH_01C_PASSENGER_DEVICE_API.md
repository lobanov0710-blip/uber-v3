# PUSH-01C — пассажирская регистрация/отзыв устройств и anti-replay

**Дата:** 03.11.2026. **Статус:** отдельный Draft PR, только код и изолированные тесты. Production не изменён.

## Реализовано

- Новая аддитивная D1 миграция `0006_passenger_push_security.sql`: таблица одноразовых `jti` и лимитер на заказ. Не менять staff-таблицы и замороженный API v1.
- Выдача `passenger_push:manage` grant в PUSH-01B расширена уникальным UUID `jti`. Максимум **5 grant на подтверждённый заказ за 60 секунд**, проверка атомарной D1-командой, превышение → 429. Без D1/отдельного секрета/флага — отказ.
- `POST /passenger/push-device` принимает только `{grantToken, platform:"android", token}`; `DELETE` только `{grantToken}`. Для обеих операций Worker проверяет точный HMAC path/body, срок grant, scope, orderId и installationId из подписи.
- **Два независимых Worker-флага** `PASSENGER_PUSH_API_ENABLED="true"` и `PASSENGER_PUSH_DEVICES_ENABLED="true"`. Отсутствие любого → 503; флаги не добавляются в `wrangler.toml`.
- D1 `batch()` содержит `INSERT` уникального grant `jti` и `INSERT ... SELECT FROM orders` / `UPDATE` устройства в одной транзакции. Повторный `jti` откатывает транзакцию и не должен менять регистрацию. Подтверждение атомарности: [Cloudflare D1 docs](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).
- Статусы `done/canceled` запрещают регистрацию, истёкшая/чужая capability не может получать grant. `revoked_at` сохраняет tombstone, чтобы даже свежий grant не восстановил отозванную установку без отдельной процедуры.
- Результат POST/DELETE без токенов/адресов/персональных данных. FCM не отправляется: **нет** producer/dispatcher, нет реальной регистрации Android-клиента.
- JUnit не применяется: backend-тесты на Node.js, реальная SQLite in-memory для 0001…0006, rollbacks/replay/rotation/rate-limit, PHP отдельным PR.

## Последовательность/зависимости

1. [PUSH-01A PR №13](https://github.com/lobanov0710-blip/uber-v3/pull/13) — таблица `0005`, устройства и авторизационный verifier.
2. [PUSH-01B PR №14](https://github.com/lobanov0710-blip/uber-v3/pull/14) — исходное право выдачи grant, HMAC и флаг.
3. PUSH-01C (этот этап) — дополнительные ограничения, `0006`, один раз используемый grant и router POST/DELETE.
4. Отдельный PHP [PUSH-01C PR](https://github.com/lobanov0710-blip/public_html/pulls) — POST/DELETE под **дополнительным приватным флагом**; независимый от Worker deploy.
5. Только после принятия правил, интеграционных security-тестов и отдельного разрешения: миграции → секреты/флаги → реальная регистрация Android FCM → delivery (отдельный проект).

## Остаточные блокеры до какого-либо production-включения

- Лимит 5/60 **на подтверждённый orderId**, не ограничивает неавторизованные запросы и массовые попытки по IP. Нужен отдельный WAF/gateway rate limit до запроса к Worker/D1.
- HMAC timestamp действует 300 с и **не имеет отдельного request nonce**. Одноразовый `jti` защищает mutation; повтор выдачи grant ограничивается счётчиком, но не полностью идемпотентен. Нужны gateway nonce/abuse policy, аудит логов без PII.
- Конфликт `installationId` между заказами запрещён; после `revoked_at` одна установка не может переподписаться на другой заказ без пересоздания install ID. Нужно утвердить UX/политику перехода.
- Срок подписки устройств 7 суток в PUSH-01A пока предварительный; не утверждены число устройств, срок хранения FCM token, автоматический cleanup/удаление, revoke по `done/canceled` (на этапе отправки).
- Отсутствуют outbox, sender, Firebase Android app/config, токен-ротация на устройстве, пользовательский opt-in, E2E через реальный PHP gateway.
- Строго **не разрешается** включать Worker/хостинг флаги, применять 0005/0006 к D1, отправлять FCM, создавать реальные заказы или объединять PR без отдельного согласия.

## Тестирование

`npm test` включая route, malformed request, HMAC, scope, jti replay, revoke, per-order quota. `python3 tests/passengerPushMigration.sqlite.py` и `python3 tests/passengerPushSecurity.sqlite.py` — реальная SQLite и проверка отката, статусных запретов и rate limit. Только результат успешного GitHub Actions подтверждает прохождение; коммит теста сам по себе не является доказательством.
