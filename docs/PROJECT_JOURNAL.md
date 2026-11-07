# Журнал backend-аудита — 2026-11-07

Канонический журнал проекта:
https://github.com/lobanov0710-blip/TransferDriver/blob/arch/spec-v1-security-baseline/docs/PROJECT_JOURNAL.md

По поручению владельца проведён аудит backend Phase 1 на базе
`0d764bc4ce4b60360448ec54b61d8d7f03727e8d` и Android security branch.
D1–D3 утверждены, D4–D7 не утверждены.

Исправлены SQL audit/idempotency races availability/phase, replay ordering,
смена машины при активном назначении и отказ off_line после отзыва approval.
Удалены адресные/raw exception logs, JSON API отвечает no-store/nosniff.
Scoped overrides обновляют Miniflare sharp/undici до проверенных версий.
Добавлены 19 regression scenarios, выполняющие реальные SQLite migrations/SQL
и динамические privacy-проверки. CI включает установку lock, audit и dry-run bundle.

Проверки: 57 npm test suites PASS; 14 migrations PASS; npm audit 0;
npm ci --ignore-scripts PASS; Worker dry-run PASS. Production не вызывался.
Предварительные red-тесты воспроизвели ошибки до исправлений.

Отчёт: `AUDIT_2026-11-07.md`; lock inventory: `AUDIT_DEPENDENCIES_2026-11-07.json`.
Новые изменения предназначены для существующего Draft PR #28.
Merge/deploy не выполнялись. Реальные D1/R2/Firebase E2E и release остаются
отдельной обязательной проверкой.

Следующие блокеры: terminal done/canceled mutations с revision/idempotency/audit,
полный photo-check eligibility и согласование Android с /v1 assignment flow.

## CI run 156: обнаружена разница npm, исправление воспроизводимости

Первый CI нового audit commit e774e4fe6e25956aff5e8a474ffdb1e5808134cc
завершился EUSAGE на npm ci: runner Node 22 использовал npm 10.9.9,
а scoped-overrides lock был подготовлен и проверен npm 11.9.0.
Тесты и audit в этом CI запуске не выполнялись.

В CI явно устанавливается npm 11.9.0; packageManager/engines описывают
поддерживаемые версии. Lock обновлён тем же npm, unsafe versions не возвращались.
Зафиксированы SHA checkout/setup-node из прошедшего setup run 156,
checkout больше не сохраняет credentials для последующих шагов.
Повтор CI запускается на новом commit; результат записывается отдельно.

## Повтор CI и локальный workerd/D1

GitHub Actions run 157: PASS на `0e43d577d8a74e2df09f9cea025df4597653b83a`.
https://github.com/lobanov0710-blip/uber-v3/actions/runs/42369019150

На Node 22 прошли npm ci, audit, 14 migrations, 57 наборов и bundle dry-run.
Дополнительно локальный workerd/D1 проверил availability success / losing claim /
stale revision и auditRows=1. Проверка сохранена в tools/check_availability_d1.mjs
с синтетическими fixtures/эпhemeral D1 и добавлена отдельным шагом CI.
При настройке smoke старый формат options был отклонён Miniflare 5;
использован официальный convertV4MiniflareOptions, без обхода защит.
Реальная production D1/Firebase/R2 не вызывалась. Merge/deploy не выполнялись.

## D3 terminal mutations hardening — completed 2026-11-07

Публичный `POST /orders/{orderId}/status` для terminal transitions приведён к
утверждённому D3-контракту.

Реализовано:
- `done` и `canceled` требуют обязательные `Idempotency-Key` и
  `expectedRevision`;
- driver может завершить только собственную `in_progress -> done` поездку;
- admin cancellation остаётся server-authoritative и требует `orders.cancel`;
- одинаковый idempotency key с тем же запросом возвращает сохранённый результат,
  с изменённым body/revision отклоняется;
- migration `0015_order_terminal_mutation_guard.sql` добавляет только opaque
  internal claim marker `last_terminal_claim_id`; raw `Idempotency-Key`
  в `orders` не сохраняется;
- success-path одной D1 batch связывает idempotency claim, terminal order update,
  terminal assignment update, success audit и сохранённый idempotency result;
- `done` переводит active `in_trip` assignment в `completed`;
- `canceled` отзывает active assignment в `revoked`;
- legacy orders без assignment остаются совместимыми;
- stale revision / проигравший claim не могут создать ложный success audit;
- ошибка audit insert откатывает terminal state и idempotency claim.

