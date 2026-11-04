# PUSH-01K — проверка получателя пассажирского FCM перед отправкой

Дата: 04.11.2026. Статус: Draft поверх backend PUSH-01J PR №22. Production Worker, PHP и D1 без изменений.

## Цель

У будущей пассажирской FCM-доставки не должно быть права отправлять сообщение лишь потому, что строка `passenger_push_devices` существует. Для **каждого устройства перед каждой отправкой** требуется новый read из авторитетной D1 и повторная проверка:
- `order_id` и `installation_id` (точные UUID, связанные между собой);
- статус заказа строго `new`, `taken` или `in_progress`;
- `revoked_at IS NULL`, `expires_at > now`, `updated_at <= now`, `platform='android'`;
- токен не удалён, не `__REDACTED__`, не пустой, размер не превышает 4096, без пробельных символов.

Доступен только внутренний `findEligiblePassengerPushTarget(env, orderId, installationId, now)` в `src/core/passengerPushDeliveryEligibility.js`. **Нет HTTP маршрута, cron, события отправки, вызова Firebase SDK или доступа через клиент.** В результате возвращается FCM токен только подтверждённого устройства; наружу его не выдавать и не логировать.

## Дополнительные fail-closed условия

По умолчанию возвращается `null` **до обращения к БД**. Допуск возможен лишь при одновременной явной установке:
- `PASSENGER_PUSH_API_ENABLED='true'`
- `PASSENGER_PUSH_DEVICES_ENABLED='true'`
- **новом отдельном** `PASSENGER_PUSH_DELIVERY_ENABLED='true'`
- `APP_ENV='production'` (точное совпадение).

Отсутствующая или неработающая D1, неверный формат ответов, ошибки запроса должны запрещать отправку: функция выбрасывает ошибку, а будущий sender должен пропустить доставку. Нельзя автоматически переходить к использованию старого списка целей. В STAGING возвращается null, независимо от других флагов.

## Обязательные ограничения до FCM rollout

1. Получение токена и отправка в Firebase — две отдельные операции. Заказ может завершиться **между** SQL read и отправкой; без атомарного согласованного outbox / сериализации состояния не гарантируется отсутствие race-to-delivery. Значение `findEligiblePassengerPushTarget` не следует считать долгоживущей авторизацией.
2. Не реализован actual passenger sender, не согласованы payload / retry / per-install ordering, атомарные гарантии и fallback при недоступной D1. **PUSH-01K не означает готовность production FCM.**
3. `maintainPassengerPushData` по-прежнему не вызывается по расписанию; автоматическое удаление expired/terminal токенов требует отдельной проверки и разрешения владельца.
4. Истёкший passenger read-token не может выдать revoke-only grant; обход авторизации запрещён. Истёкшая сама **регистрация** уже исключает доставку данным фильтром.
5. Перед подключением sender нужен отдельный аудит, full CI и явное согласие на изменение production Worker.

## Тесты

- `npm test` запускает `tests/passengerPushDeliveryEligibility.test.mjs`: флаги отключены, невалидные identity/time, D1 outage, поддельная строка, неверные scope/order/status, sentinel и отсутствие кеширования.
- `tests/passengerPushEligibility.sqlite.py` извлекает и выполняет **реальный SQL из JS** после всех локальных migrations 0001–0008 в памяти, проверяет новое/взятое/в процессе, завершённое/отменённое, revoked/expired/redacted, чужой installation и изменение статуса между запросами.
- GitHub Action backend исполняет SQLite тест без remote DB, FCM, доступа к секретам или production.

Не выполнять merge, production deploy, remote migrations, Firebase send и установку флагов без отдельного разрешения.
