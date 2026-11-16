# Admin assignment read API — утверждённый вариант A

Владелец 2026-11-16 явно подтвердил: «Вариант A утверждаю» для версии2
ADMIN_ASSIGNMENT_READ_API_PROPOSAL_2026-11-15.md в TransferDriver PR#9.
Это детализация D3. G1paused, D4–D7pending; merge/deploy отдельно.

## Контракт

`GET /v1/admin/orders?status=new|taken|in_progress&limit=20&cursor=...`

Параметры необязательны: без status все три операционных состояния, limit1–50,
default20. Строгие значения; пустые/дубли/неизвестные параметры возвращают400.
Ответ: `{ok, orders, nextCursor, requestId}`. Order содержит только
`id, from, to, date, tariff, status, revision, assignment`.
Legacy from/to/tariff могут быть null. Assignment либо null, либо
`{id, driverId, vehicleId, revision, phase}` текущего active назначения.
Имя/телефон пассажира, comment, raw route, private URLs не выбираются в SQL.
Legacy GET /orders не меняется; новый список не имеет cutoff1000.

`GET /v1/admin/orders/{id}/assignment-options?limit=20&cursor=...`

Ответ: `{ok, orderId, orderRevision, options, nextCursor, requestId}`.
Option содержит только `driverId, fullName, vehicleId, make, model, plate,
status, availability:{state,activeVehicleId}, eligible, blockers`.
fullName/status/activeVehicleId могут быть null при отсутствии данных.
Возвращаются существующие driver+vehicle пары, включая недопущенные с причинами;
пустой список возвращается как options:[], nextCursor:null. Нет документов,
VIN/phone/DOB, biometric material или private URLs. Offline явно показан и
сам по себе не исключает ручное назначение, как в действующем mutation API.

Blockers используют общую с assign/reassign функцию текущего D3 допуска:
`driver_not_found`, `driver_not_active`, `driver_not_approved`,
`identity_verification_required`, `vehicle_not_found`, `vehicle_not_approved`,
`vehicle_photo_control_required`, `active_vehicle_mismatch`.
Плюс состояние операции: `order_not_assignable`, `order_not_reassignable`,
`assignment_unchanged`. Reassign только taken с active assignment; in_progress
не получает нового исключения из действующего запрета. Нет score/rank,
рекомендаций/автовыбора/ETA/GPS, новых фильтров расписания или D6 правил.

## Права, курсоры и аудит

Оба GET требуют authenticated staff session и server-derived admin access,
orders.read. Options также требует drivers.read, vehicles.read и права
orders.assign для нового заказа либо orders.reassign для существующего.
OWNER обходит только permission grants, с действующим server MFA. MFA flags
из query/body/JWT claims доступа не дают. Каждая HTTP авторизация заново
проверяет текущие session/account/grants/OWNER MFA.

Курсор — canonical base64url JSON с версией, scope/status либо orderId и
последними opaque IDs; max512chars, только строго проверенные строковые IDs.
Это opaque pagination token, не подпись и не credential. Изменённый cursor
не может расширить SQL/права; перенос в иной endpoint/status/order запрещён.
Порядок orders.id ASC; options driverId ASC, vehicleId ASC. LIMIT+1 определяет
nextCursor без усечения исходных данных. Page представляет текущий read-срез;
записи могут изменяться между страницами. Cursor не обещает неизменяемый
исторический snapshot. Options использует один SQL SELECT, общий eligibility
SQL projection с mutation precheck, без N+1 запросов.

Успешные чтения до выдачи ответа пишут audit_events с action admin.orders_read
либо admin.assignment_options_read, actor, target opaque ID/constant и requestId.
Данные заказов/профилей, токены и cursor в audit не попадают. Audit failure
закрывает выдачу безопасным500; SQL/provider exception text не отдаётся/не логируется.
Все ответы no-store/nosniff. Ошибки400/401/403/404/405/500 со stable code/requestId.

## Назначение остаётся отдельным действием человека

Read projection не выдаёт разрешение на запись. Существующий POST assign/reassign
получает driverId,vehicleId,reason,expectedRevision и Idempotency-Key. Сервер
повторяет проверки в момент записи; stale read ведёт к существующему conflict.
В этом срезе исправлена ошибка утверждённого D3 account active: role=driver и
status=active проверяются и в precheck, и в обоих atomic UPDATE. SQL race test
подтверждает отказ при блокировке после предварительного чтения.

Прежнее описание «atomic busy» уточнено: actual current-assignment unique index
ограничивает order_id. API не объявляет произвольное будущее назначение
конфликтом и не реализует D6 scheduling/ranking. Новых migrations/dependencies нет.

ADMIN_PHONE_TEST_ONLY whitelist не расширяется: оба operational GET остаются404
на существующем OWNER-only STAGING. Тесты используют синтетическую SQLite/HTTP
и отдельный local workerd/D1 smoke; deploy/live-приёмка сюда не входят.
