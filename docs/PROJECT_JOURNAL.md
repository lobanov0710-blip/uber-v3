# Журнал backend-аудита — 2026-11-07

> **Главное правило владельца, 2026-11-14:** действовать строго по утверждённым правилам, ТЗ и журналу.
> Любые самовольные отклонения и решения за владельца запрещены. При неопределённости —
> только варианты для владельца; зависящие действия ждут его явного решения. [Правило для работы](../AGENTS.md).

> **Текущая работа:** по решению владельца G1 приостановлен; начат G2 / отдельный Transfer Admin.
> TOTP выбран для подготовки предложения; параметры/контракт MFA ещё не утверждены.
> **Актуальный индекс: 2026-11-14.** [План и матрица ТЗ](https://github.com/lobanov0710-blip/TransferDriver/blob/arch/spec-v1-security-baseline/docs/PROJECT_PLAN_V1_0.md) · [Текущий аудит](https://github.com/lobanov0710-blip/TransferDriver/blob/arch/spec-v1-security-baseline/docs/AUDIT_SPEC_PLAN_JOURNAL_2026-11-14.md)
> Реализация частичная; production-выпуск не готов. SDK config/локальные сборки получены;
> подпись/Play/App Check/private R2 и живой E2E ещё не подтверждены. D1–D3 утверждены, D4–D7 нет.
> Ниже сохранена история: слова «текущий»/«отсутствует» внутри старого checkpoint относятся к его дате.

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

### 2026-11-07 — STAGING schema compatibility simulation

Дополнительный read-only migration gate выполнен после readiness audit:

- remote D1 export выполнен с `--no-data`: экспортирована только схема;
- текущая staging schema импортирована в локальный in-memory SQLite — PASS;
- локально последовательно применены все 13 pending migrations
  `0005`–`0017` — PASS;
- последняя применённая в simulation:
  `0017_photo_check_lifecycle.sql`;
- обязательные D3 tables после simulation присутствуют;
- `D3_SCHEMA_MIGRATION_SIMULATION=PASS`;
- `REMOTE_MUTATIONS=NONE`.

Simulation подтверждает совместимость migration chain с фактической текущей
STAGING schema на уровне структуры. Данные пользователей не экспортировались.
Remote `d1 migrations apply` по-прежнему не выполнялся и требует отдельного
подтверждения владельца.

## 2026-11-07 — approved STAGING D1 apply completed; R2 permission blocker

Владелец явно подтвердил переход к критическим STAGING-операциям:
применение D1 migrations, создание отдельного private staging R2 и последующий
staging-only deploy после подтверждения Firebase identifiers.

### STAGING D1 — выполнено

На временной ops-ветке `ops/d3-staging-approved-20261107` выполнен
fail-closed workflow:
`Approved D3 staging D1 migration apply`.

GitHub Actions run:
`42382257830` — **PASS**.

Перед apply workflow подтвердил:
- remote pending count: 13;
- first: `0005_driver_platform_core.sql`;
- last: `0017_photo_check_lifecycle.sql`;
- pending set: exact `0005–0017`;
- Time Travel до изменения: available;
- orders before: 6;
- quotes before: 14.

После apply:
- remote pending migrations: 0;
- orders: 6 -> 6;
- quotes: 14 -> 14;
- обязательные D3 tables present: 13/13;
- `STAGING_D1_MIGRATION_VERIFICATION=PASS`.

Таким образом migrations `0005–0017` применены именно к
`transfer-servis52-staging`
(`66474481-a123-47f9-81b4-12af7565ec8d`).

Повторный push на ops-ветку автоматически запустил тот же migration workflow
ещё раз:
run `42382345542`.

Guard увидел `REMOTE_PENDING_COUNT=0`, завершился на
`REMOTE_PENDING_SET_MISMATCH` и **не выполнял повторный apply**.
Это подтверждает fail-closed защиту от повторного критического запуска.

### Private staging R2 — заблокировано правами

Попытка создать согласованный отдельный bucket
`transfer-servis52-driver-private-staging` выполнена через Wrangler
в GitHub Actions run `42382345561`.

Результат:
- Cloudflare endpoint: `/accounts/***/r2/buckets`;
- error: `Authentication error [code: 10000]`;
- Wrangler: current API token lacks permission for R2 operation;
- `STAGING_R2_CREATE=BLOCKED`;
- bucket creation не подтверждено;
- R2 binding не добавлялся.

Обход через production bucket запрещён и не выполнялся.

### Firebase D2 identifiers

Повторный поиск по repository history, conversation/library material и current
Worker bindings не дал подтверждённых значений:
- `FIREBASE_PROJECT_ID`;
- `FIREBASE_PROJECT_NUMBER`;
- `FIREBASE_DRIVER_APP_ID`.

Package подтверждён только как `ru.transferservis.driver`.
Неподтверждённые/example значения не используются.

До получения точных Firebase identifiers backend deploy остаётся fail-closed
заблокированным.

### Текущее состояние

Выполнено:
- STAGING D1 migrations `0005–0017`.

Остаётся:
1. дать Cloudflare credential R2 create/list permission либо выполнить
   авторизованное создание bucket в Cloudflare Dashboard;
2. подтвердить реальные Firebase project ID / project number / Driver app ID;
3. создать/проверить private staging R2;
4. сформировать `wrangler.staging.toml`, пройти D2/D3 preflight;
5. выполнить deploy **только** `uber-v3-staging`;
6. повторить route probe и authenticated D3 E2E.

Production Worker, production D1/KV и production traffic не изменялись.
D4–D7 не затрагивались.


## 2026-11-11 — Продолжение D3 STAGING gate и помощь владельцу с Firebase

Сверены актуальные ветки: Driver `8b99ad9d8522aeed900a1f89dbe53f695ce1bc8c`,
backend `8cc860443f43c25f5f4edf312f5934dfd1949c11`. Ранее завершённые terminal,
photo-control, support и Android этапы не выполнялись заново.

Владелец подтвердил в текущем сеансе:
- R2 права ещё не добавлены, согласованный private bucket не создан;
- существующий Firebase-проект есть, но требуется помощь найти его настройки;
- реальные Project ID / project number / Android app ID пока не получены.

Даны конкретные инструкции Firebase Console → проект → шестерёнка →
Project settings → General, затем Android-приложение ru.transferservis.driver.
Публичные identifiers не заменяются package name или CI fixtures.
Руководство владельца: `uber-v3/docs/D3_STAGING_OWNER_SETUP.md`.

Выполнено без remote writes:
- свежий baseline: 61 набор npm test PASS, 17 migrations smoke PASS;
- GET /v1/driver/me, /photo-checks, /support-cases, /uploads на STAGING — HTTP 404;
- воспроизведены 9 отрицательных subcases в 5 новых preflight regression tests;
- закрыты singular route, nested env overrides, дополнительные resource bindings,
  другой staging-named bucket и несовместимый Firebase app/project number;
- preflight теперь принимает только ранее согласованный private bucket;
- все 12 preflight tests PASS, git diff --check PASS;
- добавлены ignore-правила для Python __pycache__/pyc, без включения build artifacts.

Firebase Basics применена для подготовки получения настоящего SDK config:
официальная CLI 15.35.0 проверена, login:list не вернул авторизованных аккаунтов.
Никакой проект/приложение Firebase автоматически не выбирались и не создавались.
Правило skill: “If no Project ID was provided, you MUST pause”; владелец выбрал
существующий проект, дальнейший выбор ожидает его подтверждённый Project ID.
Секреты и SMS-коды у владельца не запрашивались.

Cloud desktop capability enabled/unknown, но browser-control tools отсутствуют:
не доступны cua_repl.js и open_in_codex. Проверенная среда:
ccarenv_b64_Y2NhcmVudl9lNDkzYjZiZTVjNDg4MTkxYTVjYzA0YTBlMDExN2NmYg.
Владелец получил путь к настройкам в своём браузере; автоматическое открытие
Firebase Console не объявлялось успешным.

Данные о применении STAGING migrations 0005–0017 взяты из последнего backend
журнала; repeat apply не запускался. R2 create, config binding, STAGING deploy
и authenticated E2E в этом сеансе не выполнялись. Production не изменялся.
Текущий gate требует реальных Firebase identifiers и прав/ресурса R2;
после них продолжается уже согласованный staging-only preflight/deploy/E2E.
D4–D7 остаются неутверждёнными.


## 2026-11-11–12 — Аудит всего проекта по Ponytail с немедленным исправлением

Запрос владельца: проверить весь проект по Ponytail, сразу исправить замечания
и зафиксировать каждое в журнале. Применены entry-ponytail, ponytail и ponytail-audit;
правило skill «report only» переопределено явным поручением владельца исправлять.
Полный перечень, пути и метод проверки: [PONYTAIL_AUDIT_2026-11-12.md](PONYTAIL_AUDIT_2026-11-12.md).

Baseline: Driver `7a8fe6c8faa33b458a79569a80faaacdb4847503`, backend
`868e940cb4ac7e6ad96c28c42c7aecc695620f1a`. Обе feature ветки сверены с GitHub.
Удалены недостижимая старая модерация, её SQL fake, unused HTTP helper, массовое
уведомление, шаблонный экран/тест и сломанный ручной JVM runner. Canonical digest
переведён на Object.fromEntries; native notification tag/Intent.data заменяют hash ID.

Дополнительный review подтвердил и исправил: digest collision для __proto__,
несовпадение FCM контрактов, неатомарные IV/ciphertext и stale session rotation/clear,
повтор запроса под другим водителем после смены login, moderation replay после
смены revision/status, несовпадение audit/review target type, зеркальные EXIF
ориентации, необработанное отсутствие camera Activity и устаревшие source guards.
Каждое замечание раскрыто в отчёте. Итог code/tests/CI: -937 строк, 0 новых deps.

Проверено локально: 61 backend suite PASS, 17 migrations PASS, 12 staging preflight
PASS, npm audit 0 vulnerabilities, 14 mutationReplay SQLite tests PASS,
moderation policy PASS, 6 Android security configuration checks PASS,
git diff --check PASS. Android regression tests добавлены в API 35 emulator CI.
Итоговая debug/release/AndroidTest сборка, runtime Keystore/EXIF и backend CI
проверяются после публикации; они не объявляются выполненными этой записью.
Попытки локального workerd/dry-run были прерваны; свежий PASS для них ожидается в CI.

R2 bucket/permissions и Firebase identifiers по-прежнему требуют владельца.
Authenticated D3 E2E не выполнен; CI Firebase fixture — только compile fixture.
Production, deploy, migrations apply, merge и неутверждённые D4–D7 не изменялись.


### 2026-11-12 — Ponytail: результаты backend CI и замечание к runtime действий

Backend code `59f2dfd7f730ec0014f2661b13d3a573d304445a`, run
https://github.com/lobanov0710-blip/uber-v3/actions/runs/43224042256 — PASS:
61 suite, 17 migrations, 12 preflight checks, npm audit 0 vulnerabilities,
local workerd/D1 atomic audit PASS и Worker bundle dry-run PASS.
CI также сообщил Node.js 20 deprecation для checkout/setup-node v4.
Оба действия обновлены до проверенных SHA с native Node24 runtime;
Node для приложения остаётся 22, npm — 11.9.0, lifecycle scripts отключены.
Автоматический package-manager cache явно отключён. Повторный CI ожидается.
Android `3273bfc25316e790f26286ba5477c7037f710014`: build/JVM/endpoint/App Check
steps PASS; runtime emulator tests на момент этой записи ещё выполняются.


### 2026-11-12 — Ponytail: итог всех доступных проверок

Android code head `3273bfc25316e790f26286ba5477c7037f710014`:
https://github.com/lobanov0710-blip/TransferDriver/actions/runs/43224019792
— SUCCESS. JVM tests; debug/release/AndroidTest APK; 6 source security checks;
STAGING/production endpoint locks; Play Integrity policy; API 35
connectedDebugAndroidTest (в APK включены regression tests Keystore,
stale rotation/logout/new login/account switch и 8 EXIF orientations) — PASS.

Backend code/CI head `ea1109107b479e33b914aec047aeaa8f3daae76f`:
https://github.com/lobanov0710-blip/uber-v3/actions/runs/43224400939
— SUCCESS. npm ci без lifecycle scripts, audit 0 vulnerabilities, 17 migrations,
12 preflight tests, 61 suites, local workerd/D1 и Worker dry-run — PASS.
Лог workerd: first=success, loser=existing_idempotency, stale=conflict,
auditRows=1, result=PASS. Node20 warning после обновления actions отсутствует.
Первый backend run 43224042256 также PASS; обновление действий не меняет backend.

Оба отчёта синхронизированы. Итог code/tests/CI относительно baseline:
-936 строк (-8 Android, -928 backend), 0 новых dependencies; документация
в подсчёт не включена. git diff --check — PASS. Все подтверждённые замечания
этого аудита исправлены. Исторические записи до финального CI остаются в журнале.

Эта финальная публикация меняет только отчёт/журнал; результаты выше относятся
к указанным code heads. Не выполнен и не объявляется PASS реальный Firebase/R2
E2E: требуется участие владельца с Firebase identifiers и R2 permissions/bucket.
Production, STAGING deployment, migration apply, merge и D4–D7 не изменялись.


## 2026-11-12 — Ponytail: второй проход по всему коду

Явное поручение владельца: повторно проверить весь код, исправить найденные баги.
Baseline GitHub: Driver 7b5cb03312bf5822eeef0d444e39fdac8f9db2fe,
backend 50d14fc1cb2a03f8acd89421b449f6ef69c319a8. Перед работой подтверждено
точное совпадение локальных git tree с опубликованными. Оригинальные checkout
и чужие ветки не изменялись. Применены Ponytail entry/audit/full; исправления
разрешены прямым поручением пользователя, включая bugs/security review.

Исправлены: JWT parse exceptions с фрагментами входа в logs; Telegram network
errors с bot URL, upstream description/statusText и chat ID в logs/исключениях;
raw Error.name в двух Mapbox transport catch; безусловная очистка сессии из шести
Android экранов после stale authenticationRequired. Авторитетная условная очистка
в auth/session слое сохранена. Удалены повторяющиеся UI clear wrappers.

Red → green: новые privacy tests и Android source guard воспроизвели дефекты
до исправления. Добавлен HTTP interceptor runtime regression для смены A → B
перед ответом 401. CI теперь проверяет реальные JUnit XML, ненулевые counts,
отсутствие failures/errors/skips и запуск этой новой проверки.

Локально PASS: 61 npm suite; 6 privacy checks; 17 migrations; 12 preflight tests;
127 JS/MJS syntax checks; 25 Android XML; 7 Android security guards; diff --check.
Итоговая Android debug/release/AndroidTest сборка, JVM, API 35 instrumentation,
backend clean-install/audit/local workerd/dry-run ещё ожидаются в CI; эта запись
не объявляет их PASS. Детали: [PONYTAIL_AUDIT_2026-11-12_FOLLOWUP.md](PONYTAIL_AUDIT_2026-11-12_FOLLOWUP.md).
Production source -78 строк, tests/guards/CI +115; общий diff +37, dependencies +0.

Firebase/R2 owner blockers сохраняются: реальный E2E не запускался, credential
bypass не применялся. Production/deploy/merge/remote migrations/D4–D7 не менялись.


### 2026-11-12 — Второй Ponytail audit: итоговые CI результаты

Android code `9fde9e363f42dc21fb58824bfed0237535a6b5a8`:
https://github.com/lobanov0710-blip/TransferDriver/actions/runs/43229116512
— SUCCESS. Debug/release/AndroidTest APK, 7 source/config security checks,
endpoint variant locks и Play Integrity provider policy — PASS.
Фактические JUnit XML подтверждены CI: JVM_TESTS=PASS count=29,
ANDROID_TESTS=PASS count=10 (API 35), failures/errors/skips отсутствуют.
Новый delayedHttpUnauthorizedPreservesTheSubsequentLogin найден в реальных
runtime testcases; его отсутствие теперь проваливает CI.

Backend code `fe8bcb60f0ca0af9138ea1ceedc9fc3cac3f8580`:
https://github.com/lobanov0710-blip/uber-v3/actions/runs/43229194856
— SUCCESS. npm ci без lifecycle scripts, npm audit 0 vulnerabilities,
61 test suite (включая 6 privacy regressions), 17 migrations, 12 staging
preflight tests, local workerd/D1 atomic audit и Worker dry-run — PASS.
Workerd: first=success, loser=existing_idempotency, stale=conflict, auditRows=1.

Изменения опубликованы в существующих arch/spec-v1-* ветках, PR #6 и #28
остаются open/draft. Все подтверждённые замечания текущего прохода исправлены;
данные о возможном фактическом раскрытии production credentials не получены,
аудит подтверждает устранение дефектов кода, не историческое отсутствие утечек.
Финальная запись меняет только документацию; проверены указанные code SHA.
Реальный Firebase/Phone Auth/App Check/R2 E2E всё ещё BLOCKED внешней настройкой;
production, deployment, merge и remote migration apply не выполнялись.


## 2026-11-12 — Владелец предоставил Firebase project/app identifiers

Источник — сообщение владельца в текущем сеансе:
- Project name / App nickname: Transfer Driver;
- Project ID / FIREBASE_PROJECT_ID: transfer-driver-1590d;
- Project number / FIREBASE_PROJECT_NUMBER: 502279442547;
- Android App ID / FIREBASE_DRIVER_APP_ID: 1:502279442547:android:0cfc722af33b476bc41a06;
- package: ru.transferservis.driver.

Локально подтверждены корректный формат, одинаковый project number в App ID
и совпадение package с Android applicationId. Это данные владельца; независимая
проверка Firebase API и настоящий SDK config ещё ожидаются. API key не придумывался,
CI compile fixture не выдавался за рабочую конфигурацию.

Применён Firebase Basics. Node 24.22.1 и официальная Firebase CLI 15.36.0 проверены.
CLI login:list: No authorized accounts. Firebase MCP tools не обнаружены.
Владелец выбрал вариант 1: получить SDK config на своём компьютере. Подготовлены
точные официальные CLI login/apps:sdkconfig команды с указанными project/app ID.
Пароли, OAuth-коды и service-account private keys не запрашивались.
Обновлено руководство backend docs/D3_STAGING_OWNER_SETUP.md и preflight checkpoint.
Добавлены ignore-правила для Firebase local/debug artifacts и SDK config.

Существующий проект/приложение не создавались повторно; удалённые настройки
Firebase/Cloudflare не изменялись. R2 rights/bucket ещё не готовы по последнему
подтверждению. Phone Auth/App Check, настоящая SDK-сборка и authenticated E2E
пока не объявляются PASS. Сохранены production/D4–D7 ограничения.

Проверки checkpoint: identifiers приняты существующим fail-closed preflight
в локальном candidate config (только совместимость формата; существование R2
или привязка Firebase API этим не подтверждаются); 12 preflight regression tests
PASS; git check-ignore для SDK config/Firebase cache/debug logs PASS;
git diff --check PASS. Application source и реальные backend bindings не менялись.


## 2026-11-12 — Получен настоящий Firebase SDK config, первая локальная сборка

Владелец передал google-services.json файлом (696 bytes) после официальной CLI
загрузки на Windows. Несмотря на последующий libuv Assertion failed в Windows,
JSON корректен и совпадает с ранее подтверждёнными project ID/number/app ID/package:
transfer-driver-1590d / 502279442547 /
1:502279442547:android:0cfc722af33b476bc41a06 / ru.transferservis.driver.
Проверены схема, формат client API key и отсутствие service-account/private-key полей.
Файл размещён только в gitignored app/google-services.json с mode 0600. Содержимое
и API key не включаются в Git, journal или tool output.

Владелец подтвердил: Authentication Phone включён; App Check не настроен;
Google Play Console/внутренний тестовый канал пока не подтверждены. Выбраны ОБА
канала: Google Play и прямая установка APK. Release/upload-ключа нет; владелец
попросил безопасную инструкцию. Подготовлен Android docs/RELEASE_SIGNING_OWNER_SETUP.md:
ключ генерируется у владельца; пароли/private keystore в чат не запрашиваются.

В managed workspace установлен официальный Android SDK Platform 37.0 и Build Tools
37.0.0. Command-line tools ZIP проверен по checksum официального Google repository;
новый Android CLI использован с no-metrics. TLS/proxy trust сохранены.
Первый запуск Gradle wrapper без execute bit завершился exit 126; далее запуск
через bash без изменения mode/source. SDK/Firebase/App Check обходы не применялись.

Первый build с РЕАЛЬНЫМ SDK config PASS: testDebugUnitTest, assembleDebug,
assembleRelease, assembleDebugAndroidTest; отдельно bundleRelease/signingReport PASS.
Фактические JUnit XML: 29 JVM tests, failures/errors/skips 0; 7 security guards PASS.
Проверено совпадение Firebase resources в debug APK, release APK и release AAB
с полученным JSON, включая API key (значение не логируется). Debug APK signature
v2 PASS; merged manifest: package, allowBackup=false, usesCleartextTraffic=false,
networkSecurityConfig PASS. Release APK/AAB пока unsigned, не объявляются готовыми
для публикации. Runtime instrumentation с этой конфигурацией и authenticated E2E
ещё не выполнялись. Хеши первых артефактов — Android docs/REAL_FIREBASE_BUILD_2026-11-12.json.

При подготовке Play test channel выявлен отсутствующий вариант: debug использует
STAGING, но не подходит для Play release; обычный release использует PRODUCTION.
Добавляется native staging buildType на основе release: DEBUG=false,
STAGING endpoint, та же applicationId и Play Integrity provider; versionName suffix
-staging, без придумывания production ключа или смены существующих endpoint locks.
Проверки новой staging сборки и соответствующий CI ещё НЕ объявлены PASS.
Первый testStagingUnitTest: task отсутствовал; в текущем AGP по умолчанию создаётся
только debug JVM test component. Добавляется явное включение host tests для вариантов.

R2 permission/private bucket и remote STAGING readiness всё ещё требуют владельца.
Firebase/Cloudflare remote writes, deploy/merge/migration apply и D4–D7 не изменялись.


### 2026-11-12 — Изоляция сессий при смене подписанной сборки

Staging variant локально собран: testDebugUnitTest/testStagingUnitTest/
testReleaseUnitTest и assembleStaging/bundleStaging PASS. Изначально два теста
staging упали из-за предположения DEBUG=false → PRODUCTION. Исправлено ожидание
по BUILD_TYPE с отказом для неизвестных вариантов; DEBUG проверяется отдельно.

Проверка обновления между одинаково подписанными staging/production пакетами
выявила риск: старый AES-GCM blob не был привязан к адресу backend. AAD теперь
v2 + ApiEndpointPolicy.BASE_URL. При смене среды или чтении legacy v1 сессия
удаляется и требуется новый вход. Не добавлены зависимости, debug provider или
настраиваемые пользователем endpoints. Добавлены два Android runtime regression
tests: чужой backend AAD и legacy AAD при сохранённых preferences/Keystore;
положительный round-trip и очистка проверяются тем же тестом.
Повторная сборка всех артефактов после security fix и новый CI ещё выполняются;
результат runtime до завершения CI не объявляется PASS.


### 2026-11-12 — Финальная локальная сборка после security fix

Code/workflow опубликованы в Android feature branch commit
5cd807568b7b84b9e151867eb930cfbadad4c086; Draft PR остаётся без merge.
С реальным Firebase config после AAD fix прошли 87 JVM tests (29 debug + 29
staging + 29 release), failures/errors/skips 0. Повторно собраны debug/staging/
release APK, staging/release AAB и debug AndroidTest APK; Gradle PASS, 189 tasks.
7 source security guards и git diff --check PASS; staging/release lintVital PASS.
Полный дополнительный lintStaging не выполнен: запрос запуска отменён пользователем,
лог запуска не создан. Это не включается в перечень успешных проверок.

Проверены все три APK manifests: package, allowBackup=false,
usesCleartextTraffic=false, networkSecurityConfig; staging/release non-debug.
Firebase project ID/app ID/API key совпали с реальным config во всех APK/AAB;
значение API key не логировалось. Debug APK v2 signature PASS; staging/release
APK и AAB подтверждённо unsigned. Endpoint locks: debug/staging → STAGING,
release → PRODUCTION. Скомпилированный AndroidTest APK содержит обе новые regression
проверки. APK/AAB сохранены вне Git; SHA-256 и source file hashes — Android
REAL_FIREBASE_BUILD_2026-11-12.json. Встроенный AGP VCS metadata сообщает
NO_VALID_GIT_FOUND; точная ссылка на опубликованный source и хеши записаны отдельно.
Первоначальные артефакты сохранены отдельно как first-build; актуальные имеют
новые хеши после security fix. Инструкция подписи содержит хеш staging AAB.

GitHub Actions run 43314469461 запущен; runtime результат ещё ожидается.
Он использует synthetic config только для compile/runtime security tests;
локальные артефакты используют настоящий SDK config. Реальный Phone/App Check
E2E не выполнен. Owner signing/App Check/Play setup и private R2 остаются gate.


### 2026-11-12 — CI security regressions подтверждены

Android source commit 5cd807568b7b84b9e151867eb930cfbadad4c086:
https://github.com/lobanov0710-blip/TransferDriver/actions/runs/43314469461
job 131518735357, conclusion SUCCESS. Логи проверены: JVM_TESTS=PASS count=29,
STAGING_JVM_TESTS=PASS count=29, RELEASE_JVM_TESTS=PASS count=29,
ANDROID_TESTS=PASS count=12 (API 35); 7 source guards, endpoint locks,
Play Integrity provider policy и сборки всех вариантов PASS. CI report guard
подтверждает выполнение новых tests sessionFromAnotherBackendRequiresLogin и
legacySessionWithoutBackendBindingRequiresLogin, а также прежней HTTP 401/session
race regression. Пропусков/failures/errors в test XML нет. CI использует synthetic
Firebase config, authenticated E2E не подменяется этими результатами.

Итог: non-debug STAGING APK/AAB готовы к подписи владельцем; сессия привязана
к backend через AES-GCM AAD v2. Локальные APK/AAB собраны с настоящим Firebase
config и имеют отдельный receipt с хешами; debug APK предназначен для проверки UI,
staging/release unsigned не предназначены для установки/публикации до подписи.
Пользователю передаются артефакты и безопасная инструкция создания upload key
у себя. Private keystore/пароли не запрашиваются и не создавались в workspace.
Следующий gate: owner signing/Play App Signing + App Check для обоих каналов,
private R2 permissions/bucket, затем проверка STAGING deployment и реальный E2E.
Backend source неизменён; повтор 61 backend suites только из-за docs не требуется.
Финальная публикация этого checkpoint меняет только документацию/журналы;
production/deploy/merge/migrations и D4–D7 не изменялись.


## 2026-11-14 — Аудит ТЗ, плана и журналов проекта

Основание: владелец поручил проверить ТЗ, план и записи, провести аудит и записать
результат. Проверены утверждённые §1–40, решения D1–D7, исторические review/audit,
checkpoint обоих журналов, owner/signing/preflight документы и ключевые code paths.
Базы GitHub: Driver 0c7777025c7c58231efaedbb2b8d82c335807ce4;
backend 905c6ebe86907056f0d8be8f6f6edaff07b135e4. Локальные checkpoint tree SHA
совпали с опубликованными. PR #6/#28 открыты, Draft, merged=false.
ТЗ неизменно: blob 7434dc0b1548b4f2c5382f12d6cc5399f93d0a84 совпал, 40 разделов.

Результат: частичная реализация; не готово к полному production-выпуску.
A1 (high): нет отдельного Admin и ряда Driver UI, GPS/passenger chat/VoIP/ranking.
A2 (high): реальный Firebase/App Check/R2 E2E и подпись не подтверждены; D4 provider
отсутствует, guard движения без verified сохранён. Owner сведения о ключе/App Check/
Play/R2 — последние подтверждения 2026-11-12, а не новая remote проверка сегодня.
A3 (high): openRoute в OrderDetailsActivity строит pickup→destination независимо
от фазы; не соответствует ТЗ §22. Открыто как функциональная задача G3.
A4 (medium): рабочий обзор/план и вход в историю устарели. Исправлено документально:
создан текущий PROJECT_PLAN_V1_0.md с матрицей всех 40 разделов и этапами G0–G5;
добавлены индекс/исторические указатели, прежние события не переписаны.
A5 (medium): Android OSV inventory 129 debug components не включает добавленные
Auth/App Check; полный lint не подтверждён. Новой CVE не установлено; это пробел
release coverage, который нельзя закрывать npm audit или source guards.
A6 (low): embedded AGP provenance NO_VALID_GIT_FOUND; внешние receipt/source/artifact
hashes есть и совпали. Улучшение release provenance включено в G5.

Новые локальные результаты: 61 backend suite PASS (все test chain commands),
17 migration smoke PASS, 12 preflight tests PASS; 7 Android source/config guards,
25 XML parse, проверка 5 receipt source hashes и 6 artifact SHA-256 PASS.
Проверены существующие CI базовых head commits: Android run 43316231722 /
job 131524852748 SUCCESS, JVM 29+29+29 и API 35 runtime 12, build/endpoint/provider
checks PASS; backend run 43316251413 / job 131524919923 SUCCESS, npm audit 0,
17 migrations, 12 preflight, suites/workerd/dry-run PASS. Логи/step results сверены;
это ранее выполненные CI, не новые прогоны от 2026-11-14.

Создан AUDIT_SPEC_PLAN_JOURNAL_2026-11-14.md с доказательствами и ограничениями.
SDK config/идентификаторы и локальные сборки больше не являются открытым блокером.
Следующий gate: owner signing/Play/App Check/private R2 → D3 STAGING E2E;
далее недостающие Driver/Admin сценарии и отдельные D4–D7 перед соответствующими
функциями. Реальные документы/биометрия/VoIP не собирались; verified не имитировался.

Изменения этого аудита — только документация. Новый APK build/full lint/Android
advisory scan/live Firebase/R2 checks/authenticated E2E/pentest не запускались.
Секреты, конфиги и бинарные артефакты в Git не добавляются. ТЗ, product code,
remote migrations, deploy, merge и production не меняются. D4–D7 не утверждены.

Документальные проверки завершены PASS: матрица содержит каждый §1–40 ровно один
раз, локальные Markdown-ссылки разрешаются, исходный ТЗ не изменён, кандидаты Git
содержат только Markdown и не содержат Firebase API key; git diff --check PASS.
PR mergeability на базовом snapshot clean: Android master
501481c20168c496e11ea21b7a7e82d047523788; backend main
7fad96a63ac963e6c28bf03f21d52b90e5cb69ff. Это не разрешение на merge.


## 2026-11-14 — Главное обязательное правило владельца

Владелец прямо установил:

> Действуй согласно утверждённого правила, ТЗ и записям журнала проекта. Любое отклонение запрещено! Додумывать за меня не нужно. Можешь только предложить варианты.

Требование принято без изменения смысла. Зафиксировано в корневом AGENTS.md
обоих рабочих репозиториев и в начале обоих журналов, чтобы последующие работы
начинались со сверки этого правила, ТЗ и утверждённых решений. Сводный план и
выводы аудита не являются разрешением на отступление или новым утверждением.
При неоднозначности/противоречии/недостающем решении зависящие действия
приостанавливаются, владельцу предлагаются варианты; выбор остаётся за ним.

Это документационная фиксация прямого требования владельца. Содержимое ТЗ,
application code и статусы утверждения D1–D7 не меняются. Merge, deploy,
remote migrations и изменения инфраструктуры не выполняются.
Отдельный инструмент постоянной памяти ChatGPT в текущем наборе инструментов
не доступен; постоянная проектная запись обеспечена файлами репозиториев.


## 2026-11-14 — G1 приостановлен владельцем; начало G2 / Transfer Admin

Прямое решение владельца: «G1 пока приостановим. Начни с G2».
G1 и его live probe не продолжаются. Предыдущий запрос запуска read-only probe
отменён пользователем; файл результата отсутствует, новый HTTP статус не утверждается.
Разрешено начало G2 в рамках D1–D3: отдельный Admin Java + XML, package
ru.transferservis.admin, раздельные app data/Keystore/session/signing.

Выявлено, что D1 относит MFA OWNER к первому этапу Admin, но backend метода ещё
не имеет. На вопрос «какой вариант подготовить для отдельного технического
утверждения» владелец выбрал вариант 1 — TOTP + backup codes. Это выбор направления
подготовки предложения, не утверждение ещё не представленных API/параметров.
Готовится ADMIN_MFA_TOTP_PROPOSAL.md. До утверждения/реализации MFA рабочие разделы
OWNER в новом клиенте не открываются. Независимая часть: отдельная сборка,
защищённая staff-сессия, авторитетный /v1/admin/me и read-only очередь регистрации
для dispatcher с drivers.read; новые backend контракты не придумываются.
D4–D7, production, merge/deploy/migration apply не разрешены и не меняются.


### 2026-11-14 — G2: первый функциональный срез Admin подготовлен

Добавлен native :admin Java + XML / ru.transferservis.admin. Отдельные app data,
prefs admin_secure_session_v1, Keystore alias transfer_admin_session_key_v1 и debug
signing identity (.local-signing/admin-debug.keystore, gitignored). Release/upload
keys не создаются. Firebase Driver конфиг и зависимости не используются Admin.

Текущий контракт без изменений backend: POST /staff/login, /staff/refresh,
/staff/logout; GET /v1/admin/me и /v1/admin/registrations?limit=50. Legacy auth role
admin не превращается в OWNER. Profile accountId должен совпадать с staff session;
operational role/permissions загружаются с backend и не сохраняются как grants.
OWNER видит собственный profile, но operational UI/queue закрыт до MFA. Dispatcher
получает только read-only очередь при актуальном drivers.read; backend повторно
проверяет права. Модерация, документы, назначения и остальные разделы ещё впереди.

Сессия AES-256-GCM/AAD с Admin package и backend origin; отдельный ключ, backup/
transfer запрещены, system CA only, redirects/retry запрещены, response body bounded
1 MiB. FLAG_SECURE, login/password/PII не сохраняются в View state; application logs
и внешняя телеметрия не добавлены. Logout очищает storage/ключ; stale refresh и
поздний 401 не переходят в новую учётную запись. Не подходящая legacy роль не
сохраняется; выданная отклонённая сессия отзывается best-effort.

Локальные Admin JVM tests: 17 debug + 17 staging + 17 release PASS. Полный lint
всех трёх вариантов — 0 issues. MissingApplicationIcon устранён platform icon;
для durable logout синхронный commit сохранён, точечная ApplySharedPref performance
подсказка помечена с причиной, не отключением security check. Тема — существующая
Material3 base Driver, без утверждения нового фирменного дизайна. Source guards:
5 Admin + прежние 7 Driver PASS. Debug/staging/release APK/AAB собираются, AndroidTest
APK с 13 новыми проверками подготовлен; финальные runtime/CI результаты ещё ожидаются.
В CI добавлены проверки разных packages/debug certificates и runtime UID isolation,
positive dispatcher queue/refresh/logout, revoke/role/MFA-gate/session races.

ADMIN_MFA_TOTP_PROPOSAL.md содержит конкретные RFC 6238 параметры, bootstrap/
recovery, challenge/API и server evidence policy. Статус НЕ УТВЕРЖДЕНО: выбор
TOTP для подготовки не означает согласие со всеми деталями. Backend MFA не внедрена,
его прежние OWNER endpoints этим клиентским ограничением не защищены — это остаётся
серверной задачей после отдельного решения владельца. G1 остаётся приостановлен.


### 2026-11-14 — Выделена ветка Admin и подтверждён первый срез G2

Владелец спросил о создании отдельной GitHub ветки для Admin; ветка создана:
https://github.com/lobanov0710-blip/TransferDriver/tree/arch/g2-transfer-admin
Начальная точка c33baab21acb6f57700a14bcda4d0fffff8de5c9 — уже опубликованный
текущий код Admin после исправления parser apksigner. История общей ветки не
переписана, первые Admin commits c9b144f3/c33baab2 в ней сохранены. Дальнейшая
работа Admin ведётся в arch/g2-transfer-admin; общая ветка получает только запись
журнала со ссылкой. Локальная работа переключена на новую ветку без потери изменений.

Проверенный CI того же точного source SHA (перед выделением ветки):
https://github.com/lobanov0710-blip/TransferDriver/actions/runs/43587414797
job 132424791093, SUCCESS. Логи JUnit/guards сверены:
Admin JVM 17 debug + 17 staging + 17 release = 51 PASS; API 35 runtime 13 PASS;
Driver JVM 29+29+29 = 87 PASS, runtime 12 PASS. Failures/errors/skips отсутствуют.
5 Admin + 7 Driver source guards PASS. Full Admin lint debug/staging/release —
0 issues. Проверены разные packages и debug certificates; runtime подтвердил разные
UID, encrypted round-trip/logout, foreign AAD, driver prefs isolation, OWNER UI gate,
positive dispatcher queue/refresh/logout, permission revoke и stale refresh/401.
Backend docs-only checkpoint 2128ce18 / run 43587101473 SUCCESS; backend source
и auth/MFA API не изменялись. Локальная финальная Admin сборка: PASS, 194 tasks.

Локальные debug/staging/release APK, staging/release AAB и AndroidTest APK проверены:
Admin package, no shared UID, backup/cleartext disabled, network config, debug flag;
в Admin APK нет Driver/Firebase classes. Debug v2 signature verified; Admin debug
SHA-256 ea4f14836b45719946857ce90a3fd8399a088b6ecca76f0a82db26cfa9c71a8b
отличается от Driver. Staging/release APK/AAB unsigned. Хеши и внешняя source
provenance — docs/ADMIN_BUILD_2026-11-14.json; бинарные артефакты вне Git.

Незавершённые проверки не объявляются PASS: дополнительный runtime dependency
inventory command отменён пользователем при вопросе о ветке; лог не создан,
свежего OSV/advisory scan нет. Реальный backend E2E не выполнялся. G1 остаётся
приостановлен; Cloudflare/Firebase/remote migration apply/deploy/merge не выполнялись.
TOTP выбран для подготовки предложения, но ADMIN_MFA_TOTP_PROPOSAL.md ещё требует
явного утверждения параметров/API; server MFA не реализована. Client OWNER gate
не подменяет server enforcement. G2 завершён только в описанном первом срезе;
остальные Admin/Driver функции плана не объявляются готовыми.
