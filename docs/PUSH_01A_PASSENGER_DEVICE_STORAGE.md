# PUSH-01A — подготовка серверного хранилища пассажирских FCM-регистраций

**Дата:** 03.11.2026  
**Статус:** отдельная feature-ветка, без HTTP API/реальных уведомлений/production deploy.  
**ТЗ:** [Android passenger v0.2](https://github.com/lobanov0710-blip/TransferServis/blob/master/docs/PASSENGER_APP_TECHNICAL_SPEC_V0_2.md), PUSH-01…06.  
**Контракт:** [draft PR №12](https://github.com/lobanov0710-blip/uber-v3/pull/12) — пока не согласован и не объединён; здесь выполнена только автономная нижняя часть PUSH-01.  
**Строго не менять:** действующий [API_CONTRACT_V1.md](API_CONTRACT_V1.md) (FROZEN), staff FCM, заказ, цену, роутинг, PHP, мобильный API.

## Реализованная автономная часть

1. `migrations/0005_passenger_push_devices.sql`: отдельная аддитивная таблица и индексы (не изменяет `staff_push_devices`, `orders` или `quotes`).
2. `src/core/passengerPushGrant.js`: проверка короткоживущего **отдельно подписанного** JWT `scope=passenger_push:manage`, `sub=orderId`, `installationId`, корректного UUID и TTL не более 300 с. Требует `env.PASSENGER_PUSH_GRANT_SECRET`, отличный от staff JWT, `PASSENGER_ORDER_SECRET`, proxy HMAC; без секрета — полный запрет операций. **Выдача такого grant ещё не реализована.**
3. `src/core/passengerPushDeviceService.js`: регистрация/revoke только после верификации узкого grant. У регистрации body **только** `platform=android` и `token`; `orderId` и `installationId` не читаются из body. Период 7 суток для регистрации — временный технический лимит, не согласованное SLA/retention. Ошибки не раскрывают FCM токен.
4. `src/core/passengerPushDeviceRepository.js`: одна атомарная SQL-команда `INSERT…SELECT…ON CONFLICT` с проверкой статуса authoritative `orders`, только `new/taken/in_progress`; `done/canceled` не принимаются. Конфликт `installation_id` не даёт перенести чужую установку на другой заказ; разрешено обновление токена только той же активной установки. Отзыв ставит `revoked_at`-tombstone, запрещающий replay того же grant. Нет публичной функции получения FCM списка.
5. `tests/passengerPushDevice.test.mjs`: негативные границы для чужой подписи, `passenger_order:read` вместо разрешённого scope, секретов, подмены `orderId/installationId`, длинных/некорректных токенов, SQL-связки заказа, пустого результата при terminal state, отзыва и fail-closed.
6. `tests/passengerPushMigration.sqlite.py`: применение **всех** миграций 0001…0005 в изолированной SQLite in-memory, выполнение фактических INSERT/CONFLICT/UPDATE, запрет чужих и завершённых заказов, проверка целостности; отдельный шаг в Backend CI.

## Гарантии в границах PR

- **Не существует HTTP endpoint**, способного вызвать эти новые функции: `router.js` и `src/index.js` не затронуты. Не выдан ни один grant. Пока секрет отсутствует, верификация fail-closed. Миграция не применена ни к STAGING, ни к production.
- В хранилище нет staff JWT/session, данные заказа из запроса не являются авторитетными, `FROZEN API v1` не изменён.
- При `revoke` строка остаётся как метка (до отдельного cleanup), чтобы повторное использование уже выданного короткоживущего grant не восстановило подписку.
- SQL-выборка FCM для доставки/дедупликация событий не создаются. **FCM push не отправляется**.
- `PUSH-01` полностью **не реализован**: пока нет выдачи grant после проверки действующей пассажирской сессии, привязки владения, PHP HMAC gateway и реальной реализации безопасной отправки.
- Нет авто-выбора администратором тарифа, нет создания заказов, нет изменений поведения driver FCM.

## Открытые проектные решения — обязательны до API и деплоя

- Обязателен отдельный API для получения `passenger_push:manage` grant, доказав перед этим `passenger_order:read` владение только одним заказом. Запрещено подписывать push-grant обычным staff/access/HMAC secret.
- Политика для перехода установки на новый заказ: текущий вариант fail-closed и требует нового installationId при повторной подписке после revoke. Нужно согласовать удобный безопасный обмен/перепривязку, не полагаясь на непроверенный клиентский заказ.
- Нужна защита от replay самого запроса PHP HMAC (текущее окно времени само по себе не nonce), rate limits, отдельная политика жизненного цикла и отзыва при expiry/status.
- Срок регистрации в D1 (предварительно 7 суток), частота renewal, максимальное число устройств на заказ и retention — не согласованы и будут уточнены.
- Не создана привязка выдаваемого grant к актуальному состоянию D1, недоступны `/api/passenger-push-device.php` и маршрут Worker, не зарегистрирована Firebase passenger app.
- Без реального FCM нельзя заявлять об успешной доставке, event dedupe и готовности push.
- Поздняя отмена между проверкой статуса и отправкой потребует проверок непосредственно перед delivery; в этой ветке delivery отсутствует.

## Условия приёмки

1. `npm test`, включая новые passenger push тесты, завершается с кодом 0.
2. `python3 tests/passengerPushMigration.sqlite.py` применяет миграции на **in-memory SQLite**, проверяет коллизии установки и отменённые заказы без обращения к Cloudflare.
3. Сравнение PR с `main`: только `0005`, новые модули/тесты, документация и вызов дополнительных проверок в CI. Нет изменений `router.js`, `wrangler.toml`, `API_CONTRACT_V1.md`.
4. В `main` ничего не вливается без отдельного подтверждения владельца; **никакие** миграции/FCM/секреты/deploy не выполняются.

**Последующие этапы:** PUSH-01B — выдача отдельного grant, endpoint и PHP gateway с отрицательными auth-тестами; PUSH-02 — пассажирский Firebase/opt-in; PUSH-03 — серверная доставка по подтверждённым событиям, идемпотентность и настройка срока подписки.
