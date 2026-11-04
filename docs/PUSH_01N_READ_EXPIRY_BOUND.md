# PUSH-01N — ограничение пассажирской push-регистрации read capability

Дата: 04.11.2026. Статус: отдельный Draft поверх PUSH-01M / uber-v3 PR №25. Не включено в production.

## Проверенный недостаток

Ранее регистрация пассажирского FCM-устройства сохранялась на 7 дней от времени регистрации, не учитывая, что связанный `passenger_order:read` JWT может истечь раньше (например, когда пассажир регистрирует устройство в конце срока доступа). Это могло оставить запись, допущенную по сроку регистрации, **после истечения read capability**. В проекте нет реальной пассажирской отправки FCM: эксплуатация или реальная доставка после истечения сессии не подтверждена.

`verifyPassengerOrderAccess` уже возвращает `expiresAt` из проверенного read-JWT. Существующий срок read capability задаётся исходным API v1 для заказа и не меняется.

## Изменение

- Новый push `manage` / `revoke` grant содержит строго серверный, **подписанный** claim `readExpiresAt`, полученный непосредственно от `verifyPassengerOrderAccess` после проверки HMAC/JWT и привязки к заказу. Пользователь не может передать эту величину в JSON body: формы PHP/Worker grant запросов не изменены.
- Выдача grant запрещается, если подтверждённый `readExpiresAt` не является корректным целым числом Unix milliseconds, не кратен 1000 или уже истёк. Ни при каких обстоятельствах не использовать недостоверный или отсутствующий срок.
- `verifyPassengerPushGrant` отклоняет подписанные grant без `readExpiresAt`, с некорректным или уже истёкшим сроком, даже если собственный короткий grant-JWT ещё действителен. Это применяется и к `manage`, и к `revoke-only`, чтобы не создавать обход просроченной capability.
- `registerPassengerDevice`: `expiresAt = min(now + 7 days, readExpiresAt)`; если срок уже вышел — 403 до D1. `registerPassengerPushOnce` дополнительно запрещает запись за пределами `principal.readExpiresAt`, даже при прямом внутреннем вызове.
- Точный `expires_at` в D1 уже проверяется `findEligiblePassengerPushTarget` из PUSH-01K. Поэтому после read expiry такая регистрация не должна быть включена в будущую отправку, даже если cleanup ещё не выполнился.
- Никаких изменений `passenger_order:read` JWT v1, существующего PHP HTTP JSON, контрактов заказов, дополнительных D1 миграций, worker routes, Firebase SDK, cron, STAGING/production конфигураций.

## Тесты

- `tests/passengerPushGrantIssuer.test.mjs`: expiry неизменённого read-JWT передаётся в подписанный grant; истёкшая capability не создаёт grant.
- `tests/passengerPushDevice.test.mjs`: короткая 90-секундная сессия ограничивает регистрацию, длинная 30-дневная — прежние 7 дней; grant без срока, с неправильным сроком или истёкшим read claim отклоняется до D1; транзакционный слой не принимает overlong expiry.
- `tests/passengerPushDeviceRouter.test.mjs`: все Mock-D1 тестовые grants содержат корректный серверный claim.
- `tests/passengerPushPhpWorkerD1.integration.mjs` и `tests/passengerPushHttpLoopback.e2e.mjs`: настоящий PHP HMAC/localhost HTTP→Worker Router→SQLite; срок FCM-регистрации не превышает подписанный срок read JWT. Все прежние HMAC/nonce/one-time и revoke tests обязаны оставаться зелёными.

## Остаточные риски и границы

1. Истечение read JWT теперь ограничивает **новые** регистрации в D1. Это не отменяет уже выданных регистраций, созданных старой реализацией: перед будущим rollout нужно отдельно проверить/обезличить существующие записи. Ни одна из этих веток ещё не deployed.
2. Локальное удаление пассажирского сеанса из Android **не** является серверным отзывом read JWT. Сервер не ведёт отдельный per-session revocation list. Не утверждать, что локальный logout автоматически блокирует push без отдельного подтверждённого DELETE.
3. Если read-JWT истёк до получения revoke grant, новый grant больше не выдаётся: это намеренный fail-closed. Бездоказательный отзыв без авторизации запрещён. Операторская bounded cleanup (PUSH-01M) — отдельный будущий процесс.
4. Race между SQL eligibility и внешней отправкой Firebase не устранён; real sender отсутствует.
5. Нельзя объединять зависимые PR, менять remote D1, запускать Firebase/FCM, подписывать APK или делать production deploy без разрешения владельца. STAGING использовать лишь при необходимости тестирования; production — основная продуктовая среда.
