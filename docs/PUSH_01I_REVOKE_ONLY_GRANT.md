# PUSH-01I — отдельный revoke-only grant пассажирских уведомлений

Дата: 04.11.2026. Статус: Draft; основание backend PUSH-01H (PR №20). Код только в отдельной feature-ветке.

## Контракт

Прежний POST /passenger/push-grant с двумя полями accessToken и installationId продолжает выдавать passenger_push:manage только для активного заказа. Новый точный запрос с третьим полем operation="revoke" выдаёт строго passenger_push:revoke, привязанный к подтверждённому read-token заказу и installationId.

- operation допускает только буквальное revoke; другие значения и лишние поля отклоняются.
- Revoke-only grant может только DELETE /passenger/push-device; POST регистрации всегда 403, без записи в устройство или расхода jti.
- Для выдачи revoke-only допустим существующий заказ в done/canceled, если read-token действителен. Manage на терминальном заказе по-прежнему 403.
- Сохранены HMAC v2 nonce, одноразовый jti, короткий TTL, scope и orderId/installationId из серверно подписанного grant.
- Legacy manage-grant пока допускается для DELETE, чтобы не ломать существующий контракт; будущий Android opt-out должен использовать revoke-only.
- Новых SQL migrations, серверных endpoint, флагов и изменений в API v1 нет. Отправка FCM не добавляется.

## Подготовленные тесты

Issuer: активный и терминальные статусы, новый узкий scope, запрещённые operation и лишние поля, HTTPS-HMAC route.
Device API: revoke-grant POST=403, DELETE=200, повтор DELETE того же jti=409, нет изменения order/staff/FCM delivery.
Полный npm test, изолированный SQLite и PHP/Worker контрактные проверки — только в CI, без удалённых D1 и production.

## Остаточные блокеры до rollout

1. PHP gateway PR №8 сейчас принимает только два поля — требуется отдельная правка для operation="revoke" и PHP HTTP offline тесты.
2. Android PUSH-02A prepareRevocationGrant пока посылает два поля — нужно явно посылать operation="revoke" и провести MockWebServer tests, прежде чем включать network gate.
3. Текущая per-order quota 5 grants/60 sec общая для manage и revoke; при перегрузке отзыв может кратковременно получить 429. Нужна отдельная приоритетная rate-policy без unlimited issuance.
4. Истёкший пассажирский read-token не может выдавать отзыв. Плановое удаление/обезличивание expired/terminal registrations пока не включено. Требуются lifecycle и recovery-политика.
5. Отозванный installationId не может заново зарегистрироваться; для повторного opt-in необходим отдельный UX/политика новой установки.
6. Сервер не может доказать факт локального согласия Android; реальное включение требует комплексного review.

Запрещено: объединять PR, использовать production Worker/PHP/D1, применять remote migration, подписывать APK, включать real FCM или отправлять заказы без отдельного разрешения владельца.