Проверки:
- migration smoke: 15/15 PASS;
- новый real-SQLite terminal suite: 7/7 PASS;
- полный `npm test`: PASS;
- npm audit: PASS;
- local workerd/D1 audit check: PASS;
- Worker `wrangler deploy --dry-run`: PASS;
- GitHub Actions run 173: PASS на code head
  `1f115c517be8cf1635b9b2f14531c0e4dec9f51a`.

Первые CI run 167/169 выявили несовместимость старого router test-double с новой
`changes()`-цепочкой; run 171 дошёл до нового SQLite-suite и выявил только
prototype-sensitive assertion Node SQLite. Оба дефекта исправлены в тестах;
production terminal mutation logic не ослаблялась.

Merge и production deploy не выполнялись. D4–D7 не выбирались.
Следующий утверждённый D3-блок: server-authoritative photo-control eligibility,
после него — support/photo-control API и дальнейшее согласование Android с
assigned-only `/v1` flow.

## D3 photo-control eligibility and support API foundation — 2026-11-07

После закрытия terminal hardening начат следующий утверждённый D3-блок.

### Photo-control

Добавлена additive migration `0016_photo_control_support_hardening.sql`:
- `vehicle_photo_checks.revision`;
- server-authoritative `restriction_mode`:
  `grace_period | after_current_trip | immediate`;
- `created_by`;
- дополнительные индексы eligibility.

Реализован утверждённый контракт:
`POST /v1/admin/vehicles/{vehicleId}/photo-checks`.

Требования:
- текущая staff-session;
- permission `vehicles.verify` либо OWNER override;
- обязательный `Idempotency-Key`;
- обязательный `expectedRevision` автомобиля;
- reason 1..500;
- `monthly` создаётся с утверждённым ТЗ grace-period ровно 24 часа;
- `complaint/manual` требуют режим `after_current_trip` либо `immediate`.

Создание одной D1 batch связывает idempotency claim, revision автомобиля,
photo-check, success audit и сохранённый idempotent response.

Photo-control eligibility теперь является server-side hard gate:
- `PUT /v1/driver/availability` не разрешает `on_line`, если check blocking;
- assign/reassign не разрешают новое назначение blocking-автомобиля;
- те же ограничения проверяются непосредственно SQL, а не только service/UI;
- `monthly` в пределах 24 часов остаётся допустимым `grace_period`;
- после grace новые `on_line`/assignment запрещаются;
- `after_current_trip` и `immediate` запрещают новые назначения сразу;
- существующая поездка автоматически не отменяется: отдельного product rule на
  auto-cancel ТЗ не задаёт, решение остаётся за уполномоченным администратором.

Автоматический ежемесячный scheduler и review/result API ещё не объявляются
готовыми. Они нужны, чтобы полностью замкнуть lifecycle photo-control.

### Driver support

Реализован утверждённый create-контракт:
`POST /v1/driver/support-cases`.

- только authenticated Driver;
- категории строго из ТЗ;
- обязательный `Idempotency-Key`;
- создаётся только собственный case;
- при `orderId` backend проверяет историческую/текущую принадлежность заказа
  водителю и скрывает чужой ресурс как 404;
- support endpoint не меняет и не отменяет заказ;
- case создаётся с `revision=1`;
- claim, insert, audit и сохранённый response связаны одной D1 batch.

Для create нового supportCase prior revision отсутствует; optimistic revision
фиксируется с версии 1 и должен быть обязателен для будущих update/resolve mutations.

### Проверки

GitHub Actions run 188: PASS на
`4b8de9e44d44098917909fafcb9e81fbf5e13838`.

- migration smoke: 16/16 PASS;
- полный `npm test`: PASS;
- новый real-SQLite suite photo-control/support: 5/5 PASS;
- monthly 24h grace: PASS;
- block after grace: PASS;
- immediate unplanned assignment block: PASS;
- support idempotency/audit: PASS;
- чужой order в support: PASS/404;
- local workerd/D1 audit check: PASS;
- Worker dry-run: PASS.

Merge и production deploy не выполнялись. D4–D7 не выбирались.
Следующий безопасный D3-подэтап: замкнуть photo-check lifecycle
(review/result + привязка приватных контрольных фото + monthly due generation),
после чего расширять support lifecycle/chat без VoIP/D5 решений.

## D3 photo-control lifecycle + support/chat lifecycle — completed 2026-11-07

### Photo-control lifecycle

Foundation photo-control замкнут полноценным server-authoritative lifecycle.

