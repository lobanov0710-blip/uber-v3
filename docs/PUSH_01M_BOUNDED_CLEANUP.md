# PUSH-01M — ограниченная ручная очистка пассажирских FCM-токенов

Дата: 04.11.2026. Статус: Draft поверх PUSH-01L PR №24, без production rollout.

## Назначение

Предусмотренный ранее `maintainPassengerPushData` не вызывается автоматически и потенциально обновляет неограниченное число регистраций одним запросом. До утверждения retention и расписания безопаснее подготовить **отдельный ограниченный вариант**, который может использоваться оператором после согласования.

В новом `src/core/passengerPushMaintenanceBatch.js` экспортируется `redactPassengerPushTokensBatch`. **В production коде никто её не вызывает**: нет HTTP API, cron, очередей, событий, Firebase, миграций и конфигурационных правок.

## Безопасные границы

- Вызов `redactPassengerPushTokensBatch(env, { now, limit, execute })`. По умолчанию `execute=false`: выполняется только SQL `SELECT COUNT(*)`, без чтения/вывода FCM-токенов.
- `limit` — целое число от 1 до 100 включительно, по умолчанию 50. SQL использует `LIMIT ?3` как параметр. Результат превью — **верхняя граница числа кандидатов в текущей пачке**, не число всех оставшихся устройств.
- Для `execute=true` требуются **оба** точных признака: `APP_ENV="production"` и `PASSENGER_PUSH_MAINTENANCE_ENABLED="true"`. Нет «автоматического переключения» из STAGING.
- Перед `UPDATE` выполняется read-only preview. В самом `UPDATE` кандидаты **переоцениваются заново** по состоянию D1 и ограничиваются `LIMIT ?3`. Если статус успел смениться, SQL действует на актуальных кандидатов.
- Кандидаты: `revoked_at IS NOT NULL`, `expires_at <= now` либо связанный заказ `done/canceled`. Меняется только `passenger_push_devices.fcm_token` (заменяется на `__REDACTED__`), `revoked_at` и `updated_at`. Tombstones сохраняются.
- Отсутствие D1, SQL ошибка, неверное число строк, превышение лимита — отказ без раскрытия токенов. `redacted=0` после preview с ненулевым счётчиком возможен при одновременной смене состояния, это не успешная очистка.
- `staff_push_devices`, `orders`, `quotes`, grants, HMAC/nonce и existing v1 API не изменяются.

## Проверки

- `npm test`: без разрешающих флагов нет записи и не вызывается SQL, execute без флагов отказан; запрос/UPDATE bound не более 100 записей; ошибки D1 не превращаются в успех.
- `tests/passengerPushMaintenanceBatch.sqlite.py` запускает **точный SQL из модуля** на in-memory SQLite после миграций 0001–0008: 108 кандидатов очищаются 100+8, активный остаётся нетронут, уже redacted не меняется, terminal order после preview перепроверяется при UPDATE, целостность staff/foreign keys сохранена.
- Два независимых PHP/Worker локальных интеграционных контура, Node backend и существующие lifecycle tests должны остаться зелёными.

## Оставшиеся обязательные решения до реального исполнения

1. Утвердить privacy retention, SLA удаления expired/terminal token и schedule/операционный доступ, изоляцию прав, dry-run preview, метрики без идентификаторов, аварийный rollback. Этот PR **не назначает расписание и не запускает очистку**.
2. Старый `maintainPassengerPushData` остаётся неиспользуемой ручной функцией для grant-event и replay-jti retention; новая bounded-функция пока ограничивается только FCM-токенами. Не включать старый неограниченный метод в cron.
3. Смена order status между проверкой D1 и **внешней** Firebase отправкой не может быть полностью предотвращена только SQL. Отправитель не включён: требуется отдельное решение про authenticated refresh, payload без PII и проверку перед отправкой.
4. Истёкший `passenger_order:read` не даёт новый revoke grant; новый bounded cleanup защищает лишь регистрационные TTL/terminal/revoked состояния, а не read-session expiration. Нужно отдельно согласовать связь push TTL с пассажирской сессией.

Не выполнять deploy, `PASSENGER_PUSH_MAINTENANCE_ENABLED=true`, применение миграций, включение FCM или merge без отдельного разрешения владельца. STAGING только для необходимых тестов, production — основная среда продукта.
