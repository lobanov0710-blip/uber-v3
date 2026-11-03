# Transfer Servis — пассажирские push: проект серверного контракта v0.1

**Дата:** 03.11.2026  
**Статус:** `DRAFT / НЕ РЕАЛИЗОВАНО`. Согласован продуктовый функционал PUSH-01…06 (вариант Б), **не** утверждены новые API/схема/способ авторизации/технические условия доставки.  
**Репозитории:** `uber-v3` — Cloudflare Worker и D1; `public_html` — защищённый PHP HMAC gateway; `TransferServis` — Android Java, отдельный [PUSH-00, PR №25](https://github.com/lobanov0710-blip/TransferServis/pull/25).  
**База требований:** [ТЗ пассажира v0.2](https://github.com/lobanov0710-blip/TransferServis/blob/master/docs/PASSENGER_APP_TECHNICAL_SPEC_V0_2.md).  
**Неизменяемо:** [API_CONTRACT_V1.md](API_CONTRACT_V1.md) имеет статус **FROZEN**; `passenger_order:read` — **read-only**; staff JWT/refresh, `staff_push_devices` и `PUT/DELETE /staff/push-device` не становятся пассажирскими.

## 1. Проверенная фактическая база

- `src/core/passengerOrderAccess.js` выдаёт и проверяет capability `scope = passenger_order:read` на **один** `orders.id` с `expiresAt`; это отдельный ключ от staff JWT и proxy HMAC.
- Пассажирский доступ проходит по `https://transfer-servis52.ru/api/*` (PHP HMAC → Worker), а не через прямые вызовы приватного staff Worker API.
- `src/core/proxyAuth.js` проверяет HMAC по *точному пути, времени и необработанному body*; новый маршрут должен иметь свою точную каноническую строку.
- `migrations/0004_staff_push_devices.sql`, `staffPushDeviceRepository.js` и `staffPushNotificationService.js` предназначены для **сотрудников**; отправка FCM водителям фильтрует staff session family и активные аккаунты, не обобщать это на пассажира.
- `orders.status = new/taken/in_progress/done/canceled`. В frozen v1 **нет** достоверного события `driver_arrived` или времени подачи `pickup_at_utc`.
- `src/core/firebaseMessaging.js` уже содержит отправку data-only FCM в рамках staff сценария, но привязка пассажирского устройства и токена к `orderId` **отсутствует**.

## 2. Целевая граница доверия

```text
Android Passenger (own order capability)
  └─ HTTPS: /api/passenger-push-device.php  [предложенное имя, НЕ существует]
        └─ PHP verifies/limits request, HMAC signs raw request
             └─ Worker: /passenger/push-device [предложенное имя, НЕ существует]
                  ├─ verifyProxyRequest (exact path)
                  ├─ verifyPassengerOrderAccess (scope=passenger_order:read)
                  ├─ load authoritative D1 order + status + own orderId
                  └─ restricted registration/revocation operation
                        └─ D1 passenger_push_devices [НЕ создана]
```

**Нельзя использовать read-only токен как универсальный write-токен.** Для *одной ограниченной операции регистрации своего устройства* нужно явно определить и проверить отдельную серверную авторизацию: либо короткоживущий `passenger_push:register` capability, выдаваемый при авторизованном обмене, либо строго документированное право register/revoke только на **свой** `orderId`, привязанное к действительной read capability и installationId. Это **открытое проектное решение**; отсутствие его реализации — блокирующий дефект.

Если выбирать выдачу нового capability, авторизацию и срок действия нового токена нельзя путать с исходным `passenger_order:read`. Его нельзя присылать в push, логи, URI или аналитику.

## 3. Предлагаемые операции (имена не утверждены)

| Метод и контур | Доступ | Эффект | Запрет |
|---|---|---|---|
| `PUT /passenger/push-device` через отдельный PHP gateway | проверенная пассажирская capability + узкая запись | регистрация или ротация токена своего installationId | нельзя зарегистрировать чужой orderId или status terminal |
| `DELETE /passenger/push-device` через gateway | проверенный владелец этого installationId/заказа | отзыв по своему installationId | нельзя удалить устройство другого заказа |
| Внутренний `notifyPassengerOrderUpdated` | только доверенная бизнес-операция Worker | outbox/delivery после авторитетного D1 transition | нельзя принимать event от клиента |
| Ответы операций | минимальные `{ok:true}` или код отказа | никаких FCM token/прав другого заказа в JSON | не возвращать staff JWT и чувствительные значения |

**Схема запроса** для примера, без секретов в полях/URL и без включения в действующий API v1:

```json
{
  "accessToken": "REDACTED_SERVER_VERIFIED_PASSENGER_TOKEN",
  "installationId": "5d98e332-05e9-4e90-a4e1-bc61c1342030",
  "platform": "android",
  "fcmToken": "REDACTED"
}
```

`accessToken` отправлять только в HTTPS body по узкому gateway, не в URI; PHP HMAC остаётся единственным серверным credential. Существующие `/api/order.php` и `/api/order-status.php` не изменять скрытно. Запрос удаления обязан работать также при ротации FCM token; если capability истекла, сервер автоматически очищает подписку по expiry без надежды на клиентский logout.

## 4. Предложенная D1-модель (пока не миграция)

Новая `passenger_push_devices` с полями:

- `installation_id` — UUID локальной установки; не FCM registration token.
- `order_id` — FK на `orders.id`, строго из проверенного subject capability.
- `fcm_token` — секретное значение для маршрутизации FCM (не логировать, не выдавать API); допустимую максимальную длину проверить по действующим ограничениям FCM и Worker, не подменять `staff_push_devices`.
- `platform` (`android`), `registered_at`, `updated_at`, `expires_at`, `revoked_at` (Unix ms), `last_event_id` / delivery ledger по необходимости.
- Индексы по `order_id`, `expires_at`, `installation_id`; выбор PK и допустимого числа устройств на заказ — **требует contract review**.
- TTL/удаление: автоматический отзыв при `done/canceled`, истечении права, смене привязки установки или обнаруженном `UNREGISTERED`; retention нельзя объявить окончательно без privacy-решения.

**Изоляция:** не мигрировать staff устройства в passenger таблицу, не связывать `installation_id` с staff account, не давать читателю одного заказа выбирать устройства другого. Для исходящего FCM строго проверять `orders.id`, статус и права при выборке из D1; наличие строки с токеном **не является** разрешением отправки.

## 5. Контракт минимального FCM data message (v1, проект)

```json
{
  "v": "1",
  "type": "passenger_order_updated",
  "eventId": "eea07921-11d1-4204-b106-29d9e9521122",
  "orderId": "68516805-d870-4bc9-ac4a-43995df5bc05"
}
```

- `orderId/eventId` — канонические UUID. Должны совпасть с текущей собственною неистёкшей пассажирской сессией Android. Чужое/устаревшее событие отклонять.
- Нет `status`, маршрута, телефона, ФИО, ключа доступа, содержимого чата, цены/времени поездки, координат.
- Дедупликация `eventId` + `installationId` и idempotent send/outbox — отдельный обязательный модуль.
- Получение FCM — **не доказательство состояния заказа**: клиент запрашивает `/api/order-status.php` по действующей capability и показывает только подтверждённое сервером состояние.
- Не отправлять `driver_arrived` по приближённому GPS; напоминания невозможны без подтверждённого времени подачи и отдельной бизнес-политики.

## 6. Граничные сценарии и авторизация (обязательно до деплоя)

| ID | Сценарий | Результат |
|---|---|---|
| PAPI-01 | Нет HMAC/неверное время или путь | 403, отсутствие чтения/записи device и утечки токенов |
| PAPI-02 | Чужая/просроченная passenger capability | 403, нет регистрации/удаления или выдачи чужого состояния |
| PAPI-03 | Подмена `orderId` из тела | сервер игнорирует или отвергает: владелец только из подписанного `sub` |
| PAPI-04 | Повтор `PUT` c тем же installationId/token | идемпотентный upsert, нет новой подписки/лишней доставки |
| PAPI-05 | Ротация FCM token | обновление той же установки, старый token не отправляется |
| PAPI-06 | Чужая `DELETE` с угаданным installationId | отказ, соседняя запись не удалена |
| PAPI-07 | Заказ `done/canceled` или доступ истёк | устройство более не eligible for delivery, cleanup независимо от Android |
| PAPI-08 | Фальшивый статус/неподтверждённое изменение | нет отправки, клиент не принимает статус из payload |
| PAPI-09 | `UNREGISTERED` от FCM | удаление/отзыв конкретной записи без изменения заказа |
| PAPI-10 | Delivery duplicate/race и отмена во время отправки | идемпотентный event ID, не допускается новое уведомление после смены прав в проверяемой границе |
| PAPI-11 | Staging окружение | **никакой реальной отправки FCM**, тест только с моком |
| PAPI-12 | Неверный `installationId`, platform, oversized token/body | 400/413, не происходит INSERT, нет PII в логах |

### Защита текущих функций

- `GET /orders`, staff auth, staff push, quote, passenger `POST /orders` и `POST /order-status` сохраняют v1 договор и D1 source-of-truth.
- Нет прямого Worker URL/секретов в пассажирском APK.
- Новые миграции в production D1 только после отдельных тестов, dry-run, backup/recovery-плана и разрешения владельца.
- Для новых endpoints — авторизационные негативные тесты + Mock FCM; настоящие сообщения в production только после отдельного решения.

## 7. Контрольная последовательность

1. Закрыть модель узких прав регистрации (новый push capability vs строго ограниченный register с read auth). Утвердить allowed statuses, TTL, число устройств, способ отзыва.
2. Подготовить **отдельный кодовый backend PR** с аддитивной миграцией, сервисом и тестами без отправки реальных push. Не запускать миграцию на production D1.
3. Подготовить **отдельный PHP gateway PR** c HMAC для exact-path Worker и безопасной авторизацией.
4. Зарегистрировать Firebase passenger Android app(s) для `ru.transferservis.app` и `ru.transferservis.app.staging`, определить проект и порядок предоставления config (без service-account секретов в Git).
5. Добавить FCM SDK, регистрацию/revoke, user opt-in, data-only handler, приватное локальное уведомление в отдельном PR `TransferServis`; обеспечить полную деградацию без FCM.
6. Выполнить тесты CI, staging/mocks, затем **только по отдельному разрешению** production E2E и rollout.

**Решения по инфраструктуре и безопасности открыты; это документационный PR, не разрешение на изменение production.**