Добавлена migration `0017_photo_check_lifecycle.sql`:
- `vehicles.last_photo_check_passed_at`;
- `vehicles.next_photo_check_due_at`;
- nullable binding `photo_check_id` для private upload session и
  `vehicle_photos`;
- `vehicle_photo_checks.next_due_at` и `last_review_id`;
- immutable history `vehicle_photo_check_reviews`;
- unique monthly `vehicle_id + due_at` для idempotent due-generation.

Контрольные фото используют существующий private R2 upload-контур:
- permanent public URL не создаётся;
- upload проверяет принадлежность `driver + vehicle + photoCheck`;
- photo-control фото не участвуют в registration readiness/moderation;
- admin bundle отдаёт только resource metadata/ID, а чтение самого private object
  остаётся в существующем permission/audit контуре.

Новые контракты:
- `GET /v1/driver/photo-checks`;
- `GET /v1/admin/vehicles/{vehicleId}/photo-checks/{photoCheckId}`;
- `POST /v1/admin/vehicles/{vehicleId}/photo-checks/{photoCheckId}/review`.

Review требует `vehicles.verify`, `Idempotency-Key`, `expectedRevision`.
Решения: `passed | failed | manual_review`. Успешный `passed` требует полный
набор 7 контрольных ракурсов, атомарно пишет review history + audit, увеличивает
revision проверки и автомобиля, сохраняет server timestamp последнего PASS и
следующий due.

Периодичность реализована как один календарный месяц от server PASS/approval
с end-of-month clamp. При первичном approval автомобиля сразу устанавливается
первый `next_photo_check_due_at`.

Hourly Worker cron материализует наступивший monthly due в отдельный pending check.
System audit использует `actor_account_id=NULL`, а не имитирует OWNER.
Cron является materializer, а не единственной защитой: `on_line` и
assign/reassign fail-closed по сохранённому `next_photo_check_due_at + 24h`,
даже если cron не запускался. Production cron не активирован, поскольку deploy
не выполнялся.

Проверки lifecycle:
- migration smoke: 17/17 PASS;
- photo-control lifecycle real-SQLite: 6/6 PASS;
- calendar month/end-of-month: PASS;
- private photo-check binding/isolation: PASS;
- review PASS/history/replay/next-due: PASS;
- retry-safe monthly generator + system audit: PASS;
- overdue pre-cron on_line gate: PASS;
- overdue pre-cron assignment gate: PASS;
- GitHub Actions run 206: PASS на
  `9e93988b509e26acbcc4de6e6be3c11c870d0c48`.

### Driver ↔ Administrator support lifecycle/chat

Support foundation расширен без изменения order state machine и без VoIP.

Driver:
- `GET /v1/driver/support-cases`;
- `GET /v1/driver/support-cases/{caseId}`;
- `POST /v1/driver/support-cases/{caseId}/messages`.

Admin:
- `GET /v1/admin/support-cases`;
- `GET /v1/admin/support-cases/{caseId}`;
- `POST /v1/admin/support-cases/{caseId}/messages`;
- `POST /v1/admin/support-cases/{caseId}/status`.

Для dispatcher введён granular permission `support.manage`; OWNER проходит через
существующий server-authoritative override. Driver видит/пишет только собственные
cases. Закрытый case новые сообщения не принимает.

Message/status mutations требуют обязательные `Idempotency-Key` и
`expectedRevision`, mutation + message/status + audit + replay-result связаны
D1 batch. Support status mutation не вызывает order mutation: водитель по-прежнему
не получает API отмены заказа.

Для support chat применяется уже утверждённый срок 30 календарных дней:
- `expires_at` задаётся backend;
- expired сообщения перестают отдаваться сразу по server timestamp;
- hourly retention job физически удаляет expired live-D1 messages;
- вместе с ними удаляются idempotency rows операций сообщений, чтобы
  `request_digest` не переживал chat retention;
- idempotent response не содержит body сообщения;
- audit retention job не содержит chat text/PII.

Это относится к live D1. Backup-retention/юридические правила не объявляются
закрытыми и остаются вне D3; D5 не утверждался.

Проверки support:
- support lifecycle real-SQLite: 5/5 PASS;
- own-case isolation: PASS;
- revision/idempotency replay: PASS;
- chat body absent from idempotency result: PASS;
- dispatcher without/with `support.manage`: PASS;
- support status never mutates linked order: PASS;
- 30-day hide/delete + system audit: PASS;
- idempotency digest cleanup: PASS;
- migration smoke: 17/17 PASS;
- full npm test: PASS;
- local workerd/D1 audit check: PASS;
- Worker dry-run: PASS;
- GitHub Actions run 216: PASS на
  `92cb7013c934125b243a911e7bf188dbeebf9efd`.

