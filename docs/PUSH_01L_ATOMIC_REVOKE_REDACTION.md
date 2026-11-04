# PUSH-01L — удаление FCM-токена при отзыве в одной транзакции

Дата: 04.11.2026. Статус: Draft поверх PUSH-01K PR №23.

## Уязвимость / риск

Ранее `DELETE /passenger/push-device` помечал строку `passenger_push_devices.revoked_at`, **но не удалял `fcm_token` сразу**. При отсутствии расписания для `maintainPassengerPushData` секрет мог оставаться в D1 неопределённое время. SQL-селекция будущей доставки (PUSH-01K) уже исключает revoked-строку, но наличие старого plaintext в таблице увеличивает последствия компрометации базы.

Эксплуатация / утечка FCM-токенов не подтверждена. Это превентивное исправление хранения, не разрешение на доставку.

## Изменение

- `revokePassengerPushOnce`: в **одной D1 batch-транзакции** с одноразовым `grant_id` выполняется `UPDATE` с `revoked_at=COALESCE(revoked_at, now)`, `fcm_token='__REDACTED__'`, `updated_at=MAX(updated_at, now)`; привязка строго к паре `order_id` / `installation_id`.
- Если строка была отозвана ранее, но содержит legacy plaintext, следующий авторизованный revoke её очищает **без изменения исходного времени отзыва**. Повтор по тому же grant-jti не проходит, повтор с новым grant-jti после очистки идемпотентен.
- `revokePassengerPushDevice` (отдельный внутренний repository helper) обновлён аналогично для согласованности, хотя текущий публичный путь использует только транзакционную реализацию.
- Сохраняется tombstone против повторной регистрации `installation_id`; `staff_push_devices`, `orders`, Telegram и real FCM не затрагиваются.
- Новых HTTP-роутов, D1 миграций, background cron, Firebase sender и production deployment нет.

## Проверки

- Node tests: SQL shape, четыре параметра включая sentinel, idempotency, одинаковый order/installation, Mock D1/HTTP router.
- **Настоящая in-memory SQLite:** `tests/passengerPushSecurity.sqlite.py` извлекает исходный SQL из `passengerPushDeviceTransactions.js` и проверяет автоматическое стирание plaintext сразу после revoke, anti-replay, обновление старой tombstone и сохранение revoke timestamp.
- PHP HMAC → Worker Router → SQLite: `tests/passengerPushPhpWorkerD1.integration.mjs`, настоящий локальный PHP/cURL HTTP → Worker SQLite `tests/passengerPushHttpLoopback.e2e.mjs` проверяют ответ 200 и **немедленную** замену токена.
- Полный `npm test` и все существующие SQL миграционные / lifecycle / nonce тесты.

## Нерешённые ограничения

1. При достижении `expires_at` либо при терминальном статусе **без явного отзыва** FCM-токен пока удаляется только при вызове maintenance; автоматического расписания нет. Отдельно нужны ограниченный по объёму безопасный maintenance-runner и утверждённая retention policy.
2. Ранее сохранённые и уже отозванные строки не очищаются автоматически этим изменением, пока кто-либо не вызовет авторизованный revoke или maintenance. Новый код действует на последующие обращения.
3. Фактическая сеть / Firebase send и клиентская синхронизация отсутствуют. SQL eligibility прямо перед будущим send сокращает, но не устраняет race между D1 SELECT и внешним Firebase-вызовом. **Нельзя заявлять гарантированный запрет отправки после одновременной отмены/отзыва.**
4. Не запускать миграции, не включать push flags, не объединять или развёртывать без разрешения владельца. STAGING только для необходимых тестов; основная продуктовая среда — production.
