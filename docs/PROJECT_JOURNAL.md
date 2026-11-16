# Журнал backend-аудита — 2026-11-07

> **Главное правило владельца, 2026-11-14:** действовать строго по утверждённым правилам, ТЗ и журналу.
> Любые самовольные отклонения и решения за владельца запрещены. При неопределённости —
> только варианты для владельца; зависящие действия ждут его явного решения. [Правило для работы](../AGENTS.md).

> **Текущая работа:** по решению владельца G1 приостановлен; начат G2 / отдельный Transfer Admin.
> Параметры/API TOTP MFA OWNER утверждены; реализация в arch/g2-owner-totp-mfa и Android arch/g2-transfer-admin. Локальные проверки и source CI/runtime PASS; live E2E не выполнялся.
> **Актуальный индекс: 2026-11-15.** [План и матрица ТЗ](https://github.com/lobanov0710-blip/TransferDriver/blob/arch/g2-transfer-admin/docs/PROJECT_PLAN_V1_0.md) · [Базовый аудит 2026-11-14](https://github.com/lobanov0710-blip/TransferDriver/blob/arch/spec-v1-security-baseline/docs/AUDIT_SPEC_PLAN_JOURNAL_2026-11-14.md)
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

> **Последний завершённый срез:** Admin registration moderation; source CI d469b42c / 51d21da7 PASS.

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


## 2026-11-14 — Параметры и API TOTP OWNER утверждены; начата реализация

Прямое решение владельца: «Предложение параметров и API TOTP утверждаю».
Утверждён ADMIN_MFA_TOTP_PROPOSAL.md: RFC 6238 SHA-1/6 digits/30s ±1, 20-byte seed,
AES-256-GCM server encryption, одноразовые counters/challenges/recovery, TTL/limits,
protected control-plane bootstrap/reset, evidence для OWNER sessions и legacy paths.
Это отдельное подтверждение MFA к D1; D4–D7 не утверждаются этим решением.
G1 остаётся приостановлен. Merge/deploy/remote migration apply не разрешены.

Backend MFA разрабатывается в новой arch/g2-owner-totp-mfa от
731e313c9e5caa116c8a092729f6fef79e119407. Android остаётся в arch/g2-transfer-admin.
План: добавить local-only миграцию/crypto/transactions/enforcement и отрицательные
SQL/workerd tests, затем подключить Admin login/enrollment/recovery без сохранения
seed/кодов в Android persisted state. Реальный OWNER key/seed/credentials не создаются
и не запрашиваются в чате. Новые проверки пока не объявляются PASS.


### 2026-11-14 — G2: реализация утверждённого OWNER MFA и локальные проверки

Добавлены серверные password challenge без session, enrollment через защищённый
local control plane, TOTP/recovery login, централизованное evidence enforcement
для всех OWNER staff paths, включая legacy, и сохранение предела MFA при refresh.
Новая additive migration 0018 применяется только к локальным тестовым DB.
Одноразовый proof/challenge, session, evidence и audit фиксируются атомарно;
сбой audit откатывает выдачу. Bootstrap/reset не имеют public HTTP endpoint.

Admin подключён к утверждённым API: challenge/enrollment/recovery находятся только
в volatile state; seed/коды не сохраняются в Bundle/preferences/clipboard/logs,
очищаются при уходе в фон. OWNER доступен только после typed server MFA profile.
Отмена/поздний ответ не восстанавливает старую session; dispatcher auth сохранена.

В проверках исправлены: привязка количества numbered SQL bindings к native D1;
неподходящий запуск unbundled Worker в harness; фиксированные rate buckets заменены
скользящими интервалами с проверкой календарной границы. Старые router mocks явно
содержат действующее server evidence; отсутствие/просрочка отдельно отклоняются
на настоящих SQLite и public HTTP тестах. Защита не отключалась.

Локально PASS: 65 backend test scripts, включая 18 новых MFA scenarios;
local workerd HTTP/D1 (enrollment/login/profile, concurrent TOTP/recovery — один
победитель, refresh expiry/reset); Worker dry-run без deployment.
Admin: 23 JVM test на каждом debug/staging/release = 69 PASS, failures/errors/skips 0;
194 Gradle tasks, debug/staging/release APK, staging/release AAB и AndroidTest APK
собраны; полный lint трёх variants — 0 issues. Новые 20 Admin runtime tests пока
только скомпилированы: их выполнение и полный source CI ещё ожидаются.

Диагностика среды: CLI child process и local workerd первоначально получили sandbox
EPERM при loopback; повторены через штатное дополнительное разрешение сети.
Первый dry-run не смог создать Wrangler config вне workspace; XDG_CONFIG_HOME
перенесён в доступный workspace, повторный dry-run PASS. Никаких remote действий.
G1 приостановлен, реального OWNER encryption key/seed/credentials нет; live E2E,
production deployment, merge и remote migration apply не выполнялись.


## 2026-11-15 — G2 OWNER MFA: итог CI и аудит зависимостей

Прямое утверждение владельца параметров/API TOTP от 2026-11-14 выполнено в
отдельных ветках arch/g2-transfer-admin и arch/g2-owner-totp-mfa.
Общие arch/spec-v1-* ветки получают только эту запись журнала; код MFA в них
не переносится. D4–D7 по-прежнему не утверждены, G1 остаётся приостановлен.

Проверены job logs точных source SHA:
- Android c6badd3a13bdad89140e43df09b181bfd85ec069:
  https://github.com/lobanov0710-blip/TransferDriver/actions/runs/43608123183
  job 132487059220 — SUCCESS. Admin JVM 23 debug + 23 staging + 23 release = 69;
  API 35 runtime 20. Driver JVM 29+29+29 = 87, runtime 12.
  Executed reports без failures/errors/skips. Проверены volatile seed/recovery
  в настоящей Activity, отмена/поздние ответы, authoritative server evidence,
  разные package/UID/debug certificates, endpoint locks и session isolation.
  5 Admin + 7 Driver guards PASS; полный Admin lint трёх variants — 0 issues.
- Backend 1598dff3e17799947c4eedc79f3c22ae68a8a256:
  https://github.com/lobanov0710-blip/uber-v3/actions/runs/43608125351
  job 132487065843 — SUCCESS. Выполнены 65 test scripts, включая 18 новых
  MFA scenarios; 18 local migrations, 12 preflight — PASS.
  Lockfile install и npm audit: 0 vulnerabilities.
  Оба native workerd/D1 harness и Worker dry-run PASS без deployment.
  Проверены HTTP enrollment/login/profile, один победитель concurrent TOTP/recovery,
  replay, expiry, reset, rollback при audit failure и sliding failure limits.

После прерывания прежнего дополнительного OSV-запроса его результат не
объявлялся PASS. Повторный запрос выполнен 2026-11-15: фактически разрешены
6 runtime configurations app/admin debug/staging/release, 152 уникальных Maven
components; 0 опубликованных OSV advisories на момент проверки. Это не pentest
и не полный аудит build plugins. Новых dependencies для MFA нет.

Локально подготовлены и проверены 6 новых Admin artifacts:
debug/staging/release APK, staging/release AAB и AndroidTest APK.
Проверены manifests, no shared UID, backup/cleartext disabled, отсутствие
Driver/Firebase classes, разные debug signatures, unsigned staging/release,
variant endpoint locks и SHA-256. Новый набор хранится отдельно:
 /workspace/artifacts/transfer-admin-mfa-2026-11-14/
Старый первый набор не перезаписан. Debug APK: 9018498 bytes,
SHA-256 01a6198216124b122271685cc2a7f084249d6c96989089ca6b152033962529d7.

Дополнительный artifact verifier первоначально ошибочно требовал отсутствия
PRODUCTION строки в debug DEX: debug содержит обе публичные константы origin
policy. Проверка уточнена по фактическому BuildConfig/endpoint policy;
minified staging/release содержат только свой endpoint. Это диагностический
false positive; продуктовый код из-за него не менялся.

Созданы Draft PR для отдельного просмотра изменений:
- Admin https://github.com/lobanov0710-blip/TransferDriver/pull/7
- Backend https://github.com/lobanov0710-blip/uber-v3/pull/29
Слияния нет. Расхождение только журнала в Admin PR согласовано сохранением всей
истории в общей и Admin ветках; исходный код не меняется, история Git не переписана.

Во время финализации execution environment стала unavailable. Статус Cloud
environment сообщает running/connected, но exec_command по-прежнему возвращает
"No usable execution environment is available". Изменения среды/прав не делались.
Все source/test commits и CI logs уже находятся в GitHub.
Публикация полного локального build receipt, component inventory и локальная
Git checkpoint-сверка отложены до восстановления execution environment;
они не объявляются завершёнными. Сводный проверяемый отчёт опубликован отдельно:
docs/OWNER_MFA_VERIFICATION_2026-11-15.json в ветке Admin. Дальнейшие локальные
сборки требуют доступной execution environment; проверки не отключаются.

ТЗ не изменено: blob 7434dc0b1548b4f2c5382f12d6cc5399f93d0a84.
Перед потерей execution environment проверено совпадение всех изменённых
функциональных файлов с протестированными GitHub source SHA; последующие
изменения касаются только документов. Реальные OWNER key/seed/credentials
не создавались и не публиковались. Миграция 0018 применена только к эфемерным
локальным test DB. Remote migration apply, deployment, merge и live E2E
не выполнялись. Полный G2 и production-выпуск не объявляются готовыми.



## 2026-11-15 — Среда выполнения восстановлена; отложенные отчёты доступны

После повторного подключения exec_command снова работает. Тот же cloud environment
имеет running/connected; workspace /workspace доступен для чтения/записи.
Проверены Node 24.22.1, Python 3.12.14, сохранённый JDK 25.0.3. Gradle 9.6.0
успешно запускается с ранее установленными project env paths; SDK platform
android-37.0 и Build Tools 37.0.0 присутствуют. Первый запуск без GRADLE_USER_HOME
попытался создать wrapper lock в недоступном /home/agent/.gradle; повтор с
/workspace/.gradle-transferdriver PASS. Первоначальная диагностическая проверка
ожидала android-37; фактический установленный SDK называется android-37.0.
Это уточнения команд проверки среды, продуктовый код не менялся. Оба audit checkout,
SDK/cache и старые логи/артефакты сохранились; права, secrets и конфигурация среды
не менялись. Повторная проверка SHA-256/размеров всех 6 новых Admin artifacts и
35 исходных файлов из build receipt — PASS. Старый набор артефактов сохранён.

Восстановлены подготовленные до потери среды полные документы Android ветки:
- docs/ADMIN_MFA_BUILD_2026-11-14.json — все 6 файлов, размеры, SHA-256, source
  provenance, debug certificates и результаты CI; копия receipt рядом с бинарными файлами.
- docs/ADMIN_DRIVER_RUNTIME_AUDIT_2026-11-15.json — полный разрешённый inventory
  6 app/admin runtime configurations, 152 уникальных Maven components, OSV 0 advisories
  на дату исходного запроса. Новый OSV-запрос при восстановлении не выполнялся.
- docs/OWNER_MFA_VERIFICATION_2026-11-15.json и план обновлены: блокер execution
  environment снят; опубликованы ссылки на полный receipt и inventory.

Сверена актуальная GitHub документация после прошлого docs-only checkpoint;
её история сохранена. Непубликованные локальные варианты документов перед сверкой
сохранены в /workspace/scratch/pre-recovery-docs-2026-11-15/. Функциональный код
после успешных source CI c6badd3a / 1598dff3 не изменялся; повторные полные тесты
только из-за восстановления среды не запускались. Эта запись не является новым E2E.
G1 остаётся приостановлен. Merge, deploy, remote migration apply и создание
реальных OWNER keys/credentials не выполнялись. Локальная фиксация исходников
и сверка дерева выполняются отдельно от изменения удалённых рабочих веток.


## 2026-11-15 — Утверждена рекомендация продолжить G2; начало Admin moderation

Владелец: «Продолжаем согласно рекомендации». Принята предложенная очередность:
Admin moderation → Driver registration/vehicles → availability/manual assignment,
с проверками и фиксацией результатов каждого законченного сценария. Текущий срез —
Admin карточка регистрации, поэлементные решения, возврат с причиной и история.
G1 не возобновляется, D4–D7 этим не утверждаются. Только синтетические fixtures.

Проверены ТЗ §§28–35, D1–D3 и существующие review/resource APIs. История уже входит
в review bundle; новые history endpoints/таблицы не требуются. Найдены пробелы:
queue filter исключает approved/rejected из пяти требуемых очередей;
private document read не требует отдельного documents.read_sensitive. Исправления
входят в текущий срез вместе с отрицательными тестами. Ручное identity verified
по-прежнему запрещено; просмотр/одобрение не заменяет D4 provider result.
Изменения разрабатываются в текущих отдельных G2 ветках; merge/deploy/remote
migration не выполняются. Результаты новых тестов пока не объявляются PASS.


### 2026-11-15 — Admin moderation: код и локальные проверки подготовлены

UI: пять фильтров (submitted/under_review/changes_required/approved/rejected),
карточка и история, начало проверки, отдельные решения по документам/фото/авто,
итоговое решение. Подтверждение документа/фото требует предварительного preview;
identity verified вручную недоступно, итоговое одобрение зависит от backend readiness.
Preview — только bounded JPEG/PNG/WebP в памяти, без URL/export/cache/внешнего viewer.
Карточка/причина/image/pending action исключены из saved state и очищаются в фоне.
Каждый вызов читает свежие permissions; response/session binding предотвращает
переход позднего запроса на другую учётную запись. POST не повторяется через refresh;
явный повтор при неизвестном результате сохраняет исходные actor/body/revision/key.

Backend: approved/rejected разрешены как явные queue filters; default active queue
не изменена. Для sensitive document read требуется отдельное documents.read_sensitive
вместе с соответствующим verify_documents/verify_identity. Три review mutation JSON
ограничены 4096 bytes; для возврата/отклонения причина обязательна и на сервере.
Новых routes, migrations, dependencies и identity provider нет.

PASS: Admin JVM 31 debug + 31 staging + 31 release = 93, failures/errors/skips 0;
full lint всех трёх variants — 0 issues. Backend 66 test scripts — PASS, включая
3 новых HTTP/SQLite scenarios. Native local workerd HTTP/D1 сценарий — PASS:
partial return сохраняет verified элементы, replay не дублирует audit, отзыв прав
блокирует повтор, ручное identity approval запрещено. Аудит failure rollback
и oversized/missing reason также проверены через настоящий router/SQLite.
Новые Android runtime tests скомпилированы; их выполнение ожидается в source CI.
Финальная APK/AAB сборка ещё выполняется, артефакты пока не объявлены готовыми.

В ходе проверок исправлены устаревшее ожидание теста (approved ранее был запрещён)
и единственный lint UnusedResources без подавления проверок. Сообщение
ADMIN ITEM MODERATION ERROR ожидаемо в negative test с намеренным audit failure;
оно не содержит DB exception/PII. Security guards 5 Admin + 7 Driver PASS.
G1 приостановлен; remote DB/R2, реальные документы/credentials, merge/deploy не трогались.
Ограничения: очередь показывает до 50 записей запроса, history до 200; остальные
Admin разделы, Driver исправления и живой E2E остаются дальнейшими этапами G2/G1.


### 2026-11-15 — Android runtime CI выявил сбой; расширена диагностика

Android source 894fe1c5 / CI 43702428479: JVM/build/guards/signatures PASS,
connected Admin runtime FAILED; runtime PASS не заявляется. Failure-report step
ранее печатал только app/Driver XML, поэтому подробности Admin отсутствуют.
Добавлен вывод обоих отчётов в существующий failure step. Это изменение диагностики,
не отключение/пропуск тестов. Новый CI нужен для точной причины и исправления.


### 2026-11-15 — Причина Android runtime failure установлена

Diagnostic source dd4911bb / CI 43703195348 вывел Admin XML: 27 tests,
26 PASS, один failure в новом moderation UI test. Espresso RootViewPicker
выбрал BASE_APPLICATION root без window focus при открытом AlertDialog
(ModerationUiInstrumentationTest.java:60, RootViewWithoutFocusException).
Оба действия подтверждения теперь явно ищут isDialog() root, сохраняя реальный
Espresso click и ожидание focus. Focus/security checks, FLAG_SECURE и остальные
27 тестов не ослабляются/не пропускаются. Все 5 repository moderation tests,
background/saved-state privacy test и прежние MFA/isolation tests уже PASS.
App code этим test-only исправлением не меняется; новый полный CI ещё ожидается.


### 2026-11-15 — Строгая проверка типа причины при финальном review

После первого source CI backend d1f9e1e / 43702432031 SUCCESS дополнительный
проход выявил: normalizeNote преобразовывал JSON object/boolean/number в строку.
Теперь причина принимает только string (null/undefined остаются отсутствием note);
возврат/отклонение без непустой строки запрещены. Расширены реальные HTTP tests
неверных типов; 3 HTTP scenarios, moderation policy и replay regressions PASS.
Изменённый backend source требует свежего полного CI; прошлый PASS за него не выдаётся.
Android source 894fe1c5 и его APK этим серверным исправлением не меняются.


## 2026-11-15 — G2 Admin moderation: итоговая проверка и готовые артефакты

Проверенный Android source d469b42c60fd1c6c33ba91120920e0d1aa709929:
https://github.com/lobanov0710-blip/TransferDriver/actions/runs/43704273792
job 132781893105 — SUCCESS. Admin JVM 31+31+31 = 93, API 35 runtime 27;
Driver JVM 29+29+29 = 87, runtime 12. Executed reports без failures/errors/skips.
Выполнены все новые repository/UI tests: fresh permissions, sensitive read denial,
явный retry после потерянного acknowledgement с тем же body/key, partial return,
401/account replacement, snapshot-bound image, saved-state/background privacy.
Полный lint Admin debug/staging/release — 0 issues. Security guards 5+7,
package/signature/UID isolation, endpoint locks и Driver App Check policy PASS.

Проверенный backend source 51d21da7e7338a7b3a85982c06922fc200963e80:
https://github.com/lobanov0710-blip/uber-v3/actions/runs/43702881770
job 132777627061 — SUCCESS. 66 test scripts, 18 local migration smoke checks,
12 preflight tests; три native workerd/D1 harness (availability, OWNER MFA,
moderation HTTP workflow), Worker dry-run — PASS. Npm install/audit: 0 vulnerabilities.
Внутри нового HTTP suite 3 сценария включают audit rollback, reason/type/body bounds;
никакие security checks не отключались. Предыдущие Android CI failures 43702428479
и diagnostic 43703195348 сохранены в истории выше и не выданы за PASS.

Новый итоговый набор из 6 файлов:
/workspace/artifacts/transfer-admin-moderation-verified-2026-11-15/
Debug/staging/release APK, staging/release AAB и AndroidTest APK проверены:
manifest/package, no shared UID, backup/cleartext disabled, разные Admin/Driver
certificates, v2 signature debug и AndroidTest (cert совпадает с Admin), unsigned
staging/release APK/AAB, правильные variant endpoints, отсутствие Driver/Firebase
classes и SHA-256 всех файлов. Source hashes 45 файлов сохранены.
Первоначальный набор transfer-admin-moderation-2026-11-15 и старые MFA/первый
Admin наборы не перезаписаны. Полный receipt:
docs/ADMIN_MODERATION_BUILD_2026-11-15.json в Android ветке, копия рядом с APK.
Dependencies не менялись; Android OSV inventory от 2026-11-15 (6 configurations,
152 components, 0 advisories на момент запроса) сохранён и не выдаётся за новый scan.

Draft PR #7 TransferDriver / #29 uber-v3 обновлены под итоговый объём: OWNER MFA
и registration moderation. Подробный API/permissions/retry контракт — backend
/docs/ADMIN_MODERATION_API.md. После проверенных source SHA публикуются только
документы/receipt. Общие baseline-ветки получают только журнал, код moderation
остаётся в отдельных G2 ветках. История Git не переписывается.

ТЗ не менялось: blob 7434dc0b1548b4f2c5382f12d6cc5399f93d0a84.
Этим завершён описанный Admin moderation срез, а не весь G2/production.
Ограничения: до 50 строк очереди без cursor pagination, до 200 review events;
остальные Admin разделы и Driver анкета/автомобили/исправления/availability ещё
не завершены. Следующий утверждённый шаг рекомендации — Driver registration/
vehicles UI на синтетических данных с серверными статусами и revisions.
D4–D7 не утверждены. G1 приостановлен. Реальные документы/биометрия, storage/OWNER
secrets, live server E2E, remote migrations, merge и deploy не выполнялись.


## 2026-11-15 — Подготовка OWNER phone test на STAGING по решению владельца

Владелец поручил подготовить настройку для тестирования на телефоне и уточнил:
«Только Admin/OWNER на STAGING; Driver G1 оставить на паузе»; приватные действия
выполняются на его Windows PowerShell. Полный Driver G1 не возобновляется.
Отдельно утверждён TOTP на том же телефоне: в RAM можно удерживать только служебные
challenge/enrollment IDs до их исходного срока в 5 минут; seed/введённые коды
очищаются, сохранения на диск нет, незавершённые сетевые операции отменяются.
Это явное уточнение владельца к прежнему полному сбросу transient MFA flow в фоне.

Cloudflare CLI этой среды: not authenticated. Текущий backend STAGING независимо
не подтверждён: два unauthenticated GET получили HTTP 403 text/plain от envoy,
а не JSON Worker; это не свидетельство состояния deployed API/БД.
Remote DB/account/secrets не читаются по догадке и не изменялись.

Подготовка: отдельный fail-closed OWNER-only STAGING scope (без Driver/public/legacy
операций), защищённый local Windows CLI control plane без public bootstrap/reset
endpoint, точные target guards и проверяемый deployment plan. Общий D3 preflight
не ослабляется; отсутствие R2/Firebase не объявляется готовностью Driver E2E.
До отдельного подтверждения выполняются только локальная подготовка и тесты.


### 2026-11-15 — OWNER phone: реализация и локальные проверки

Выполнено утверждённое уточнение same-phone TOTP: opaque IDs/исходный TTL
сохраняются только в RAM, seed/поля ввода очищаются, сохранение view state
отключено. Срок контролируется также monotonic clock, переключение его не
продлевает; таймер/возврат в foreground очищает просроченные IDs. Pending auth
отменяется через OkHttp, generation исключает позднее сохранение сессии.
Recovery-коды по-прежнему не удерживаются при уходе в фон.

OWNER-only STAGING закрывает Driver/public/legacy/private-resource routes,
non-OWNER login/refresh/authorization и Driver/support cron jobs. Существующие
регистрации скрыты. Fixture/data upload не создаются. Публичного bootstrap/reset
нет. Windows CLI закреплён за известными STAGING DB/KV/host, вывод провайдера
не печатается; секрет передаётся через stdin, password verifier/bootstrap digest
записываются атомарным D1 import с audit. TTL bootstrap берётся по часам БД.
Существующий OWNER/factor/key не заменяется. Подготовлен Windows runbook; первый
этап — read-only plan. До разбора фактического плана remote writes не разрешены.

Локально: Admin debug/staging/release сборки, JVM 31×3, три lint — PASS; guard
проверки Admin 5 и Driver 7 — PASS. Backend полный npm test (67 test scripts),
миграции 18, неизменённый D3 preflight 12 tests, native workerd/D1 availability,
OWNER MFA, moderation и новый OWNER phone flow — PASS; npm audit 0 vulnerabilities;
Worker bundle dry-run PASS. Новый ownerPhoneSetup: 8 tests PASS (exact target,
route/role/data isolation, atomic provisioning/audit rollback, no factor reset,
scheduler isolation, private CLI non-TTY, unexpected bindings).

В ходе проверки child-process CLI test сначала не выполнился: sandbox EPERM при
spawnSync; повтор с разрешённым network capability выполнил реальный subprocess
и прошёл. Исправлен scheduler test: вместо проглатываемого mock batch error
проверяется успешный batch ровно четырёх MFA-only SQL statements. Android runtime
ещё требует свежего CI; локальная компиляция AndroidTest не выдаётся за его запуск.
Remote migrations, secrets, account provisioning, deployment и merge не выполнялись.


### 2026-11-15 — OWNER phone: финальная проверка и пакет для владельца

Android source 8a948591e6fa8bbbc3dd0b79f25ce27913761323, CI 43714614881 /
job 132813325050 — SUCCESS. Admin: JVM 31×3=93, API35 runtime 29, lint 0
issues во всех трёх вариантах. Driver regression: JVM 29×3=87, API35 runtime 12.
Итого 180 JVM и 41 runtime test, без failures/errors/skips. Required-name guard
подтвердил выполнение samePhoneSwitchPreservesChallengeWithoutCodesOrExtendedExpiry,
enrollmentBackgroundKeepsOnlyOpaqueIdsAndNeverSeed, retainedChallengeExpiresWithoutAnotherNetworkRequest
и прежних MFA/session/moderation checks. Endpoint locks, независимые signatures/UID,
Play Integrity policy и security guards — PASS.

Backend source 550d2dda8f86242a8608b9daaee2c64bff0e9c49, CI 43714618395 /
job 132813334993 — SUCCESS. 67 test scripts (новый ownerPhoneSetup 8 tests),
18 migration files, 12 D3 preflight tests, четыре native workerd/D1 harnesses,
Worker dry-run и npm audit 0 vulnerabilities. D3 gate не ослаблен.

В отдельной папке artifacts/transfer-admin-owner-phone-2026-11-15 приготовлены
новый signed debug APK для STAGING, unsigned staging/release APK/AAB и test APK,
receipt, SHA256SUMS и owner-phone-setup.zip. Прежние наборы не перезаписывались.
Проверены manifest/package/no-backup/TLS/endpoint, отсутствие Firebase/Driver
classes, APK v2 signature; AndroidTest подписан тем же Admin сертификатом,
Driver — другим. Проверка содержимого всех архивов не обнаружила загруженный
Firebase SDK key Driver (само значение не выводилось).

Setup ZIP: 177 файлов, 95 source hashes; нет production wrangler.toml, .git,
node_modules, credentials или private config. Распакованный пакет прошёл private
TTY init с синтетическим public Account ID: только локальный exact-STAGING config,
без сети/remote writes. Подмена source file блокирует init до config/network.
Windows PowerShell непосредственно в этой Linux-среде не запускался; реальная
авторизация Cloudflare и hosted-state не проверены и не объявляются готовыми.

OWNER_PHONE_STAGING_WINDOWS.md описывает первый шаг владельца: npm ci --ignore-scripts,
init, Cloudflare browser login, read-only plan. В чат — только
.owner-phone/admin-phone-plan.public.json. Изменяющие schema/mfa-key/deploy/owner
шаги после разбора отчёта и отдельного утверждения; аккаунт/пароль/factor не
заменяются автоматически. Публичного bootstrap/reset и обхода MFA нет.

Сборки debug предназначены для теста, release/upload key ещё не создан.
Live server E2E, private storage/реальные материалы и тест на телефоне владельца
не выполнены. Dependencies не менялись; прежний OSV inventory 152 components/
6 configurations/0 advisories не выдаётся за новый scan. G1 на паузе, D4–D7
не утверждены. ТЗ не менялось (blob 7434dc0b1548b4f2c5382f12d6cc5399f93d0a84).
Публикуются только рабочие feature ветки и journal-only baseline updates; merge,
remote migrations/secrets/OWNER provisioning и deployment не выполнялись.


## 2026-11-15 — Получен и разобран OWNER phone public plan

Владелец передал admin-phone-plan.public.json, SHA256
1ee6fadc8b3a3f375c66f5d15a48a84a528ed23515beaf20dbf715bffdc41726.
Файл разобран как данные без выполнения содержимого. Source 550d2dda8f86242a8608b9daaee2c64bff0e9c49,
Worker/host/D1 совпадают с утверждённым STAGING; единственная pending migration
0018_owner_totp_mfa.sql. По отчёту OWNER binding отсутствует, MFA factors 0,
JWT_SECRET и ADMIN_MFA_ENCRYPTION_KEY отсутствуют; remoteWritesPerformed=false,
G1 остаётся приостановленным. Отчёт не подтверждает отсутствие staff accounts.
KV ID/value APP_ENV не входят в public JSON, exact check выполняет ранее выданный
CLI; независимое live чтение из среды ассистента не проводилось.

Обнаружен пробел setup: deploy правильно блокируется без JWT_SECRET, но нет
отдельного безопасного action создания. Подготовлен jwt-key с независимыми
CSPRNG 32 bytes через Wrangler stdin; значения не выводятся/не сохраняются и
не передаются в argv. Существующие JWT/MFA keys не ротируются, чужие secret names
запрещены, без reviewed schema/typed confirmation записи невозможны, MFA factors
без исходного key не сбрасываются. Remote записи не выполнялись.

Предложен конкретный этап для утверждения: 0018 → jwt-key → mfa-key → plan →
OWNER-only deploy → приватная настройка выбранного владельцем OWNER account/TOTP.
Подробный разбор: OWNER_PHONE_PLAN_REVIEW_2026-11-15.md. Передача файла сама по
себе не разрешает этот этап; прежняя read-only граница сохраняется. APK/Android
код и контракт API не меняются. Production/G1/R2/Firebase/merge вне объёма.

Локально ownerPhoneSetup — 11 tests PASS: добавлены crypto roundtrip JWT/MFA
для независимых ключей, stdin-only transport, сохранение existing secrets,
pending schema/unknown name/factor guards, denied confirmation и отсутствие
автоповтора ambiguous provider failure. При подготовке нового теста сначала
перепутан порядок аргументов signJWT/verifyJWT; исправлен вызов теста по существующей
сигнатуре, код JWT не изменялся. Свежий backend CI ещё ожидается; прежний Android
CI остаётся применим к неизменённому APK/source.

Уточнение безопасности порядка: установленный Wrangler 4.125.0 secret put
использует PUT /workers/scripts/.../secrets, относится к действующему Worker и
предупреждает о риске accidental deployment при работе с versions. Чтобы новый
JWT не активировал прежние маршруты до ограничения scope, предыдущая предложенная
последовательность заменена на 0018 → isolate → jwt-key → mfa-key → plan → owner.
Это исправление подготовки, удалённые действия не выполнялись. `isolate` требует
OWNER=null, factors=0, обоих отсутствующих ключей и applied schema; обычный deploy
сохраняет ключевые readiness guards. Перед каждым новым secret put проверяются
HTTP scope header/закрытые Driver routes. Дополнительные tests проверяют оба
варианта deploy, запрещённые initial states и отсутствие secret writes при
неподтверждённой изоляции; локально 13 tests PASS. В ходе правки test source
исправлена лишняя закрывающая скобка, найденная node --check; production JWT код
и Worker runtime не изменялись.


### 2026-11-15 — Разбор плана и обновлённая OWNER setup подготовка завершены

Итоговый setup source 01bbcc8acf5228ba7735969a8fbbf0cb4e8671ba, backend
CI 43719538291 / job 132828305901 — SUCCESS: 67 test scripts, ownerPhoneSetup
15 tests, 18 migrations, 12 unchanged D3 preflight tests, четыре native workerd/D1
harnesses, Worker dry-run и npm audit 0 vulnerabilities. Предшествующий source
6ec22a78 / CI 43719298434 (14 phone tests) тоже прошёл; последняя правка дополнительно
принудительно включает WRANGLER_LOG_SANITIZE=true. Реальный child-process test
подтверждает sanitization даже при inherited false. Raw provider output не
выдаётся пользователю; временный private log удаляется.

Обновлённый архив хранится отдельно: transfer-admin-owner-phone-jwt-2026-11-15/
owner-phone-setup.zip, 179 файлов, 96 protected source hashes. Проверен после
распаковки: private TTY init создаёт exact STAGING config только локально с
синтетическим Account ID; подмена source блокируется до config/network. ZIP
не содержит production config/credentials/.git/node_modules или загруженный
Driver Firebase SDK key. SHA256 и tested-source provenance —
OWNER_PHONE_SETUP_BUILD_2026-11-15.json и SHA256SUMS. Предыдущий пакет сохранён.
Исходный Admin APK не менялся (source 8a948591, CI 43714614881). Worker src,
миграции и зависимости также не изменялись; исправления только control plane/tests/docs.

Итоговый предложенный порядок после явного утверждения: schema(0018) → isolate
(подтверждённое пустое OWNER/key state) → jwt-key → mfa-key → plan → owner.
Ни secret put, ни Owner provision не выполняются без проверки OWNER-only scope.
Точный account/пароль выбирает владелец в приватном терминале. Cloudflare remote
write/deploy/merge не выполнялись; реальный Windows run этого обновления, live
server E2E и телефон владельца ещё не проверены. G1 на паузе.

Прерванный пользовательским сообщением командный вызов не применил правку
документов; это проверено по состоянию файлов и запись повторена. Команда
«продолжаем» обработана как продолжение текущей подготовки; remote этап остаётся
на отдельной границе подтверждения из выданного runbook. В journals сохраняется
история промежуточного порядка, актуальная последовательность указана выше.


## 2026-11-15 — Владелец явно утвердил remote STAGING этап

Ответ владельца: «утверждаю» на конкретный этап после разбора public plan.
Разрешены: применение единственной pending 0018_owner_totp_mfa.sql; развёртывание
OWNER-only режима на uber-v3-staging с проверкой закрытия Driver/public/legacy/
private-file routes; создание независимых отсутствующих JWT_SECRET и
ADMIN_MFA_ENCRYPTION_KEY; приватная настройка выбранного владельцем OWNER
account/TOTP и проверка входа на телефоне. Актуальная последовательность:
schema → isolate → jwt-key → mfa-key → plan → owner. Повторное согласование
этого объёма в чате не требуется. Точные private CLI phrases остаются защитой
от выбора неверной среды. Account/password/seed/bootstrap/recovery — только
в приватном терминале/приложении владельца, в журнал не включаются.

Цель неизменна: Worker uber-v3-staging / утверждённые STAGING DB/KV. Production,
merge, возобновление Driver G1, R2/Firebase и password/factor/key reset не
разрешены этим ответом. При отличии фактического состояния работают существующие
fail-closed guards; их обход не разрешён. Выполнение в согласованном режиме:
Windows PowerShell владельца, его существующая приватная Cloudflare авторизация.
Проверенный пакет source 01bbcc8acf5228ba7735969a8fbbf0cb4e8671ba /
CI 43719538291 SUCCESS (15 setup tests и полный backend набор); ZIP SHA256
27a6469315a5a9d841dd0269d1154648f5be6453be5842008a2f6fb649962ff7
повторно сверен перед передачей команд. Код/APK/артефакты не меняются.

Подготовлена OWNER_PHONE_STAGING_APPROVED_STEPS_2026-11-15.md с командами
в согласованном порядке и точными фразами. Из среды ассистента remote actions
не выполнялись: приватные действия исполняет владелец на своём компьютере.
Утверждение записано как разрешение, а не как свидетельство успешного deployment.
Факт migration/isolation/secrets/OWNER/TOTP/телефона будет записан после
безопасного отчёта о выполнении; при ошибке — action name и plan без секретов.
G1 остаётся на паузе.


## 2026-11-15 — Разобрана остановка private CLI на init

Владелец сообщил фиксированное OWNER PHONE SETUP FAILED at init и уточнил:
ошибка после ввода public Account ID; Test-Path wrangler.admin-phone.staging.json
возвращает True. До запроса ID уже пройдены private TTY/source manifest checks.
В коде init запись выполняется writeFile(flag='wx'), существующий config не
перезаписывается. В распакованном проверенном ZIP с synthetic Account ID
воспроизведено: первый init PASS, повторный init после ID выдаёт тот же generic
failure; байты ранее созданного config не изменяются, remote calls отсутствуют.
Это подтверждает блокировку повторного init при существующем config; исходный
скрытый exception пользователя независимо не получен, Account ID в чат не запрошен.

Безопасный следующий шаг — пропустить ненужное создание и выполнить plan.
Plan заново проверяет exact STAGING config/source/bindings/schema и не делает
remote writes. Config не удаляется/не перезаписывается, private TTY и source
checks не отключаются. После успешного plan владелец продолжает уже утверждённый
этап с schema; нового согласования не требуется. При ошибке plan — только action
name/public report без raw credentials/provider output. В инструкциях добавлено
пояснение про повторный init. Код/пакет/подпись/API не меняются; прежние 15 setup
tests/CI 43719538291 остаются применимы, заново за исполненные не выдаются.
G1 на паузе; migration/deploy/keys/OWNER/phone success не подтверждены этим
сообщением. Remote действия из среды ассистента не выполнялись.


## 2026-11-15 — После existing-config init выполнен read-only plan

Владелец прислал успешный CLI итог: Reading the exact STAGING target; credentials
and provider output stay private / READ-ONLY plan complete. Это результат
plan после рекомендации использовать уже существующий config вместо повторного
init. Config не удалялся/не перезаписывался по инструкции; факт байтового
состояния файла на ПК владельца ассистентом не проверялся. В сообщении нет
обновлённого public JSON: конкретные текущие pending/owner/key flags и source SHA
по одному stdout не переутверждаются. CLI plan по своему контракту remote writes
не выполняет; deployment/schema/keys/OWNER/TOTP/телефон этим не подтверждены.

Фраза Do not run write actions before approval — стандартный текст CLI.
Явное утверждение владельца от 2026-11-15 уже записано и действует на
schema → isolate → jwt-key → mfa-key → plan → owner только STAGING; нового
согласования этого объёма не требуется. Следующие команды выдаются с условием
последовательного успешного исполнения и сохранением всех exact-target/schema/
route-isolation guards. Сначала schema (единственная допустимая pending 0018),
потом isolate и лишь после подтверждения закрытых routes — ключи/OWNER.
При ошибке остановка и безопасная диагностика без вывода credentials.
Фактические изменения на Cloudflare выполняет владелец в private PowerShell,
а не среда ассистента. G1 остаётся на паузе. Код/пакет не менялись.


## 2026-11-15 — OWNER остановился на строчном n; причина установлена

Владелец сообщил generic OWNER PHONE SETUP FAILED at owner, затем уточнил:
ошибка до PROVISION, последним заполнен только выбор N/E. В присланном тексте
видно `...? n`, после чего failure. В первоначальном CLI choice сравнивался
строго с 'N'/'E'; строчная n попадала в Explicit account choice required.
На этом участке owner provisioning не отправлял import SQL, account/binding/
bootstrap не создавались. Это относится к данному запуску owner, не отрицает
ранее выполненные приватные schema/isolation/key шаги; их итог отдельно не получен.

Немедленное безопасное продолжение текущим проверенным пакетом: повторить owner
и ввести один символ N латиницей, без кавычек. После этой подтверждённой ранней
ошибки неоднозначного provisioning write не было, поэтому такой повтор допустим.
Пароли/логин/ID/seed/bootstrap не запрашивались в чат. Роль выбирает сам владелец.

Исправление подготовки: explicit choice нормализуется toUpperCase после existing
trim. Принимаются n/N/e/E; другие значения по-прежнему отклоняются. Default
account choice, bypass TTY/config/source/schema/scope/confirmation и reset не
добавлены. Критерии логина, пароля, MFA и атомарный import не изменялись.

Локальная проверка actual CLI через pseudo-TTY с synthetic read-only Cloudflare
boundary: старый n воспроизвёл исходную ошибку; исправленные n/N открывают
New OWNER login, e/E — Exact existing active admin account ID, x отклоняется.
Всего 6 terminal scenarios; password не вводился, PROVISION/import не достигнуты,
реальных запросов/секретов/записей нет. Existing ownerPhoneSetup 15 tests — PASS;
node --check/git diff --check — PASS. Свежий backend CI ожидается. APK/Worker
runtime/миграции/зависимости не меняются; remote success на ПК владельца не
выдаётся за проверенный факт. Утверждение STAGING этапа действует, G1 на паузе.


### 2026-11-15 — Исправление регистра OWNER choice проверено и упаковано

Итоговый source 5f07f1f5bbdbe7ec0324ed7586394afd8b8d5634, backend
CI 43724115538 / job 132842190133 — SUCCESS: 67 test scripts, 15 phone setup
tests, 18 migrations, 12 D3 preflight tests, четыре native workerd/D1 harnesses,
Worker dry-run, npm audit 0 vulnerabilities. Manual actual-CLI pseudo-TTY checks:
6 scenarios, original n failure, fixed n/N/e/E allowed to their respective next
prompt, invalid x denied; Cloudflare boundary synthetic/read-only, passwords
не вводились, provisioning SQL/confirmation не достигнуты.

Исправленный архив отдельно: transfer-admin-owner-phone-choice-2026-11-15/
owner-phone-setup.zip, 179 файлов, 96 protected hashes. Проверены manifest hashes,
private TTY init с synthetic public Account ID, rejection подменённого source
до network/config и отсутствие загруженного Firebase SDK key Driver в ZIP.
Receipt OWNER_PHONE_CHOICE_FIX_2026-11-15.json; архив SHA256:
6baf6e894cb6b680c3457e85a2be1c6b3ad9ac9a886f38c308b799578566ae61.
Прежние пакеты сохранены. Для немедленного продолжения исходным проверенным
пакетом достаточно заглавной N; новое развёртывание Worker/пересборка APK/
отключение checks/редактирование private config или source manifest не нужны.

Remote миграции/isolation/keys на ПК владельца не перепроверялись ассистентом.
Сбой данного owner наступил до записи, поэтому предписан повтор с N. Если уже
достигнут PROVISION/import, действует прежнее правило: не повторять запись
вслепую, сначала read-only plan. Утверждение STAGING остаётся действующим, G1
на паузе; production/merge/reset этим исправлением не выполнялись.


## 2026-11-15 — Сбой OWNER после PROVISION: запись появилась, bootstrap не выдан

Владелец прислал сообщение FAILED at owner уже после точной фразы PROVISION
STAGING OWNER <private account ID>. ID/логин/пароль/коды в журнал не копируются.
Сразу предписан только read-only plan, без слепого повтора provisioning.
Получен новый admin-phone-plan.public.json, SHA256
9c0aeca6ae4f33f46b79967cbd2d11d28c790e3e9440f1d33270ea3ca5b4fbe7.
Данные разобраны как JSON, не как инструкции. Source 01bbcc8a соответствует
выданному v2 пакету; target прежний STAGING. По отчёту: pending=[], ownerExists=true,
ownerFactorCount=0, оба JWT/MFA secret names present, ADMIN_PHONE_TEST_ONLY binding
присутствует, G1 на паузе. remoteWritesPerformed=false относится к самому plan,
не означает отсутствия записей предыдущего owner/schema/key action. Значения
секретов и flag не раскрываются JSON, их guards выполняет ранее проверенный CLI.

Найдена и воспроизведена ошибка control plane: pinned Wrangler 4.125.0 SQL file
import с --json пишет progress строки из отдельного CLI logger/spinner до JSON.
OwnerPhoneWrangler.run(...,{json:true}) пытается JSON.parse всего stdout и
отклоняет успешно завершённый import до postcondition query/выдачи bootstrap.
Отдельный опыт с настоящим Wrangler и локальным synthetic API подтвердил:
strict JSON parsing отвергает ответ completed import; та же команда с проверкой
exit status без разбора write stdout завершается успешно. Реальных Cloudflare
запросов/секретов в опыте нет, fixture SQL SELECT 1. Это согласуется с ownerExists
после сообщения об ошибке; сырые provider logs владельца не запрашивались.

Исправлен только вызов write command: stdout import не используется как
доказательство. Exit status по-прежнему проверяется; отдельный strict-JSON D1
SELECT обязан подтвердить текущий active OWNER, новый bootstrap digest и exact
unexpired expiry. Лишь после этого код показывается в private TTY. Все read
commands сохраняют строгий JSON parsing. Атомарный D1 import/rollback, factor
guards, пароли и permissions не изменены. Для текущего состояния после проверки
исправления используется существующий OWNER, без создания второй учётной записи,
смены пароля или сброса TOTP. Выдаётся новый bootstrap через прежний утверждённый
control plane, исходный потерянный plaintext по digest не восстанавливается.

Добавлена полноценная regression проверка реального CLI/private PTY/реального
Wrangler с локальным synthetic SQLite/D1 HTTP boundary: old committed failure,
новый и existing OWNER success, wrong postcondition и import rollback. Проводится
локальный запуск; результаты/CI пока не объявляются успешными. При подготовке
fixture первый запуск не достиг owner prompt из-за отсутствующей служебной
таблицы d1_migrations в mock DB; tracking table добавлена только в тестовую
среду, production schema не менялась. APK/Worker runtime/миграции/зависимости
не меняются. Утверждение STAGING действует, G1 остаётся на паузе.

Локальный protected-CLI regression теперь PASS для всех 5 сценариев: legacy
committed failure (owner/bootstrap записаны, код не выдан, postcondition read
ещё не вызван), new_success, existing_success без второй account,
wrong_postcondition без выдачи кода, import_failure с rollback. Используется
реальный Wrangler 4.125.0 и локальный SQLite/D1 API; real Cloudflare requests 0,
raw terminal output не раскрывается, hidden synthetic password не echo. Existing
ownerPhoneSetup 15 tests PASS, syntax/whitespace checks PASS. Новый regression
добавлен в CI после native OWNER phone check; финальный полный CI ещё ожидается.


### 2026-11-15 — Post-import исправление проверено, подготовлено продолжение

Source a7ed6128dbd5416b1c4db5210accfacebec3377e, backend CI 43726075123 /
job 132848172485 — SUCCESS: 67 test scripts, 15 setup tests, 18 migrations,
12 D3 preflight tests, четыре native workerd/D1 harnesses, Worker dry-run,
npm audit 0 vulnerabilities. Дополнительно новая CI проверка реального protected
CLI + реального Wrangler 4.125.0 + synthetic loopback SQLite/D1 API: 5 scenarios
PASS — legacy_committed_failure, new_success, existing_success, wrong_postcondition,
import_failure. Negative legacy control воспроизводит записанный OWNER/bootstrap
без вывода кода. Positive existing flow не создаёт вторую account; wrong
postcondition/import failure не выдают код, audit failure откатывает запись.
Real Cloudflare requests 0, password echo/raw terminal disclosure отсутствуют.

Исправленный пакет отдельно: transfer-admin-owner-phone-import-2026-11-15/
owner-phone-setup.zip, 182 файла, 96 source hashes. Receipt —
OWNER_PHONE_IMPORT_FIX_2026-11-15.json. Проверены source hashes, private TTY init
с synthetic Account ID, отказ на подменённый source до config/network, отсутствие
production config и загруженного Driver Firebase key в ZIP. Архив SHA256:
b4f813c07c78f3bd2de7fd97869610f71e24aece43d8f1e4eae22e7db62d5079.
Предыдущие пакеты сохранены; private Windows run этого исправления ещё ожидается.

Выдана OWNER_PHONE_POST_IMPORT_RECOVERY_2026-11-15.md: новый ZIP в новую папку,
локальное повторное использование уже проверенного config (CLI валидирует его
заново), npm ci --ignore-scripts → plan → owner. Ожидается Existing OWNER found;
не повторяются schema/isolate/key creation, не создаётся другой account, пароль
не сбрасывается. Новая попытка выдаст новый bootstrap только для active OWNER
без factor после authoritative digest/expiry read. Затем те же login/password
на телефоне, новый bootstrap, TOTP/recovery и новый вход. Секреты только в
private TTY/UI. Актуальные remote/phone результаты будут записаны после ответа
владельца. Утверждение STAGING действует, G1 на паузе, APK/Worker/API/миграции/
зависимости не меняются. Production/merge/reset не выполнялись.

При публикации source первый JS orchestration вызов не выполнился из-за
синтаксической ошибки конкатенации до tool actions; исправлен и повторён,
репозитории проверены сопоставлением staged tree с remote proposed tree.


## 2026-11-15 — Повтор после обновления выполнялся из старой вложенной папки

Владелец сообщил, что распаковал обновление в owner-phone-setup с заменой
похожих файлов, затем прислал npm ci success (37 added / 38 audited / 0
vulnerabilities по его выводу), успешный plan и повторный generic owner failure
после PROVISION. В prompt PowerShell рабочая папка — вложенная
owner-phone-setup/owner-phone-approved. Private home path и actual staff ID
из сообщения в журнал не копируются.

Запрошены только публичные sourceCommit из двух owner-phone-release.json.
Владелец подтвердил: текущая вложенная папка =
01bbcc8acf5228ba7735969a8fbbf0cb4e8671ba (старый import JSON parsing);
родительская owner-phone-setup = a7ed6128dbd5416b1c4db5210accfacebec3377e
(проверенное исправление post-import). Таким образом повтор запускал прежний
CLI из другой директории, новый исправленный CLI ещё не проверен на его Windows.
По одному повторному failure точный итог второго import не объявляется:
успех account/bootstrap/телефона требует новой authoritative проверки.

Продолжение: перейти явно в родительскую owner-phone-setup; сохранить
существующий config там либо скопировать только локально проверенный config
из owner-phone-approved, если в родительской папке его нет; не перезаписывать
имеющийся config и не редактировать source/manifest. Затем npm ci --ignore-scripts,
plan (проверит все source hashes и exact target), и после успеха owner. Ожидается
Existing OWNER found; новый account/пароль/factor/keys/schema/isolate не создаются
и не сбрасываются. Утверждение этого STAGING восстановления действует, повторного
согласования не нужно. При ошибке plan — остановка, не обход guards.

Код/запечатанный пакет не менялись: по-прежнему source a7ed6128 / CI 43726075123
SUCCESS, 15 setup tests + 5 protected CLI scenarios и полный backend набор.
Это не новый запуск CI и не независимый scan пользовательского Windows.
Remote действий из среды ассистента не выполнялось, G1 на паузе.


## 2026-11-15 — Разъяснён ввод TOTP: два приложения; возможное раскрытие pending seed

Владелец сообщил о цифровой клавиатуре, затем уточнил: приложение Transfer Admin,
bootstrap принимается, затруднение возникло с буквенной строкой после этого.
В сообщение включена потенциально секретная строка настройки. Её значение,
фрагменты и fingerprint в журнал/файлы/репозиторий/инструменты не копируются.
Владелец отдельно подтвердил: 6-значным кодом подключение ещё не подтверждено,
recovery-коды не получены. Точный live factor state не читается ассистентом.

Проверены исходники и фактически переданный signed debug APK: SHA256
f7d42523fb5f16803d4bd52c03a9b0f462f041e1911c858799944f2c48f35fd2
соответствует receipt/source 8a948591. apkanalyzer binary XML и aapt2 resource
mapping подтвердили bootstrapCode inputType=0x81 (textPassword), maxLength=100;
totpCode/enrollmentCode inputType=0x12 (numberPassword), maxLength=6. Java не
переводит bootstrap в number. Numeric TOTP input здесь предусмотрен контрактом;
факт неисправной клавиатуры на bootstrap не установлен. Установленный на телефоне
APK независимо не считан. Код/IME/security guards не изменяются по предположению.

Дан порядок двух приложений: Admin показывает секретный Base32 key → отдельное
TOTP приложение (например Google Authenticator), manual setup с этим key и time
based mode → шесть цифр обратно в Admin. Bootstrap из private Windows вводится
только в Код подключения. Буквенный key не предназначен для цифрового поля Admin.
TOTP SHA1/6 digits/30s и challenge 5 минут остаются по утверждённой политике.

Потенциально раскрытый pending key не используется дальше. Пока enrollment не
подтверждён, предложен новый bootstrap через утверждённый protected owner action
для того же существующего OWNER, затем новый login/enrollment. Реальный CLI
сам проверит active owner/no factor; при уже enrolled factor остановится без
reset. Пароль, account, серверные JWT/MFA encryption keys не меняются. Не требуется
новое согласование прежнего STAGING setup объёма; active MFA reset не разрешён.

Проверка с synthetic account/keys в in-memory SQLite на actual migrations и
actual protected bootstrap SQL/MFA services: reissue удаляет старые challenges,
FK ON DELETE CASCADE удаляет pending enrollments; old enrollment confirm и old
bootstrap отвергаются, fresh key отличается, новый enrollment работает.
Account id/password_hash/token_version/role/status сохраняются. PASS, raw secrets
не выводились, actual user string не использовалась, реальных Cloudflare calls 0.
Это локальная проверка, не подтверждение remote invalidation на ПК владельца.

Добавлена OWNER_TOTP_TWO_APPS_GUIDE_2026-11-15.md с последовательностью действий
и безопасным перевыпуском. Перед переключением на том же телефоне seed следует
приватно переписать: Admin очищает его в фоне, IDs сохраняет только до исходных
5 минут. Значения ключей/OTP/bootstrap/recovery в чат не присылать. Фактический
перевыпуск/phone login ожидаются от владельца. G1 остаётся на паузе.


## 2026-11-15 — Владелец подтвердил новый TOTP и вход; продолжение G2

Владелец подтвердил: после перевыпуска новый TOTP подключён, вход в Transfer
Admin на телефоне выполнен. Это результат проверки владельцем; независимого
чтения live factor/session или новой полной STAGING E2E проверки не проводилось.
Значения seed/bootstrap/OTP/recovery не запрашиваются и не фиксируются.
Задача восстановления OWNER phone login закрывается по подтверждению владельца.

Продолжается ранее утверждённая последовательность G2: после Admin moderation
— Driver registration/vehicles, затем availability/manual assignment. Для
анкеты и автомобилей создана отдельная ветка arch/g2-driver-registration.
Используются действующие D3 API, Java/XML, существующие Material-компоненты.
Реальные документы/биометрия не собираются: D4–D7 не утверждены, G1 на паузе.
Флаг ADMIN_PHONE_TEST_ONLY не снимается; Driver UI проверяется на синтетическом
транспорте, а не обходом изоляции STAGING. Merge и production deploy не разрешены.

В текущем GET /v1/driver/me есть profile/vehicles/status/revision, но нет
причин возврата отдельных элементов. Не придумывать эти данные в UI; расширение
контракта требует отдельной конкретизации. Первый срез: сохранение личных
данных, read-only подтверждённый телефон, список/создание/изменение автомобилей,
VIN, серверные статусы, optimistic revision conflict и защита от повтора mutation.
Отправка документов и финальная подача всей регистрации в этот срез не входят.


## 2026-11-15 — Проверка G2 Driver и общая защита HTTP503: финальный code CI

Android Draft PR #8: https://github.com/lobanov0710-blip/TransferDriver/pull/8
Проверенный source 5cb6d60060c491e4d0768c90d1446beeacfd1e00, tree
fae2d2d4f41923bdde0e7ebb2bb1a47ba85b8a7e. CI 43736924677 / job132881464115
SUCCESS: Driver43 JVM×3=129 + API35 runtime27; Admin34 JVM×3=102 + runtime29.
Итого231 JVM +56 runtime, без failed/skipped. Full lint3 variants обеих apps:
Driver0errors/54 прежних warnings в каждом, новые формы0issues; Admin0issues.
Локальная повторная сборка и те же6 JVM suites/6 lint suites прошли. Driver7+
Admin5 security guards и4 backend registration contract scripts PASS.

Нативный artifact14171191658 (544933bytes) checksum совпал:
218740e98b81bb7106046c30666e5eb028d1c6f06ec5ab511c932ba549d548e1.
Четыре actual API35 screenshots1080×2400 прошли signature/IHDR/chunk CRC/IEND
и локальную повторную проверку. Предыдущий artifact с adb diagnostic text
остался отвергнутым, его CI success не использован как визуальная приёмка.

Собран Admin debug STAGING с прежним отдельным сертификатом (публичный SHA256
ea4f14836b45719946857ce90a3fd8399a088b6ecca76f0a82db26cfa9c71a8b),
взятым только из прежнего локального ignored signing store. APK SHA256
43bfbb4daad747a53d231a2ffb3518ad3a5fd8e125d3a3712a519cbef85348d5.
Driver debug APK SHA256 a299c3a7ba3de59d15bc74a041f3c2cfb3bb9ad0c24d68c6a1111e039b6b8157;
сертификат отличается от Admin. APK подписи проверены apksigner37. Его новый
формат V2 Signer потребовал исправить локальный разбор public digest; первая
попытка receipt завершилась StopIteration, ключи не раскрывались/не менялись.
Это локальные сборки того же source; CI самостоятельно собрал/проверил source,
а не эти конкретные локальные APK bytes. Driver live E2E не выполнялся.

Загруженный Firebase SDK config key проверен на отсутствие во всех tracked
файлах (сам ключ не печатался). Документы ТЗ не изменены: blob
7434dc0b1548b4f2c5382f12d6cc5399f93d0a84. OWNER подтвердил новый TOTP/вход;
G1 остаётся на паузе, ADMIN_PHONE_TEST_ONLY не снимается. Реальные документы/
биометрия, release signing, merge и production deploy не выполнялись.

Первый fresh Impeccable reviewer завершился без результата из-за service usage
limit; это не review pass. После команды владельца «далее» повторяется тот же
safe review packet, без user secrets/входных ключей и без fork исходной беседы.
Итог UI review и необходимые исправления ещё будут зафиксированы отдельно.


### G2 Driver: independent UI review и промежуточные runtime failures

Frontend source16cdc03e6e7b2830c88a9bda19ee370540d1dfb5, Draft PR#8,
отдельная arch/g2-driver-registration. Backend code/API/schema/deploy не меняются.
Первый fresh reviewer был остановлен service quota; после команды владельца
«далее» independent generic agent по fallback Impeccable contract выполнил
проверку4valid native captures. Disposition fix: контраст system bars и
обрезанный диапазон мест при font1.3. Исправлены foreground по DayNight и
короткий label+permanent helper. PRODUCT.md содержит только утверждённые факты.

CI43738660853/source5448f31c: Driver dark fixture timeout до новых assertions.
Исправлена синхронизация actual font configuration и уничтожения Activity,
добавлен test-only запрет немокированного network. Следующий CI43739771085/
source505454a5: Driver27runtime PASS и4PNG validation PASS, позднее Admin
moderation test потерял focus первого dialog. Добавлены event-based ожидание
parent focus и matcher focused dialog, Espresso confirmation/все assertions
сохранены, таймауты не повышены. Production code не менялся после UI correction.
Сохранение PNG теперь возможно после позднего failure только по validator
marker, без изменения общего test status. Не применяется retry-until-green.

Текущий полный CI43742661189 ещё выполняется; окончательный runtime/recapture/
verdict не объявляются успешными заранее. История проверок/причин/fixes подробно
записана в Android журнале той же feature branch. Срез остаётся частичной
реализацией G2, Driver live E2E/реальные материалы/merge/production не выполняются.
G1 на паузе, утверждённое OWNER-only STAGING ограничение не снимается.


## 2026-11-15 — Первый срез G2 Driver: проверенный checkpoint и ограниченный UI verdict

Окончательный tested source16cdc03e6e7b2830c88a9bda19ee370540d1dfb5,
tree078a54b798d1911e6f15ac91891bc08afed84321; CI43742661189/job132899016826
SUCCESS. Driver43JVM×3=129 +27API35runtime, Admin34×3=102 +29runtime:
231 JVM +56 runtime, failed/skipped0. Полные lint6suites/endpoint locks/
отдельные package+UID+signing/App Check policy/security guards PASS. Driver
имеет54 прежних lint warnings и0errors, новые registration files0issues;
Admin lint0issues. Четыре backend registration contract scripts проверены
локально PASS, backend production code/API/schema не менялись.

Два промежуточных runtime failures (dark fixture и Admin dialog focus)
не скрыты/не объявлены успехом: исправлены наблюдаемые условия синхронизации
fixture без удаления cases/assertions, увеличения timeout или auth bypass.
Окончательный прогон выполнил все прежние и новые cases. По сравнению с
source5448f31c после исправления native UI production sources Driver/Admin
не менялись: дальнейшие changes только tests/workflow/docs.

Post-fix native artifact14173720607 (525678bytes), archive SHA256
72c114fe0aadf374745b7acbc8d65cd5d6bf08bb13dea36cf7e3b8dc04399077
проверен после скачивания. Четыре actual PNG1080×2400 light/dark/font1.3
валидированы и заново просмотрены по тем же путям. Прежние pre-fix captures
и отвергнутый adb-text artifact не используются как post-fix evidence.

Тот же independent fresh reviewer вернул disposition ship в scoring pass:
контраст system bars, полный label+permanent helper1–20, factual PRODUCT.md
и confirmation evidence — все4resolved; регрессий от этого batch не заметил.
Это verdict только о перечисленных исправлениях, не scan всего проекта,
не physical-device/live Driver E2E, не полная приёмка G2/production approval.
Использован generic fresh agent по fallback Impeccable role contract;
штатный launcher/agent-type отсутствовал, первый service-quota failure описан
ранее. Отдельный documenter сохранил incumbent Material3 DayNight, без нового
DESIGN/world/palette/fonts/dependencies, факты/ограничения — в UI review.

Результат: личные данные/read-only подтверждённый телефон, несколько машин,
обязательный VIN, раздельные revisions/statuses/save; single-send HTTP503
защита общих clients обеих apps и session/lifecycle binding registration.
GET me не даёт причин исправлений — UI их не выдумывает; полный wizard/
документы/биометрия/submit ещё не закончены. Technical response bounds
1MiB/200vehicles отражены в receipt, это не изменение server model.

Artifacts сохранены раздельно, старые не перезаписаны. Driver UI-fix debug APK
SHA2562940d9f67f47a27e8a8609f77a3835e16026f20f19688931beb0c2d3c11d4461
(source5448f31c, тот же production tree в final source); Admin STAGING debug
SHA25643bfbb4daad747a53d231a2ffb3518ad3a5fd8e125d3a3712a519cbef85348d5
(source5cb6d600, production Admin не менялся). Admin certificate совпадает
с ранее выданным, обновление предусматривается поверх без удаления данных.
Exact local APK bytes не объявляются CI-tested: CI собирал тот же source сам.
Driver live backend остаётся недоступен в утверждённом OWNER-only STAGING
scope: G1 на паузе, флаг изоляции не снимается.

Полные facts/hashes/provenance/limitations опубликованы в Android feature:
https://github.com/lobanov0710-blip/TransferDriver/blob/arch/g2-driver-registration/docs/DRIVER_REGISTRATION_VERIFICATION_2026-11-15.json
https://github.com/lobanov0710-blip/TransferDriver/blob/arch/g2-driver-registration/docs/DRIVER_REGISTRATION_UI_REVIEW_2026-11-15.md
Draft PR#8: https://github.com/lobanov0710-blip/TransferDriver/pull/8

Утверждённое ТЗ не изменено (blob7434dc0b1548b4f2c5382f12d6cc5399f93d0a84).
D4–D7 не утверждены. Владелец подтвердил новый TOTP и phone login; это
owner-reported acceptance, независимый live factor read не выполнялся.
Следующая уже утверждённая часть — availability/manual assignment.
Merge/production deploy не выполняются без отдельного решения владельца.
Финальные commits меняют только документы/журналы и помечаются [skip ci]:
проверки закреплены за exact code source выше, повтор unchanged code не нужен.


### 2026-11-16 — G2 availability: итог проверенного среза

Рабочая ветка arch/g2-availability-assignment, Draft PR#9:
https://github.com/lobanov0710-blip/TransferDriver/pull/9 .
Проверенный code source e3c6f0c3bde6ac77c5527e4e69c7f65fecd07e69,
tree9425fc9174e786c7c2055158d52288a8c501b1d2; CI43779524059/job133013316916
SUCCESS:246 JVM (Driver48×3, Admin34×3),67 API35 runtime (Driver38,Admin29),
0fail/skipped. Полные6 lint suites, сборки debug/staging/release и staging AAB,
security guards7+5, endpoint/AppCheck/package/signing/UID checks PASS.
Исторические54 Driver lint warnings из предыдущих local suites остаются
известным ограничением; CI lint PASS не выдаётся за новый warning count.

Driver: нижний slider/approved-car selector, radar только после server ack+GET,
off_line сохраняет ID текущего авто. Revision/idempotency/session epoch,
no auto refresh/replay; background отменяет pending work/очищает данные.
Availability subtree исключён из Autofill; фактическая утечка не установлена.
Нет новых dependencies/backend API/schema/deploy/merge. Production app tree
cad37e46bc1200df7a850bf5cec0a1d02847d814; Admin production tree
5e612dfc4e515aaf46ecdd99814548d8a44dd817 не менялся.

Промежуточные CI43752677606/43774408323/43775678761 FAIL сохранены в истории:
test fixture accessibility stub, ручной onStop вместо lifecycle и cached
Spinner count. Исправлены без удаления assertions/кейсов. CI43776899566 и
43778224200 затем SUCCESS246+67, но визуальный review выявил initial system-bar
contrast. Fresh generic reviewer/documenter по Impeccable fallback; первый
scoring PARTIAL/fix. После API30+ platform appearance и test-only ожидания
устойчивого unmodified framebuffer второй scoring RESOLVED, disposition ship
ТОЛЬКО для исходного contrast finding. Все4 actual native captures просмотрены,
новых регрессий batch reviewer не наблюдал. Это не full-product security clearance.

Artifact14188321054,882728bytes, SHA256
921c49e9470bd5e16faec27130e6d996366f765482f6c873db5c601c839deb0f.
8 fixed PNG1080×2400 signature/IHDR/CRC/IEND/archive-digest PASS.
Provenance: docs/DRIVER_AVAILABILITY_VERIFICATION_2026-11-16.json и
docs/DRIVER_AVAILABILITY_UI_REVIEW_2026-11-16.md в Draft PR#9.
Это main XML/panel в secure synthetic host, не full Main auth/order routing,
не live Driver/physical-device/tablet E2E. CI Firebase config синтетический,
новый user-installable Driver APK этим checkpoint не выдавался.
Локальный текущий compile ограничен Gradle sandbox service socket; CI —
фактическая проверка current source.6 прежних backend contract scripts, включая
7 actual SQLite cases, PASS на неизменённом backend code; повтор не требовался.

G1 остаётся на паузе; D4–D7 не утверждены. ADMIN_PHONE_TEST_ONLY неизменён.
Admin assignment read API version2 A/B всё ещё ожидает явного выбора владельца.
Исправлено первоначальное неверное утверждение о роли legacy GET /orders:
OWNER/DISPATCHER сохраняют auth-category admin; реальный пробел — selection
snapshot, cutoff1000 и extra PII старого списка. Предложение A:2 minimal
paginated GET; B:1 options GET + legacy limitations. Зависящие новые endpoints
не реализованы. Основание AGENTS.md п.3: «Не выполнять предложенный вариант до
утверждения». Общие команды продолжения не трактуются как выбор A/B.
Финальные docs/journal updates — [skip ci], без изменения проверенного app/test/
workflow кода; результаты CI относятся к exact code source выше.


### 2026-11-16 — Утверждён и проверен вариант A Admin assignment read API

Решение владельца: «Вариант A утверждаю». Утверждена version2 предложения
ADMIN_ASSIGNMENT_READ_API_PROPOSAL_2026-11-15.md: два minimal paginated GET.
Прежние pending A/B записи являются историей, решение A теперь явное.
Backend ветка arch/g2-admin-assignment-read, Draft PR#30:
https://github.com/lobanov0710-blip/uber-v3/pull/30 .
Code source dda85d2937f385cc7b0cccbc88d4282d50481485,
tree3fe4f5bb685d221ac7f1d6b92fedd636ec06e32c,
CI43854087967/job133253772715 SUCCESS.

GET /v1/admin/orders и GET /v1/admin/orders/{id}/assignment-options реализованы:
keyset cursor/limit1–50/default20, строгие scope/types/unknown/duplicate params,
минимальные SQL projections, server current grants и OWNER MFA, no-store,
обязательный read audit без контактов/cursor/provider/SQL text.
Actual test перечислил1106 orders без legacy cutoff1000. Options читает одну
страницу одним SELECT с общей mutation SQL eligibility projection, без N+1,
score/rank/автовыбора/новых D6 правил. Offline сам по себе не исключается.

Обнаружен и исправлен существующий D3 defect account active: precheck и atomic
assign/reassign теперь требуют role=driver/status=active. Read/mutation используют
общую функцию blocker codes. Actual SQLite race после precheck подтверждает
отказ обоих UPDATE при отключении кандидата без изменения order/audit.
Старая фраза «atomic busy» уточнена: current-assignment unique index относится
к order_id, новые критерии scheduling/future assignment не добавлялись.

Полный CI: все68 unit/router scripts PASS, включая15 новых actual SQLite/HTTP
cases;18 migration checks,12 fail-closed staging tests, npm audit0 vulnerabilities.
Все5 native Worker/D1 checks (availability,OWNER MFA,moderation,new read API,
OWNER phone scope), protected CLI5 scenarios и Worker dry-run bundle PASS.
Новый bundled Worker/D1 smoke подтвердил minimal payload/pagination/offline/
disabled-driver/current grants/OWNER MFA/read audit4rows. Deploy не выполнялся.

Локально15 новых cases и8 связанных regression suites PASS; полный npm suite
остановился на sandbox spawnSync EPERM старых CLI тестов, native Miniflare —
на listen EPERM127.0.0.1, Wrangler dry-run — global config path. Эти ограничения
не скрывались/не обходились; обязательные проверки затем реально прошли в CI.
Первоначальные2 FAIL новых fixtures (неверный audit action-prefix и INSERT
без списка колонок staff_accounts) исправлены, assertions/кейсы сохранены.
Контракт: docs/ADMIN_ASSIGNMENT_READ_API.md; provenance:
docs/ADMIN_ASSIGNMENT_READ_VERIFICATION_2026-11-16.json в backend PR#30.

G1paused, D4–D7pending, ADMIN_PHONE_TEST_ONLY whitelist неизменён: оба новых GET
по-прежнему недоступны на текущем OWNER-only STAGING. Реальные Cloudflare
ресурсы, schema/dependencies и Android production code не менялись.
Admin UI ручного назначения — следующий плановый срез, этим API checkpoint
не объявляется готовым; новый APK не выпускался. Merge/deploy требуют отдельного
решения. Финальные docs/journal commits [skip ci] не меняют проверенный код;
результаты относятся к exact code source выше.


## G2 Admin manual assignment UI — 2026-11-16, проверка Material3 исправления

Android Draft PR#10 https://github.com/lobanov0710-blip/TransferDriver/pull/10,
ветка arch/g2-admin-assignment-ui, base arch/g2-availability-assignment.
Утверждённый вариант A/D1–D3: явные order+driver/vehicle, reason, confirmation,
orderRevision/idempotency, no automatic replay, session-bound/current grants/MFA,
onStop privacy, закрытый owner_phone scope. Backend API/whitelist не менялись.
Устранена неоднозначность одинаковых маршрутов: в UI показан полный orderId.

Проверенный source1a26fb5950eab915f05230e306b05c60fb6d6041,
CI43875519388 SUCCESS:291 JVM,84 API35 native (Driver38/Admin46),6 build/lint,
endpoint/AppCheck/signing/UID/security gates,18 validated native PNG.
Fresh Impeccable reviewer проверил10 Admin captures, disposition FIX только
для legacy confirmation surface. Builder заменён на существующий Material3
компонент, runtime защиты не менялись. Текущий source86ae9b46fe6b7918eb28cf00b822a34f26f3b52c,
CI43877768185 — RUNNING; прежний успех не доказывает новую версию.
Требуются recaptures и scoring того же reviewer, затем fresh documenter/receipt.

G1paused/D4–D7pending. Это synthetic Activity/component evidence, не live/hardware
приёмка. На OWNER-only STAGING operational routes остаются404. Merge/deploy
и расширение телефонного scope не выполнялись; требуют отдельного решения.


## G2 Admin manual assignment — финальный synthetic checkpoint, 2026-11-16

Android Draft PR#10 https://github.com/lobanov0710-blip/TransferDriver/pull/10,
source86ae9b46fe6b7918eb28cf00b822a34f26f3b52c,
tree0ae36dab6748f49ddc73080a755d8d57b590d518,
CI43877768185/job133335205029 SUCCESS. Заново291 JVM executions
(Driver48×3/Admin49×3),84 API35 runtime (Driver38/Admin46), все6 build/lint,
bundles/debug test APKs, security/endpoint/AppCheck/signing/UID gates;
failures/errors/skipped0. Предыдущие RUNNING и reviewer FIX — история.

Устранены UI-неоднозначность одинаковых маршрутов (полный orderId) и
legacy confirmation (существующий Material3 builder).18 actual native PNG
проверены по ZIP digest/PNG CRC/IEND/dimensions/SHA256;10 Admin кадров лично
открыты. Тот же independent reviewer закрыл единственное material замечание
RESOLVED, disposition SHIP только для scored confirmation correction, без
наблюдённых introduced visual regressions. Fresh documenter отдельно прочитал
код/контекст и все10 кадров, проверил hashes; UI record завершён. Generic-role
fallback раскрыт, native detector не применялся, DESIGN/system files не менялись.

Receipt: https://github.com/lobanov0710-blip/TransferDriver/blob/arch/g2-admin-assignment-ui/docs/ADMIN_ASSIGNMENT_UI_VERIFICATION_2026-11-16.json
UI record: https://github.com/lobanov0710-blip/TransferDriver/blob/arch/g2-admin-assignment-ui/docs/ADMIN_ASSIGNMENT_UI_REVIEW_2026-11-16.md
План и PRODUCT отражают реализованный срез и границы. Финальная публикация —
только документы [skip ci]; исполняемый код остаётся точно проверенным source86ae.

Это synthetic Activity/Keystore/HTTP evidence, не live backend/hardware/tablet/
TalkBack acceptance и не завершение всего G2. G1paused, D4–D7pending. Backend
кроме журнала не менялся; ADMIN_PHONE_TEST_ONLY whitelist не расширён,
operational routes остаются404 на телефонном OWNER-only STAGING. Merge/deploy,
remote migrations, реальные документы/биометрия/назначения не выполнялись.
CI debug APK подписан ephemeral CI key; совместимость обновления телефона не
проверена. Артефакты14231790908/14231448349 хранятся до2026-11-23; receipt
содержит checksums/provenance. Lint PASS не означает ноль исторических warnings.

Опубликованные Android docs: ff628f71a561841a5d0ae80fef3ea2b6ba2de549, tree b5756c771322f110c91100e5244ac32da38c7626.


## Следующий G2 срез — предложение фотоконтроля, 2026-11-16

По поручению «Далее по плану» сверены ТЗ§§14–15/28–30, D1–D3, актуальные
план/журналы и GitHub heads. После завершённого Admin manual assignment
подготовлен возможный следующий Admin срез: внеплановый фотоконтроль.
Реализация нового среза НЕ начата; порядок/объём и новые GET не выбирались
за владельца. Прежнее утверждение варианта A относится только к назначениям.

Есть POST create, GET известной проверки, POST review; нет общего Admin
vehicle catalogue и GET коллекции photo-checks (существующий path POST-only).
Подготовлены два конкретных варианта: каталог+список с двумя minimal GET
(рекомендуется) либо ограниченное создание из существующей карточки регистрации.
Order-scoped assignment-options и выдача лишних moderation permissions не
используются как подмена каталога. Требуется явный выбор по AGENTS.md п.3.

Draft PR#11 https://github.com/lobanov0710-blip/TransferDriver/pull/11,
arch/g2-admin-photo-control-proposal, base arch/g2-admin-assignment-ui;
docs sourcebe1cb4332866882b279522f5b38008ffa4b48dc6,
tree8cfe59eaf554b41313b518e6889d57aa1162e259. Изменены только4 docs files:
предложение/JSON readiness/план/журнал. Ссылки, receipt и local/remote tree
проверены; в плане исправлена устаревшая строка16 по существующему PR#9.

Backend source506d7523c61e86cfb703a9a0eaffae5d36787294: Node24.22.1,
photoControlSupport.sqlite5 PASS (включая2 support regressions),
photoControlLifecycle.sqlite6 PASS;11 tests,failures/skipped/cancelled0.
Это actual SQLite/service synthetic fixtures, не новые GET, не Android build,
не native Worker/HTTP-MFA E2E и не exhaustive обоих restriction modes.
Source/log hashes и точные пределы — G2_PHOTO_CONTROL_READINESS_2026-11-16.json;
контракты/варианты/будущие проверки — G2_PHOTO_CONTROL_NEXT_SLICE_PROPOSAL_2026-11-16.md
в PR#11. Числа прежнего CI assignment не выдаются за новые проверки.

Executable code/dependencies/schema/whitelist не менялись. G1paused,
D4–D7pending; фото/document/биометрия/удалённые ресурсы не использовались,
новый APK/merge/deploy не выполнялись. Существующая phone-only404 сохранена.
Следующая зависимая реализация ожидает отдельного решения владельца.


## Расширенный справочник марок для утверждения — 2026-11-16

По запросу владельца «Каталог автомобилей нужно расширить. Haval, Cherry и т.д.
Подготовь расширенный список для утверждения» подготовлены отдельные Markdown/JSON
VEHICLE_MAKES_CATALOG_PROPOSAL_2026-11-16 в Android docs ветке PR#11.
Sourceb5fa627ab31f5c8da65788d60e788f9ea1d824c5,
tree817644b0ddef869a035b7c576bbf97f442fc99fc. Git local/remote tree совпал;
commit меняет только5 docs files, общий PR теперь содержит6 docs files.

Итог140 марок:64 расширенный китайский блок,14 региональных/исторических,
18 японских/корейских,29 европейских,15 американских. Включены Haval/Chery;
Cherry/Черри/Чери предложены как поисковые варианты Chery. Полный состав
ожидает утверждения. Современные EV/subbrands и старые марки сохранены раздельно,
связь автогрупп не приводит к автоматическому объединению. Модели/поколения
этим списком не утверждаются. Ручной ввод другой марки предложен без hard whitelist.

Форма Driver и backend/migration0005 сейчас принимают make/model как строки1–80;
Haval/Chery не исключаются проверками. Перечень готовится для удобного выбора/
поиска, а не для автоматического допуска/тарифа/приоритета. Существующие записи
и регистрационные данные не переписываются. Наличие всех марок в продаже/полнота
мирового рынка не проверялись; это вручную подготовленный состав для утверждения.

Проверены JSON parse,140 unique IDs/names,5 group counts,188 search entries
без cross-brand alias collisions, length≤80/no controls; отдельные assertions
Haval/Хавал и Chery/Cherry/Черри/Чери. Все140 строк Markdown совпали с JSON,
links/diff PASS. Новые APK/JVM/runtime/backend suites не запускались для
этого docs-only изменения; прежние11 SQLite readiness cases остаются историей.

План/фотоконтроль proposal и журналы обновлены. Список и внедрение pending;
этот запрос не утверждает новые GET/объём фотоконтроля. Executable code/API/
schema/dependencies/phone whitelist не менялись. G1paused/D4–D7pending,
merge/deploy/remote resources/обработка реальных документов не выполнялись.


## Состав140 марок явно утверждён владельцем — 2026-11-16

Ответ владельца на опубликованный список: «Состав справочника утверждают.».
Это явное утверждение полного состава140 марок, включая Haval/Chery.
Утверждённый исходный список: b5fa627ab31f5c8da65788d60e788f9ea1d824c5,
VEHICLE_MAKES_CATALOG_PROPOSAL_2026-11-16.{md,json}, Android Draft PR#11.
Повторное подтверждение не запрашивалось; прежние pending записи — история.

Статус изменён на approved-composition, сохранены дата/точная формулировка,
source и SHA256 состава id/name/group:
20c245092f7299e051616d1ade2c71aab8bd233578c2f5c47edab721b54e6d46.
Все140 makes/5 groups и предложенные aliases/proposedBehavior сохранены
без изменения. PRODUCT/план/справочник и фотоконтроль proposal актуализированы.
Документы опубликованы: b4a9e8999ffabeda5b5aef45c073deeefe73d39a,
tree334399045540fa868fece18fb4490036bb3a4f0a; local/remote tree совпадают.

Проверены140 unique IDs/names,5 counts,188 search entries/no collisions,
length≤80/no controls, Markdown/JSON parity, metadata/source snapshot checksum,
неизменность состава и links/diff. Это фиксация решения, не новая сборка:
новые APK/JVM/native/backend tests не запускались и не заявляются выполненными.
Служебный JS publisher первоначально остановился на SyntaxError до любых
инструментов/записей, затем исправлен; ref изменён только после проверки tree.

Объём утверждения: состав марок. Поиск/aliases, модели, внедрение UI/API,
миграция старых данных и новые GET/выбор объёма фотоконтроля этим сообщением
не утверждены. implementationChanged=false/photoControlApiApprovalImplied=false.
API/schema/dependencies/правила допуска/phone whitelist не менялись.
G1paused/D4–D7pending; merge/deploy не выполнялись. Запись фиксирует решение
для следующих шагов, а не объявляет реализацию справочника завершённой.


## Эконом исключён; классификатор искали по репозиториям — 2026-11-16

Владелец указал исключить Эконом, затем на вопрос об источнике таблицы
поручил: «нужно поискать по репозиторию». Проверены read-only текущие снимки
всех60 доступных GitHub веток (14TransferDriver/46uber-v3),821 уникальное
текстовое содержимое (376/445):776 Git blobs локально +45 через GitHub.
Recursive trees не усечены; CSV/XLS/XLSX/ODS/PDF/DOC/DOCX/архивов с таблицей
в этих снимках нет. Дополнительно reachable local history215+536 commits,
538+736 text blobs. Granta совпадения9 версий push test — переменная grantA,
не классификатор автомобилей. Default code search econom — только negative tests.

Утверждённая таблица марка→модель→год/комплектация→тариф не найдена в указанном
объёме. Полная remote ancestry/внешние документы/private D1/R2 не проверялись.
Фактически pricing.js, driverRegistrationService, migration0005, Android class
choices уже только comfort/business/minivan. Existing pricing27 checks PASS,
driverRegistrationService suite PASS (одна отчётная группа). Прямой probe
подтвердил3 тарифа и отказ econom/economy/ECONOMY/Эконом. Это не модельная проверка.

В справочнике140 марок теперь явный tariffPolicy: Эконом исключён,
referenceMayNotServeAsVehicleAllowlist=true/vehicleModelEligibilityApproved=false.
Сами марки/groups/прежнее composition approval сохранены. В справочнике нет
моделей/годов/тарифных присвоений; конкретные строки не удалялись по догадке.
Модельный список допуска только для Комфорт/Бизнес/Минивэн требует отдельной
утверждённой таблицы. Готовый фильтр эконом-моделей/операционный каталог не
объявляются реализованными. Указание об исключении тарифа принято без переподтверждения.

Документы: VEHICLE_TARIFF_CLASSIFICATION_SEARCH_2026-11-16.{md,json},
справочник марок, PRODUCT/план/журнал в Android Draft PR#11.
Опубликованный source9eb8b6c5afada4e481cce3cfcfee718fc906502e,
tree0ee3e55ad5ac33a9067b5d9f3d4e0483853975a9. JSON/links/parity/coverage и exact Git tree
проверены. Общий PR9 documentation files; текущий commit7 docs/PRODUCT files.
Executable code/API/schema/dependencies/автомобили/phone whitelist не менялись.
Новые APK/Android runtime/native Worker/live E2E не выполнялись. G1paused,
D4–D7pending, merge/deploy не выполнялись. Результат поиска и реальный предел
выполненной задачи сохранены для следующих решений владельца.


## Проверка предоставленной OneDrive ссылки — 2026-11-16

Владелец предоставил ссылку1drv.ms и поручил проверить её как возможный источник
модельного классификатора. Источник в журнале идентифицирован без share-token:
SHA256 URL88079d36eec6cccd80ba288962308d18c3d17d3f7ae61d0ed724635aec492497.
Полная ссылка/токен общего доступа в Git не публикуются.

Web opener сообщил unsupported/inaccessible URL; rendered read завершился
timeout25s. Обычный read-only HTTPS GET с перенаправлением на onedrive.live.com
получилHTTP403. Содержимое файла не прочитано, название/формат/таблицы/модели
не подтверждены. Причина403 (права, вход, политика сервера или среды) не
установлена; ссылка не объявляется недействительной или истёкшей.
После403 попытки доступа остановлены; login/изменение sharing/API обходы
не выполнялись. Для изучения потребуется предоставленный владельцем файл
PPTX/PDF в чате либо доступный ему экспорт, без передачи паролей/кодов входа.

Модельная таблица по этой ссылке не найдена и не опровергнута: содержимое
недоступно. Никаких данных источника/новых тарифных правил в справочник не
добавлялось. Эконом остаётся исключён; только Комфорт/Бизнес/Минивэн.
Executable code/API/schema/автомобили/phone whitelist не менялись;
новые APK/tests/merge/deploy не выполнялись. Это запись проверки доступа,
не аудит содержания презентации и не утверждение внешнего классификатора.


## Указан CSV vehicle-classifier-v1 — источник пока недоступен, 2026-11-16

Владелец уточнил: «Ветка Uber-v3, а документ docs/vehicle-classifier-v1.csv.
просмотри файл списка и его обнови». Поручение принято как чтение конкретного
исходника и исключение Эконома по его реальной структуре, без выдумывания строк.

GitHub contents GET для указанного пути в default main и рабочей
arch/g2-admin-assignment-read вернули404. Чтение raw URL через GitHub connector
также404; default code search имени файла — без результатов. Обновлён список
всех46 доступных веток uber-v3; recursive trees всех46 без truncation не
содержат CSV или совпадающего classifier path. В доступных локальных backend
worktrees/shared/library-files/attachments выполнен no-ignore filename search,
CSV не найден. Ветка с Uber в имени в TransferDriver не найдена, установленный
репозиторий uber-v3 определён как lobanov0710-blip/uber-v3.

Отсутствие файла вне доступного snapshot не утверждается. У владельца сразу
запрошен полный GitHub blob URL с названием ветки. Содержимое/схема/строки CSV
не прочитаны; обновление файла не выполнено и не выдаётся за готовое.
Новый фиктивный классификатор вместо исходника не создавался. После доступного
источника предстоит проверить кодировку/разделитель/header, тарифные значения,
отфильтровать только Эконом с сохранением остальных данных и проверить результат.

Во время восстановления helper состояния после смены окружения один metadata
вызов завершился TypeError; мутаций до исправления не было. Helper восстановлен,
последующие read-only проверки завершены. Code/schema/dependencies/автомобили/
тарифные правила/phone whitelist не менялись. Новые APK/tests/merge/deploy
не выполнялись; требуется точный доступный источник, не повторное утверждение
уже исключённого тарифа Эконом. G1paused/D4–D7pending.


## CSV классификатора доступен: Draft PR #31 и результаты проверки — 2026-11-16

Владелец предоставил Transfer_Servis_vehicle_whitelist_v1_draft _1_.csv после
предыдущего Git-поиска. Исходник целиком прочитан и побайтно сохранён в uber-v3,
ветка docs/vehicle-classifier-v1-20261116, docs/vehicle-classifier-v1.csv.
Draft PR: https://github.com/lobanov0710-blip/uber-v3/pull/31
Source f5716179b39ef4224c91cbf2378384dfc96032c3, Git tree
68a7454012979ee30ea0db92cb731289bdabb912 совпал с локальным индексом.
CSV SHA256 3f8297f7b750816e13a3ceb82182e10f33bc42cdc308feb8e8ae2f1fa27ecc7d.

116 строк / 39 марок: Комфорт70, Бизнес22, Минивэн24. Эконом отсутствует уже
в исходнике; удалено0 строк, изменено0 ячеек. Все статусы pending_approval.
19 документных проверок PASS; дополнительно JSON/локальные ссылки, append-only
журнал, Git diff whitespace с учётом CRLF и exact remote/local tree проверены.
Формульных префиксов, управляющих символов, дублей/пустых обязательных полей
не обнаружено. Полная методика/ограничения: docs/VEHICLE_CLASSIFIER_REVIEW_2026-11-16.md
и одноимённый JSON в PR31. Это не тесты runtime/APK и не утверждение допуска.

Belgee/TENET отсутствуют в утверждённом справочнике140 марок; их включение
увеличит состав до142 и требует решения владельца. EXEED/Exeed, Skoda/Škoda
и FAW/Bestune B70 требуют согласования обозначений перед внедрением.
13 примечаний с ограничениями сохранены; они не реализованы как правила.
Утверждение116 связок тариф/модель/минимальный год/примечание ещё не получено.
Марки, годы и тарифы по предположению не менялись. Предыдущий результат поиска
остаётся историческим: новый источник получен отдельно от проверенных веток.

При публикации первоначальный полный JSON журнала превысил лимит stdout;
парсер остановился до remote mutation. Повтор использовал remote base и
append-only delta; Git tree совпал. update_ref новой ветки вернул422 Reference
does not exist без изменения ref; затем использован create_branch на проверенный
commit. Публикация Draft PR31 завершена; scope — четыре документа, без удаления
старых строк журнала. Секреты/персональные данные не публиковались.

Код/API/БД/dependencies/реальные автомобили/phone whitelist не менялись.
Справочник140 не расширен автоматически, CSV не подключён к допуску.
G1paused, D4–D7pending; APK/runtime/live E2E/merge/deploy не выполнялись.
Следующий зависимый шаг: решение владельца по конкретным строкам и двум маркам.


## Предложены 15 дополнительных китайских моделей: порог2023 выбран владельцем — 2026-11-16

Владелец спросил о добавлении других китайских марок для Комфорта и Бизнеса.
Подготовлено предложение15 моделей: Комфорт6 (BAIC X7, Dongfeng Huge,
Forthing T5 EVO, JAC JS6, Bestune T90, Lynk & Co08), Бизнес9 (Exlantix ES,
NIO ET7, IM Motors L7, Luxeed S7, Stelato S9, Avatr12, Zeekr001, Xpeng P7,
Xiaomi SU7). Все15 марок присутствуют в утверждённом справочнике140.
Допуск моделей и предложенные условия ещё pending, утверждение марок не
использовалось как разрешение всех их моделей. Эконом не добавлялся.

На вопрос о подготовке порога года владелец выбрал «Единый порог: 2023 год».
Это решение для предложения15 новых строк; годы исходных116 не изменены.
Это не утверждение самого допуска/условий/внедрения и не год запуска модели.
В docs/vehicle-classifier-v2-proposed.csv сохранены исходные116 и добавлены15
pending_approval: 131 total, Комфорт76/Бизнес31/Минивэн24. Исходный v1 побайтно
не изменён и является точным префиксом v2; hash v1
3f8297f7b750816e13a3ceb82182e10f33bc42cdc308feb8e8ae2f1fa27ecc7d,
hash v2 eb175c7fa79a33ca3a6ee6546b717178b84722771ddbba408b7610ba734ebd99.
Все131 статуса pending. Предыдущее утверждение116 и Belgee/TENET не получено.

Предложение/первичные ссылки/условия/ограничения сохранены в
VEHICLE_CLASSIFIER_CHINA_EXTENSION_PROPOSAL_2026-11-16.md и JSON.
Производители подтверждают модели и описывают версии, а не тариф Transfer Servis.
Очная проверка посадки/второго ряда/комплектации не выполнялась; для Avatr12/
Zeekr001 отдельно предложено согласовать кузов. Новые требования D6 не введены.
Текущая веб-страница не доказывает оснащение каждого автомобиля2023 года.

18 документных проверок PASS; дополнительно Markdown/JSON/CSV parity,
hashes/local links проверены. API/code/DB/runtime/реальные автомобили/140makes/
phone whitelist не менялись. APK/runtime/live E2E/merge/deploy не выполнялись.
G1paused/D4–D7pending. Отобранные официальные источники указаны в таблице;
первый URL T90 был недоступен, правильная страница найдена с official home.
EXLANTIX ES перенаправлен с exeed.ru на esteo.ru; Zeekr007 дал только JS shell
и в предложение не включён. Большие поисковые ответы усекались в выводе;
целевые источники прочитаны отдельно. Access/security обходы не выполнялись.

Предложение опубликовано в существующем Draft PR31 (7 файлов документов).
Source 47dde60122dcb03734351c43c957603b8cca3291, tree 9aebdc3ed0510cec4fb8e267ba3f11366fd317e0.
Локальный индекс и remote tree совпали; scope нового commit — 4 docs файла,
без удаления старых записей и без изменения v1 CSV. Утверждение моделей pending.


## Владелец утвердил 15 китайских дополнений и условия — 2026-11-16

На прямой вопрос «Утверждаете эти 15 дополнений и предложенные условия?»
владелец ответил «Утверждаю». Утверждение относится к опубликованному предложению
47dde60122dcb03734351c43c957603b8cca3291, SHA256 CSV до решения
 eb175c7fa79a33ca3a6ee6546b717178b84722771ddbba408b7610ba734ebd99.
Состав: Комфорт6 — BAIC X7, Dongfeng Huge, Forthing T5 EVO, JAC JS6,
Bestune T90, Lynk & Co08; Бизнес9 — Exlantix ES, NIO ET7, IM Motors L7,
Luxeed S7, Stelato S9, Avatr12, Zeekr001, Xpeng P7, Xiaomi SU7.
Порог всех15 — 2023, перечисленные условия утверждены и сохранены.

В docs/vehicle-classifier-v2-proposed.csv ровно15 pending_approval заменены на
approved; для этих15 notes обозначают утверждённые условия и проверку конкретного
автомобиля. Марки/модели/годы/тарифы/сами условия неизменны. approved означает
решение владельца по модельному правилу, а не approved реального автомобиля.
Условие отдельного согласования кузова Avatr12/Zeekr001 не удалено молча.

Исходный v1 и первые116 байтовых строк v2 сохранены; 116 статусов остаются
pending_approval. Утверждение исходных116, добавление Belgee/TENET и прежние
расхождения обозначений не приписываются текущему ответу. Справочник140
не расширялся. В документе131 строка:76 Комфорт/31 Бизнес/24 Минивэн,
из них15 approved/116 pending. Эконом отсутствует.

Markdown/JSON дополнения получили точный ответ/дату/scope/source commit/hash
и статусы approved-15-model-rules-with-conditions. Старые18 checks предложения
сохранены исторически. Новые18 проверок PASS: v1 hash/116 исходных строк,
131/counts, ровно15 status transitions, точные pending/approved и6/9, minYear2023,
неизменность утверждённых полей/условий, только status/notes CSV, схема/required,
нет Эконома/дублей/формул/control chars, BOM/CRLF, conditions/parity/round-trip.
Дополнительно Markdown/JSON/CSV parity, ссылки, append-only журнал и whitespace
проверены. Hash v1:3f8297f7b750816e13a3ceb82182e10f33bc42cdc308feb8e8ae2f1fa27ecc7d;
hash v2 после решения:e394d8cea41376f16e2a35962b42af5de910ecb6a36bb70dca0847060768aa34.

Решение внесено в PRODUCT и план Android docs ветки и журналы проекта.
Утверждение15 правил/условий не используется как разрешение нового API,
подключения к runtime, merge или deploy. Код/API/БД/dependencies/реальные
автомобили/phone whitelist не менялись. Очная проверка автомобилей, APK/runtime/
live E2E не выполнялись. G1paused/D4–D7pending; merge/deploy не выполнялись.
Следующая зависимость полной таблицы — решения по исходным116 и Belgee/TENET;
новые15 правил повторного утверждения не требуют.

Решение опубликовано: backend source ba98b93285ade5706a64772d40b1f8d510d41387,
tree5bb547466a6c6694865b6ac49277522ef4029e6c; Android docs source
5e5f56db5e926a226a048993b47e970c4bf36c87, tree1b5542c3f5c40baa1d10aad3e3bbac99e35f0d8a.
Оба remote tree совпали с локальными индексами. Draft PR31/PR11 описания
обновлены по финальному scope; merge/deploy не выполнялись.


## Утверждены исходные116 правил и Belgee/TENET:131 правил/142 марки — 2026-11-16

Владелец прямо поручил: «Исходные 116 строк и добавление Belgee/TENET добавить
и утвердить». Это полное утверждение116 исходных связок тариф/марка/модель/
минимальный год/примечание в представленном виде и добавления двух марок.
Предыдущее утверждение15 дополнений/порога2023/условий действует без повтора.
В текущем docs/vehicle-classifier-v2-proposed.csv теперь131 approved/0 pending:
76 Комфорт,31 Бизнес,24 Минивэн. Эконом отсутствует. В первых116 строках
изменён только status; годы, марки, модели, тарифы и13 примечаний сохранены.
Ранее утверждённые15 строки и условия побайтно неизменны. Единый2023 относится
только к15 дополнениям, не заменяет годы исходных116.

CSV v1 остаётся неизменяемым архивом предоставленного вложения с первоначальными
pending statuses (не текущая нормативная таблица). Утверждение применяется к v2.
Hash v1:3f8297f7b750816e13a3ceb82182e10f33bc42cdc308feb8e8ae2f1fa27ecc7d.
Hash v2 до полного решения:e394d8cea41376f16e2a35962b42af5de910ecb6a36bb70dca0847060768aa34,
после:1e4955a6f7250f0e5183f99d105a5c5b235eaa51b7ee432e2f29ad2a69af4901.
Снимок перед решением: backend ba98b93285ade5706a64772d40b1f8d510d41387.

В справочник добавлены belgee/Belgee и tenet/TENET без новых aliases, в группу
regional_legacy для просмотра. Группы не определяют страну выпуска автомобиля.
Всего142, группы64/16/18/29/15; прежние140 записи и aliases неизменны.
Composition SHA256 прежнего140:20c245092f7299e051616d1ade2c71aab8bd233578c2f5c47edab721b54e6d46;
нового142:abc564d91b94a69e3c213f153fc2aa2179df74e992b226fe9f6a2e55178fd3b1.
Формат: UTF-8 compact JSON с sorted keys и records по id, поля id/name/group.
История первого утверждения140 сохранена. Названия EXEED/Skoda/FAW Bestune B70
утверждены в исходном виде: автоматической нормализации/объединения не было.
vehicleModelEligibilityApproved=true указывает только на131 утверждённое правило;
referenceMayNotServeAsVehicleAllowlist=true, класс из марки не выводится.

21 проверка полного CSV PASS;14 проверок справочника PASS. Проверены точные116
status transitions,131 approved, неизменность полей/годов/примечаний/15 строк,
структура/round-trip/BOM/CRLF, отсутствие Эконома/дублей/формул/control chars,
142 уникальные марки/ID, прежние140 данные, группы/190 search values/aliases,
составные hashes, JSON/CSV/Markdown parity, ссылки. Исторические проверки
предложения/частичного утверждения и snapshot поиска сохранены как исторические.
План, PRODUCT, документы/receipts и журналы обновлены по фактическому решению.

approved — статус модельного правила, не конкретного автомобиля. Проверки
конкретных автомобилей не выполнялись; условия, включая отдельное согласование
кузова Avatr12/Zeekr001, не удалялись. Подключение runtime/UI/API/aliases/search,
новые GET фотоконтроля, DB migration/реальные автомобили/phone whitelist не менялись.
APK/runtime/live E2E/merge/deploy не выполнялись. G1paused/D4–D7pending.
Повторное утверждение состава131 правил/142 марок не требуется.

Обычный git diff --check отметил CR в сохранённом CRLF CSV как trailing
whitespace. Повтор с cr-at-eol (остальные whitespace checks сохранены) PASS;
BOM/CRLF исходника не менялись, внешние пробелы в ячейках проверены отдельно.

Полное решение опубликовано: backend source562f4d52bc98f751874383dc14ee528013c0c4a2,
treec66cbc9ca6c9a5be2cdcb0a9734f47580172ecc9; Android docs source
3f9fad6f1be32b54674bdfe7bd56317e5d3760dd, treeabad017859ef912e4921f44295fc388a4ee4bf41.
Оба remote/local tree совпали. Draft PR31/PR11 описания обновлены по полному
решению131/142; executable code/merge/deploy не выполнялись.


## Продолжение плана: фотоконтроль подготовлен, требуется выбор объёма — 2026-11-16

На поручение «Продолжаем по плану» сверены AGENTS п.3, последние решения,
план/журнал, ТЗ §§14–15 и предложение следующего G2 среза.131 модельное правило
и142 марки утверждены полностью; повтор этого утверждения не запрашивается.
Следующий подготовленный срез — внеплановый фотоконтроль Admin. Два объёма
(каталог/список с2 GET либо действие из карточки регистрации без новых GET)
не выбраны владельцем. Прежний вариант A назначений и утверждение справочника
не использованы как разрешение новых GET. Рекомендуемый контракт полностью
подготовлен в G2_PHOTO_CONTROL_NEXT_SLICE_PROPOSAL_2026-11-16.md.

Независимая проверка выполнена на backend412591d0d633e25ead8596cb8121ea703f12ca09:
photoControlSupport.sqlite5 PASS и photoControlLifecycle.sqlite6 PASS,
failures/skipped/cancelled0, Node24.22.1. Семь source hashes совпали с предыдущим
readiness.2 из11 tests относятся к support. Проверены существующие service/SQLite
fixtures; новые GET, Android/native Worker, HTTP/MFA E2E, полная работа обоих
режимов на активной поездке не выполнялись и не заявлены PASS.
Новых дефектов этими проверками не воспроизведено; это не полный security audit.
В начальном rg был указан отсутствующий adminAssignmentService.js; повтор по
rg --files и действующим orderAssignment/availability/operational файлам выполнен.
Android поиск новых endpoint методов вернул0 совпадений, не сбой инструмента.

Readiness JSON обновлён с лог-хэшами и прежним историческим snapshot; план и
предложение согласованы с данными131/142. Общий каталог автомобилей требует
server IDs/revisions и не подменяется справочником марок/моделей. Код/API/БД/
реальные материалы/classifier runtime/phone whitelist не менялись. G1paused,
D4–D7pending; APK/runtime/merge/deploy/remote migrations не выполнялись.
Следующий зависимый шаг — явный выбор владельца из уже подготовленных вариантов;
до него реализация новых GET/UI не начата согласно AGENTS п.3.

Обновлённый checkpoint опубликован в Android docs source6f4e3caf0ce283bbcca086ccf9b9e18f48935796,
tree0fd686b3d670a755cb12d29aba2b63d71ffe0919; remote/local tree equality проверена. PR11 описание
актуализировано; прямой Git ref подтверждает новый head. Выбор следующего
объёма/контрактов владельцем пока не получен, merge/deploy отсутствуют.


## Владелец выбрал каталог и список: G2 реализация и backend CI — 2026-11-16

Ответ «Утверждают каталог и список» утверждает полный вариант G2 фотоконтроля
по proposal6f4e3caf0ce283bbcca086ccf9b9e18f48935796: два minimal GET, permissions/
MFA/no-store/audit/scoped paging и metadata/create Admin UI с указанными проверками.
Pending выбора в прежних записях теперь исторический; повтор не запрашивается.
Рабочие ветки arch/g2-admin-photo-control-read и arch/g2-admin-photo-control-ui,
Draft backend PR32 / Android PR12; merge/deploy отсутствуют.

Backend source080d4b49bb902d782efe2615d92bf05fa3d64dc6,
tree245d64159221583438201d2d51804064d8d45a60, CI43947136962/job133579673172 SUCCESS:
69 test scripts,12 новых SQLite/HTTP cases,18 migrations/12 preflight,
6 native Worker/D1 workflows,5 protected CLI scenarios,audit0 и Worker dry-run.
Локальный полный прогон останавливался на sandbox spawnSync EPERM; эти проверки
успешно выполнил CI, ограничения среды не обходились и tests не ослаблялись.
Первый новый test-run выявил недостающий SELECT result в SQLite D1 test adapter;
исправлено без изменения mutation semantics, CI подтвердил полный набор.

Дополнительная сверка ТЗ §15 воспроизвела старый дефект: immediate check
запрещал новые назначения, но не останавливал phase advance уже активного.
Исправлен atomic SQL NOT EXISTS nonpassed immediate для того же vehicle;
after_current_trip разрешает продолжить текущую поездку. Нет отмены заказа
или новых terminal правил. Регрессии двух режимов и service-to-batch race,
а также оба режима на native D1 прошли по новому source/CI выше.

Admin sourcea196387945c2966d8929cbee9f4983c1e5a2f859,
treea6d14387bccb3ac262c427179c4acba15d550ba8 — UI/test implementation, CI в работе.
9 новых JVM и14 native cases,10 native frames; PASS пока не заявляется.
Первый source-level independent review не нашёл session/permission blocker,
но отметил длинный spinner mode. SDK singleLine/fixed height подтверждён;
заменён native multiline wrap/min48dp, компактная identity summary сохраняет
в подтверждении vehicle/основание/полный режим/причину. Нужны final CI/PNG/review.
Проверяются current session/grants/MFA перед GET/POST, immutable uncertain intent,
явный same-key retry, ACK/revision и onStop очистка. OWNER-only routes404/entryhidden.
Классификатор131/142 не активирован в runtime. G1paused/D4–D7pending,
реальные материалы/биометрия/R2 E2E/phone scope/merge/deploy не выполнялись.


## G2 Admin: финальная передача утверждённого каталога/списка фотопроверок — 2026-11-16

Решение владельца «Утверждают каталог и список» выполнено в отдельных
Draft PR12 (TransferDriver) и PR32 (uber-v3). Metadata GET/каталог/история/
явное complaint/manual назначение с подтверждением, session/revision/permissions/
OWNER MFA/audit/no-store и foreground-only/no-auto-replay guards реализованы.

Backend code080d4b49bb902d782efe2615d92bf05fa3d64dc6 / tree245d64159221583438201d2d51804064d8d45a60:
CI43947136962/job133579673172 SUCCESS:69 npm test scripts,12 новых SQLite/HTTP
cases,18 migrations/12 preflight,6 native Worker/D1 workflows,5 protected CLI
scenarios, dependency audit0 и bundle dry-run. Прежний immediate phase bypass
воспроизведён/исправлен atomic SQL и проверен включая race; after_current_trip
сохраняет продолжение текущей поездки, заказ не отменяется.

Android codea0308bec394cd28d821f52bbcfdc05e5e09f4be7 / treed6de5082865d0932c2e754bffb2fd78dc179b951:
CI43950844261/job133592621453 SUCCESS.318 JVM executions (Driver48×3/Admin58×3),
99 native cases (Driver38/Admin61),6 build/lint variants и security/variant gates.
Новые9 JVM×3 и15 native cases. Предыдущие Android runs43948185690/43949225817
отменены после fixes; их не выдаём за проверку финального source. Sandbox
socket/spawn EPERM не обходились: необходимые native/CLI проверки исполнил CI.

APK artifact14270860090 и native artifact14267604781 загружены, ZIP SHA256
сверены с GitHub digest, CRC/path/size PASS;28 PNG, из них10 нового среза.
Все10 actual PNG независимо просмотрены documenter/reviewer, их hashes сверены
с CI logs. Режимы/подтверждение/uncertain читаемы light/dark font1.3. Spinner
обрезание и P3 неверное сообщение expired MFA исправлены и закрыты финальным
source/runtime/visual evidence; блокирующих замечаний нет. Reviewer SHIP только
для утверждённого component/synthetic среза. Полный G2/live/phone/release не принят.

Финальные docs-only [skip ci] checkpoints:
TransferDriver 59342d8ea55580f0c73e7b28e337b8f46d7cd138; backend 9b2fae5b81dc75fdf5eae7962352915a4a9616f9.
Они изменяют документацию, не проверенный code; local/remote staged tree parity
и file scope проверены. PLAN/PRODUCT/readiness сохраняют исторические pending
записи, но ссылаются на актуальный ADMIN_PHOTO_CONTROL_VERIFICATION_2026-11-16.json
и HANDOFF. Первый локальный JSON payload публикации встретил shell warning;
remote изменений не было; исправлено login=false, повторная tree parity PASS.

G1paused, D4–D7pending; OWNER-only whitelist не расширен (operational404/hidden).
Нет merge/deploy/remote migrations/private photo/R2/biometrics/live phone E2E.
CI debug signing identity временная; phone APK upgrade совместимость не проверена.
Старые Driver lint warnings не объявлены исправленными. Утверждённые131 правила/
142 марки неизменны и не активированы в runtime. Следующий зависимый объём
не выбирается за владельца.