Merge и production deploy не выполнялись. D4–D7 не затрагивались.
Следующий D3-подэтап: согласовать Android TransferDriver с готовыми
server-authoritative `/v1` contracts (photo-check/support/assigned-only flow)
и добавить клиентские contract/instrumentation tests без обхода backend guards.

## 2026-11-07 — D3 photo-control client recovery contract

Для Android photo-control UI расширен driver read-model без изменения policy:

- `GET /v1/driver/photo-checks` теперь возвращает `uploadedKinds` в
  server-authoritative порядке обязательных ракурсов;
- `uploadedKindCount` сохранён для совместимости;
- список формируется только по private `vehicle_photos`, связанным с конкретным
  `photo_check_id + vehicle_id`;
- public URLs не добавлялись;
- D4/liveness не затрагивался.

Причина: после restart/network uncertainty Android должен восстановить фактически
принятые backend ракурсы, а не угадывать их по локальному состоянию.

Regression:
- photo-control lifecycle SQLite проверяет полный `uploadedKinds`;
- full backend CI GitHub Actions run 220 — PASS на
  `abb787ddd1017c0b7e0a20ca68b62a530f8eea44`.

Production deploy и merge не выполнялись.

## 2026-11-07 — D3 STAGING E2E readiness audit + D2 prerequisite

Проведён read-only аудит фактического `uber-v3-staging` перед Driver
photo-control/support E2E. Remote mutations, D1 migration apply и Worker deploy
не выполнялись.

### Фактическое состояние STAGING

Cloudflare read-only checks подтвердили:
- Worker: `uber-v3-staging`;
- D1: `transfer-servis52-staging`;
- D1 ID: `66474481-a123-47f9-81b4-12af7565ec8d`;
- KV `DRIVERS`: `b8fdeb74fda8415ab06b3b1c86c78e8f`;
- active Worker bindings: `APP_ENV`, `DB`, `DRIVERS`;
- `DRIVER_PRIVATE_FILES` R2 binding отсутствует;
- `FIREBASE_PROJECT_ID`, `FIREBASE_PROJECT_NUMBER`,
  `FIREBASE_DRIVER_APP_ID` отсутствуют;
- active production Worker также не содержит этих D2 Firebase identifiers.

Live unauthenticated probe текущего STAGING:
- `GET /v1/driver/me` -> HTTP 404;
- следовательно deployed staging Worker ещё не содержит Driver v1/D3 API.

### STAGING D1

Remote migration list показывает 13 pending migrations:
`0005` ... `0017`, включая:
- `0016_photo_control_support_hardening.sql`;
- `0017_photo_check_lifecycle.sql`.

Fail-closed static audit pending chain:
- pending migrations: 13;
- `ALTER TABLE ... ADD COLUMN`: 28;
- destructive statements: 0;
- unsafe ALTER: 0;
- `D3_MIGRATION_STATIC_SAFETY=PASS`.

Read-only D1 state:
- tables: legacy order/quote/staff base only; `driver_profiles` ещё нет;
- orders: 6;
- quotes: 14;
- staff_accounts: 0;
- Time Travel: available;
- remote mutations: none.

### Canonical preflight

Добавлен `tools/d3_staging_preflight.py` + regression tests.
Gate блокирует staging deploy если:
- Worker/D1/KV не совпадают с staging identities;
- используется production D1/KV;
- отсутствует private `DRIVER_PRIVATE_FILES` R2;
- R2 bucket не staging-scoped;
- отсутствует/некорректен `DRIVER_UPLOAD_MAX_BYTES`;
- отсутствуют D2 Firebase public identifiers;
- отсутствует hourly cron;
- config содержит credential-like vars;
- migration chain неполна/содержит destructive SQL или unsafe ALTER.

Backend CI run 229 на code/docs-preflight head
`42adb7854ff5cf1511b0862b4774acdb7afac58c` — PASS.

### Вывод

Authenticated D3 STAGING E2E пока технически заблокирован инфраструктурой.
До E2E нужны отдельные подтверждённые remote actions:
1. staging D1 migrations `0005–0017`;
2. отдельный private staging R2 + binding;
3. подтверждённые Firebase project ID/number/Driver app ID;
4. staging-only Worker deploy;
5. повторный route probe;
6. Firebase Phone/App Check Driver session exchange.

Никакие перечисленные remote actions в этом checkpoint не выполнялись.
Production не изменялся. D4–D7 не затрагивались.
