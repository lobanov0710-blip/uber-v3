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


## 2026-11-15 — G2 availability/manual assignment: следующий срез, без возобновления G1

Владелец поручил «далее». По принятой последовательности после анкеты/автомобилей
начата Driver availability в отдельной arch/g2-availability-assignment от
проверенного registration checkpoint. ТЗ §§16–18 и D3: выбор одобренного авто
перед on_line, нижний slider, Радар активен только по backend state, off_line
перед сменой и запрет смены при активном назначении. Реальные Driver routes на
OWNER-only STAGING не открываются; D4–D7/G1/merge/production решения не меняются.

Driver реализован по существующим GET /v1/driver/me и PUT /v1/driver/availability:
independent availability.revision, Idempotency-Key, исходный staff/access/refresh
и lifecycle epoch; без auth refresh/HTTP replay/optimistic radar. Off_line
сохраняет activeVehicleId, не очищает его при активной assignment. Нет approved
авто/identity/revision — нет локального разрешения on_line; окончательный допуск
и busy/photo checks серверные. Неизвестный результат требует explicit GET.
Background удаляет snapshot/выбор и инвалидирует операции; поздний auth callback
не начинает availability network вне STARTED lifecycle. Нативный main footer
сворачивается online и размещён с учётом system bars/IME; keys/data не пишутся
в SavedState/autofill/logs.

Admin read-контракт ещё не выбран. Подготовлено
ADMIN_ASSIGNMENT_READ_API_PROPOSAL_2026-11-15.md version2 и async вопрос A/B.
Ошибка первоначального анализа: GET /orders НЕ запрещён OWNER/DISPATCHER из-за
роли. core/adminAuthorization.js и AdminSession подтвердили legacy auth category
admin с отдельными server operational role/permissions; неверное утверждение
отозвано, предложение и вопрос исправлены ДО реализации API. Действительные
пробелы: нет selection snapshot driver+vehicle; legacy orders extra PII и cutoff
1000 без cursor. A:2 минимальных paginated GET; B:1 options GET + старый список
с явными ограничениями. Пока решения нет, зависящие endpoints не реализуются;
RAW ID/revision ручной ввод или новые moderation grants не используются как обход.
Основание — AGENTS.md п.3, новые детали требуют явного решения владельца.

Локально debug build/instrumentation compile/48 Driver JVM и lint PASS:
0errors/54 прежних warnings. Driver7+Admin5 security guards PASS. Backend
availability service/repository/actualSQLite(7cases) и assignment service/
repository/migration —6 scripts PASS. Backend code/API/schema не менялись.
Добавлены5 JVM availability boundary cases и11 native protocol/lifecycle/UI cases
(включая настоящий Slider swipe и TalkBack setProgress). Runtime пока не запускался.
Native main XML/panel тестируется в отдельном secure host с synthetic transport;
это layout/component evidence, не live Main login/orders routing. Немокированная
сеть запрещена test-only guard; никаких production test hooks/реальных данных.
Screenshot fixture временно clear/restore FLAG_SECURE только в test APK.
CI запланирован с8 fixed PNG paths/validator marker и regression обеих apps.

При предыдущей попытке tooling прерван пользователем во время запуска compile:
изменения теста сохранились, compile log не появился. После «Далее» состояние
сверено, сборка запущена заново и завершилась PASS(42s). Это не отмена G2 и
не утверждение pending Admin API. Окончательный runtime/visual verdict ожидаются.


### Availability runtime1: неверный вызов accessibility provider в test fixture

Source208ebfad4235f1ab5f29396347083c941bf2647c, CI43752677606/job132929903193:
FAILURE на Driver connected.11 новых cases реально выполнены:4PASS (включая
настоящий Slider swipe и выбор другого авто),7FAIL в общем onlineAction helper.
Старые27 Driver cases PASS; Admin runtime ещё не запускался. Build/unit/lint
этап прошёл. Никакой визуальный/полный runtime PASS пока не заявляется.

По actual locked Material1.14/AndroidX core1.18 bytecode проверено: метод
AccessibilityNodeProviderCompat.performAction у wrapper возвращает false,
не делегируя обёрнутому framework provider. Test вызывал этот stub из
ViewCompat.getAccessibilityNodeProvider; это неверная тестовая точка входа.
Исправлено на slider.getAccessibilityNodeProvider().performAction, то есть
реальный Android virtual-thumb ACTION_SET_PROGRESS. Assertions, ожидаемый
backend state/допуск/одиночная отправка и реальный swipe case сохранены.
Production app code не меняется; новый instrumentation compile/CI ожидаются.


### Возобновление после tooling interruption; проверка через утверждённый CI

После команды «Продолжаем» сверены git status/test helper/logs. Исправленный
framework provider вызов сохранился, но предыдущая попытка compile log не
создала: tooling была прервана до команды. Локальный повтор без дополнительных
разрешений, с --offline, завершился до compilation: Gradle FileLockContentionHandler
не смог определить usable wildcard IP. Это sandbox/network limitation служебного
сокета, не ошибка Java и не успешная локальная компиляция. Sandbox/сетевые
настройки не менялись. Следующая полная проверка — существующий авторизованный
GitHub CI build/runtime pipeline; результат будет привязан к новому source.
Локальная предыдущая variants сборка staging/release/unit/lint PASS(3m15s),
но она предшествовала test-only correction. Admin read API всё ещё не выбран;
команда продолжения не трактуется как новое утверждение A/B.


### Availability runtime2: реальный lifecycle вместо ручного onStop в fixture

Source87b0acb949b31acffd3aa83b7e8e143ed1f01045, CI43774408323/job132997285290:
FAILURE на одном из11 новых native cases.10PASS, включая настоящий swipe,
framework accessibility action, отсутствие optimistic radar, ack loss/late401.
backgroundClearsVehicleAndInvalidatesPendingOperation ожидал GONE, получил
VISIBLE. Build/unit/lint этап PASS; общий runtime/visual acceptance не объявлен.

Fixture вручную вызывал Instrumentation.callActivityOnStop. Такой вызов метода
не воспроизводит framework Activity lifecycle transition/ON_STOP Registry,
к которому подписан DefaultLifecycleObserver панели (наAPI35 dispatch через
pre-stopped callbacks). Прежний Registration тест собственный onStop проверял
напрямую, но это не корректный lifecycle тест observer-компонента.

Fixture теперь запускается ActivityScenario и переводится moveToState(CREATED);
дополнительно assert фактического Lifecycle.State.CREATED перед проверкой
GONE/empty vehicle/FLAG_SECURE. Teardown закрывает scenario; сброс выбора и
инвалидация незавершённой mutation, assertion count/таймауты не ослаблены.
Production Java/XML/security policy не меняются, новый полный CI обязателен.


### Privacy review: исключение availability subtree из Autofill

Обнаружено несоответствие source/scope формулировке: saveEnabled=false не
отключает Android Autofill. Новый Spinner мог участвовать в Autofill structure
со списком автомобилей, хотя локальное сохранение/Parcel уже исключено.
Исправлено root importantForAutofill=noExcludeDescendants для availability
subtree (API26, соответствует minSdk), не затрагивая TalkBack/slider accessibility.
Это не утверждение фактически произошедшей утечки; устранена возможность
непредусмотренной передачи новых полей autofill service. Новых permissions/
SDK/dependencies нет. Требуется compile/runtime нового source; текущий CI
проверяет предыдущий source, его результат не будет выдан за эту правку.


### Availability runtime3: проверка очищенных данных вместо cached Spinner count

Sourcef15aa56a0af983bd8330544ef955af8f1fe600f9, CI43775678761/job133001307324:
FAILURE в одном из11 новых native cases.10PASS; фактический lifecycle CREATED
и GONE уже подтверждены. Background case затем ожидал getCount=0, получил3.
Проверен AOSP android-15.0.0_r1 AbsSpinner.setAdapter/resetList/getCount и
AdapterView.getSelectedItem: null adapter удаляет selection/children, однако
mItemCount в этой ветке не сбрасывается. Числовой cached count не означает
сохранение списка автомобилей. Тест проверяет фактические privacy условия:
null adapter, null selectedItem, null selectedView, CREATED/GONE/FLAG_SECURE,
отмену одного pending PUT. Assertions на данные сохранены, timeout не увеличен.
Добавлен assert importantForAutofill=NO_EXCLUDE_DESCENDANTS. Новый source включает
ранее найденную privacy XML правку; build/unit/lint/runtime будут проверены CI.
Локальная Gradle compilation остаётся ограничена sandbox service socket;
повторные запросы сетевых разрешений не используются для обхода ограничения.


### 2026-11-16 — Availability CI PASS и независимый UI review: fix

Source12fd1c216d7284f783f28f527820d5ff0d93eafa/tree4f6e65daeb5a9f825239d413d442820f1eaa9320,
CI43776899566/job133005125151 SUCCESS. Реально выполнены246 JVM (Driver48×3,
Admin34×3) и67 API35 runtime (Driver38, Admin29), skipped/failures отсутствуют.
Полные6 lint suites/builds/endpoints/AppCheck/package/signing/UID/security guards
PASS. Это включает XML Autofill fix и все11 новых availability native cases.
Local7+5 security guards PASS. Локальный текущий compile не заявляется из-за
sandbox service socket; CI — фактическая проверка текущего кода.54 старых Driver
lint warnings известны из предшествовавших локальных6 suites, не объявляются
устранёнными; CI lint PASS сам по себе не даёт новый warning count.

Artifact14186633067,876738bytes, SHA256
eb14a3425dc519a2e33a956e7b8d90e35ddaf1e1aebc71c34be623e57242c951:
8 actual native PNG1080×2400 проверены signature/IHDR/CRC/IEND и archive digest,
просмотрены. Это component/layout evidence в secure host с synthetic transport,
не live Main auth/orders routing. FLAG_SECURE clear/restore — только test APK.

По требованию Impeccable new-work §7 запущен независимый fresh reviewer без
истории. Harness не позволяет выбрать shipped agent type: generic agent использовал
fallback finish-reviewer contract, native platform/craft-floor,5 sections.
Disposition fix: панель fits offline/online light/dark/font1.3; initial system
bars имеют неверный контраст (offline-light status white, offline-dark nav black),
в online captures контраст правильный. Это window/host integration finding,
не clipping нового компонента; полная UI acceptance пока не заявляется.

Проверен locked AndroidX core1.18 bytecode Impl30.setAppearanceLight: wrapper с
Window пишет legacy decorView flags, а wrapper без Window вызывает platform
setSystemBarsAppearance. ДляAPI30+ MainWindow теперь явно использует platform
appearance, API26–29 сохраняет compat path. Это исправляет прямую настройку
контраста; точная причина compositor timing по одним PNG не установлена.
Fixture перед снимком проверяет window focus и platform appearance mask, затем
ждёт UI idle вместо произвольного250ms; состояние не подменяет. Все4 native
captures будут заменены по тем же путям и возвращены тому же reviewer для scoring
единственного замечания. Новый source/full CI и actual screenshots обязательны.
G1paused, Admin A/Bpending; deploy/merge/backend code/schema не меняются.


### Availability visual fix round1: CI PASS, scoring PARTIAL

Source800065ead78621e62b10a0ad78e083a4635d8a00/treea3a842095e7bd7807c44583087a2fc489245e209,
CI43778224200/job133009304957 SUCCESS:246 JVM+67 runtime, full6 lint/builds и
security/endpoint/signing/UID guards PASS. Artifact14187751524,876930bytes,
SHA256d02ea094bb90c75f914b485f715c76edf72458822ad8e9a4770bf41e8905ddf3;
8 PNG validated,4 availability replacements inspected. Same reviewer scoring:
PARTIAL, disposition fix. Light status icons и dark navigation handle исправлены;
на первом dark offline capture Wi-Fi/notification icons остаются black, в
следующем online — white. Единственное замечание contrast остаётся открытым,
UI ship не заявляется. Platform appearance/focus assertions прошли, однако
они и accessibility idle не доказывают завершённый render всех SystemUI layers.

Round2 меняет только screenshot synchronization: перед сохранением требуется
не менее1s одинаковых actual native framebuffers (poll200ms, bounded8s).
Никакого ожидания желаемого цвета, recolor/crop/image generation, принудительных
OS/theme/demo icon settings либо изменения server offline state нет. Если
неверный цвет устойчив, он попадёт в PNG и reviewer сможет снова отклонить.
Точная причина SystemUI частичного tint по PNG не доказана; это проверка
устойчивого состояния compositor, не утверждение об исправленном production баге.
Production Java/XML остаются source800065e; окна/FLAG_SECURE/security guards
не ослабляются. Новый CI,4 замены по тем же путям, same-reviewer scoring требуются.
Если второй verdict оставит замечание, по Impeccable §7 будет предъявлен владельцу
открытый результат и выбор дальнейшего раунда; бесконечный polish не выполняется.


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


### 2026-11-16 — Владелец утвердил Admin assignment read API, вариант A

Явное сообщение: «Вариант A утверждаю». Утверждена версия2 предложения
ADMIN_ASSIGNMENT_READ_API_PROPOSAL_2026-11-15.md: два минимальных paginated GET
orders и assignment-options, server permissions/OWNER MFA, read audit без PII.
Создана отдельная arch/g2-admin-assignment-read от проверенного backend checkpoint.
Реализация и тесты ведутся локально; успешные проверки ещё не заявляются.
G1paused, ADMIN_PHONE_TEST_ONLY, D4–D7 и запрет merge/deploy сохраняются.
Сверка actual SQL уточнила старую формулировку «atomic busy»: текущая схема
ограничивает current assignment по order_id, а не произвольное число будущих
назначений водителя. Новые scheduling/ranking/занятость критерии D6 не вводятся.
Read snapshot остаётся advisory, mutation повторяет собственные current guards.

Сверка также выявила реальную ошибку D3: assignment eligibility/atomic UPDATE
проверяли profile/vehicle, но не active driver account. Согласно утверждённому
ТЗ account active обязателен. Добавляется role=driver/status=active в общий
eligibility и оба atomic UPDATE assign/reassign, без новых критериев D6.
Read/mutation используют общий список blocker codes; отдельные SQLite тесты
проверят disabled/suspended и race после precheck. Это исправление действующего
требования, не изменение выбранного варианта или схемы/permissions.

Первый новый SQLite/HTTP прогон:14/15 PASS,1 FAIL в assert audit-count race
reassign. Assertion использовал неверный action prefix, тогда как реальный
audit исходного assign уже существовал. Заменён на сравнение фактического
общего count до/после отклонённой операции; rollback assertions сохранены.
MFA fixture также ставит тестовое время ДО создания session, чтобы401
проверял отсутствие MFA, а не случайно просроченный JWT. Добавлен переход
keyset через два автомобиля одного водителя и следующего водителя.
Второй прогон14/15 PASS: новая multi-driver fixture использовала INSERT SELECT
без списка колонок, не учитывая17-column актуальную staff_accounts. Исправлен
явный список13 нужных колонок; production SQL и схема от этого не меняются.

Local full npm test дошёл до OWNER control-plane CLI: два старых child_process
теста остановились из-за sandbox spawnSync EPERM (stdout/stderr пустые),
не из-за нового API. Прямой --help работает. Miniflare local-native check
также остановлен sandbox listen EPERM127.0.0.1. Защита не ослабляется; full suite/
реальный workerd/D1 будут выполнены утверждённым CI.18 migrations и12 staging
preflight tests локально PASS, новый read suite15/15 PASS.

До публикации устранён N+1 для options: единый paginated SELECT использует
общую с mutation SQL eligibility projection. Это сохраняет одинаковые правила
фотоконтроля и снимает риск превышения D1 query budget на limit50; новые
критерии не добавлены. Требуется повтор meaningful read/assignment regression.

После общего SQL projection новые15 read cases и8 связанных assignment/auth/
privacy/CORS suites PASS. Dry-run Wrangler локально остановился на недоступном
global config path, до bundle/deploy; успешная Wrangler сборка не заявляется.
Native smoke и dry-run остаются обязательными в CI, без изменения sandbox или
запроса пользовательских credentials. Новых runtime dependencies нет.


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


## Получен CSV классификатора: 116 строк проверены, допуск ожидает утверждения — 2026-11-16

После прежнего поиска владелец приложил Transfer_Servis_vehicle_whitelist_v1_draft _1_.csv.
Источник доступен и прочитан целиком. В отдельной docs/vehicle-classifier-v1-20261116
на основе проверенной backend work tree ad91ac2d6030e1f673442d3840f72af5982eed8a
сохранён docs/vehicle-classifier-v1.csv. Прежние результаты Git-поиска остаются
историческим snapshot: вложение предоставлено после них.

Файл 6954 bytes, UTF-8 BOM, semicolon, CRLF; SHA256 исходника и копии
3f8297f7b750816e13a3ceb82182e10f33bc42cdc308feb8e8ae2f1fa27ecc7d.
116 строк / 39 марок: Комфорт70, Бизнес22, Минивэн24. Эконом уже отсутствует,
удалено0 строк. Все116 статусов pending_approval сохранены. Ни один тариф,
год, модель или примечание не изменён по догадке; предоставление draft CSV
не считается утверждением всех модельных правил.

Обнаружены2 отсутствующие в утверждённом справочнике140 марки: Belgee и TENET.
EXEED/Exeed и Skoda/Škoda отличаются отображением. FAW / Bestune B70 требует
подтверждения обозначения, поскольку справочник различает FAW и Bestune.
13 примечаний содержат дополнительные условия; они не реализованы как допуск.
Решения вынесены в docs/VEHICLE_CLASSIFIER_REVIEW_2026-11-16.md;
машиночитаемый receipt — одноимённый JSON. Справочник140 не изменён.

19 документных проверок PASS: strict CSV/schema/ширина/counts/три тарифа/
нет Эконома/pending statuses/обязательные поля/year syntax-range/duplicates/
whitespace/control chars/formula prefixes/BOM-CRLF/notes/round-trip/brand audit.
Копия побайтно равна исходнику. Production years/комплектации/бизнес-допуск
не объявлены проверенными. Чтение CSV-документа не исполняет его содержимое.
На этапе восстановления инструментов попытка сохранить function в serializable
store завершилась serialization error до какой-либо мутации; повтор выполнен
без сохранения функции. Новых секретов/персональных данных в документах нет.

Executable code/API/schema/dependencies/реальные автомобили/phone whitelist
не менялись. APK/runtime/live E2E не запускались для документа и не заявлены PASS.
G1paused, D4–D7pending; merge/deploy не выполнялись. Следующий зависимый шаг —
решение владельца по116 связкам модели/года/тарифа/примечаний и расхождениям марок.

При подготовке публикации полный JSON с большим журналом был усечён лимитом
вывода; парсер остановился до remote mutation. Для повторной подготовки выбран
исходный remote journal плюс локальная append-only запись; проверяется Git tree.


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

Финальная сверка receipt: общий approval.scope явно указывает All131,
последнее поручение сохранено как ownerAnswer; первая запись Exactly15
сохранена отдельно как additional15Approval с вопросом/source/hash. Это
устраняет неоднозначность области двух решений, без изменения CSV/состава/условий.
JSON scope/history consistency PASS.


## Утверждён следующий G2 срез: каталог автомобилей и список фотопроверок — 2026-11-16

На вопрос об утверждении варианта «Каталог и список проверок» по подготовленному
предложению владелец ответил «Утверждают каталог и список». Утверждён вариант
с2 GET по G2_PHOTO_CONTROL_NEXT_SLICE_PROPOSAL_2026-11-16.md, source
6f4e3caf0ce283bbcca086ccf9b9e18f48935796: метаданные/permissions/MFA/audit/
scoped cursor/параметры/UX назначения и проверки. Отдельный повтор не требуется.
Созданы изолированные arch/g2-admin-photo-control-read (backend) и
arch/g2-admin-photo-control-ui (Android). Merge/deploy не выполняются.

Backend: добавлены GET /v1/admin/vehicles и GET /v1/admin/vehicles/{id}/photo-checks.
Проекция исключает VIN/телефоны/имена/причины/photos/storage keys; чтение
проверяет актуальные vehicles.read (+vehicles.verify для списка проверок),
OWNER server MFA, строгие параметры/IDs/безопасные integer. Keyset limit1–50,
cursor scoped к фильтру/vehicle, audit без произвольного текста; ошибка audit
не выдаёт проекцию. Две SELECT для vehicleRevision/check page выполняются batch.
OWNER-only staging остаётся404. Действующие mutations сохраняются.

Новые9 SQLite/HTTP тестов PASS, миграции18 PASS, D3 preflight12 PASS.
Первый прогон новых tests выявил неполную SQLite D1 test adapter реализацию:
batch SELECT не возвращал rows, и проверка requestId ошибочно применялась к
старому staff/login. Адаптер дополнен чтением SELECT в той же транзакции,
проверка requestId ограничена v1; повтор9/9 PASS. Новый native workerd/D1
workflow добавлен для CI на реальном D1 adapter. Первые поиски упомянули
отсутствующие scripts Android и migration/adminAssignmentService имена;
пути уточнены через существующее дерево. Большой первый read был усечён,
зависимые фрагменты прочитаны отдельно.

Полный npm test локально дошёл до ownerMfaControlPlaneCli, где sandbox
spawnSync возвращает EPERM с пустыми потоками (подтверждено безопасным --help).
Эти checks не объявляются PASS и не ослабляются/не пропускаются; полный
прогон и native Worker/D1 выполняются в GitHub CI. Локальная Android/Gradle
socket граница известна ранее; сборка/lint/runtime выполняются через штатный CI.
Данные131/142 не меняются; G1paused/D4–D7pending, phone whitelist неизменён.
Реальные фото/private R2/biometrics/remote migrations/merge/deploy не выполнялись.


## Исправлена немедленная блокировка переходов активного назначения — 2026-11-16

После первого backend CI43945819112 SUCCESS по b9e6164bea8d026ec8aa5901002e5a06ebd414bc
дополнительная сверка ТЗ §15 выявила воспроизводимый дефект старого phase SQL:
при pending immediate фотопроверке активное назначение en_route_to_pickup
продолжало переход arrived. Новый regression до исправления получилtrue вместоfalse.
В atomic assignment UPDATE добавлен NOT EXISTS незавершённого immediate check
для того же vehicle. Заказ не отменяется; after_current_trip и monthly не
блокируют продолжение активных фаз. Уже существующее terminal завершение
не изменялось. Условие проверяется в той же SQL mutation, включая race между
service read и batch. Никаких новых состояний/таймаутов/политик не введено.

Добавлены2 проверки различия режимов и1 race regression; native D1 harness
проверяет оба режима на SQL реального workerd/D1. Следующий CI должен подтвердить
новый source; первый успешный run не заявляется проверкой этого исправления.


## Backend G2 фотоконтроль: финальный code CI PASS — 2026-11-16

Source080d4b49bb902d782efe2615d92bf05fa3d64dc6/tree245d64159221583438201d2d51804064d8d45a60,
CI43947136962/job133579673172 SUCCESS. Полный npm test, dependency audit0,
migrations18/preflight12,12 новых SQLite/HTTP tests,6 native Worker/D1 workflows
(включая vehicle/check lists и оба restriction modes),5 protected CLI scenarios
и Worker dry-run PASS. Локальный EPERM не обходился; эти проверки выполнил CI.
Исправление immediate подтверждено новым CI, не старым baseline run.
Receipt ADMIN_PHOTO_CONTROL_VERIFICATION_2026-11-16.json содержит exact source
hashes/run/job/границы. Android UI ещё проверяется отдельно; общий G2/live E2E
не объявлены завершёнными. Merge/deploy/phone scope/real materials неизменны.

Independent documenter отметил устаревшую общую pending формулировку в конце
ADMIN_PHOTO_CONTROL_READ_API.md после backend CI. Исправлено: подтверждённый
backend отделён от ещё проверяемого Android; значения source/run/counts точные.


## G2 каталог и список фотопроверок: проверенный component/synthetic срез — 2026-11-16

Утверждение «Утверждают каталог и список» реализовано в Draft PR12 (Android)
и PR32 (backend): безопасные metadata GET, каталог/история/явное создание
manual/complaint с подтверждением режима и причины, актуальными правами/MFA,
контролем ревизий и сессии, без автоматического повторения mutation.

Backend code080d4b49bb902d782efe2615d92bf05fa3d64dc6,
tree245d64159221583438201d2d51804064d8d45a60,
CI43947136962/job133579673172 SUCCESS:69 npm test scripts,
12 новых SQLite/HTTP cases,18 migrations/12 preflight,6 native Worker/D1
workflows,5 protected CLI scenarios, dependency audit0 и bundle dry-run PASS.
Исправлен воспроизведённый прежний immediate bypass перехода активной поездки;
atomic SQL также проверен при race. after_current_trip сохраняет текущую поездку.

Android codea0308bec394cd28d821f52bbcfdc05e5e09f4be7,
treed6de5082865d0932c2e754bffb2fd78dc179b951,
CI43950844261/job133592621453 SUCCESS:318 JVM executions (48×3 Driver,
58×3 Admin),99 native cases (38 Driver/61 Admin),6 build/lint variants и
security/config/variant gates PASS. Новые9 JVM cases ×3 и15 native cases.
Предыдущие Android runs43948185690/43949225817 отменены после исправлений,
не считаются финальным PASS. Локальные sandbox socket/spawn EPERM ограничения
не обходились; полноценные native/CLI проверки выполнены штатным CI.

Артефакты точного Android source загружены, ZIP CRC/path/size и GitHub SHA256
проверены: native artifact14267604781 содержит28 PNG, APK artifact14270860090.
Все10 новых native кадров просмотрены независимыми documenter/reviewer,
их SHA256 независимо совпали с CI logs. Светлая тема и dark/font1.3 читаемы;
полные режимы перенесены, подтверждение содержит автомобиль/основание/режим/
причину/действия. Reviewer: SHIP только для утверждённого component/synthetic
среза, подтверждённых blockers нет. Spinner finding закрыт кодом/кадрами;
MFA UX finding закрыт guard/очисткой и выполненным native regression.
Сокращение toolbar title при font1.3 не скрывает операционную информацию.

Receipt ADMIN_PHOTO_CONTROL_VERIFICATION_2026-11-16.json фиксирует проверенный
code SHA/tree отдельно от последующих docs-only commits. Исторические pending
записи и readiness11 не являются актуальным статусом реализации.
G1paused/D4–D7pending; OWNER-only operational whitelist не расширен (404/hidden).
Нет merge/deploy/remote migrations/реальных материалов/R2/биометрии/live phone
E2E или полного закрытия G2. CI debug подпись временная; обновление уже
установленного телефонного APK не проверялось. Прежние Driver lint warnings
не объявлены исправленными. Утверждённые131 правила/142 марки не менялись и
не активировались в runtime. Следующий зависимый шаг не выбирается за владельца.

При подготовке docs-only публикации первый локальный JSON payload был
отклонён парсером из-за предупреждения оболочки перед JSON. Изменений remote
на этом шаге не было. Повтор с login=false дал корректный payload; создаваемые
GitHub trees побайтно совпали с локальным staged tree. Код/проверки не изменены.


## Решение владельца: Li Auto L7/L9 и тип силовой установки — 2026-11-17

Владелец: если L7/L9 только электромобили — исключить, если гибрид, дизель
или бензин — изменить правила. Официальные материалы Li Auto подтверждают
для изученных L7/L9 гибридную схему с 1,5-литровым бензиновым ДВС-генератором:
https://ir.lixiang.com/news-releases/news-release-details/li-auto-inc-launches-li-l7-five-seat-flagship-family-suv
https://ir.lixiang.com/static-files/743d9acf-2fdf-4fa2-8219-f28e41237bd6
При сохранении правила Бизнес только седан обе модели L7/L9 переведены в
Комфорт в backend-ветке arch/g2-li-auto-comfort. Их год2023, статус approved
и условие «Только комфортные комплектации; проверка салона» сохранены.
Проверка сравнения с предыдущим Git HEAD: 131 строка, изменены ровно два
значения тарифа, прочие поля и порядок сохранены; 78 Комфорт/29 Бизнес/
24 Минивэн, 131 approved. CSV SHA256
561c53347658f732724a78894dd5de933e1e634370730e7b0b46ac901cabcd93.
Архив v1 не менялся; исторические документы сохраняют старые показатели.
Подтверждать тип конкретного автомобиля по версии/документам; общая политика
для других электромобилей этим решением не установлена. Runtime/production
не менялись, сборка и live тесты не проводились. Документальные изменения в
отдельных локальных ветках; remote/merge/deploy не выполнялись.

Обычный git diff --check указал CRLF как trailing whitespace в двух изменённых
строках исходного CSV. Исходные CRLF сохранены; проверка повторена с явным
core.whitespace=cr-at-eol, без массовой смены формата файла.


## Решение владельца: Li Auto L7/L9 остаются в Бизнесе — 2026-11-17

Владелец уточнил: «кроссоверы Li Auto L7 и L9 оставляем в бизнесе». Это
конкретное исключение для L7/L9 из правила о седанах в Бизнесе. Предыдущий
перенос этих двух моделей в Комфорт отменён; L7 и L9 снова Бизнес, год от
2023, approved и прежнее условие проверки комплектации/салона сохранены.
Другие исключения данным решением не устанавливаются.

CSV проверен сравнением: ровно два обратных изменения тарифа, все прочие поля
сохранены; файл побайтно совпал с версией до переноса. 131 approved,
76 Комфорт / 31 Бизнес / 24 Минивэн; SHA256
1e4955a6f7250f0e5183f99d105a5c5b235eaa51b7ee432e2f29ad2a69af4901.
История в журнале сохранена; документ LI_AUTO_L7_L9_DECISION_2026-11-17.md
отмечает отмену переноса. Правила Avatr 12/Zeekr 001 отдельно не менялись.
Документальные изменения в локальных ветках arch/g2-li-auto-comfort и
arch/g2-vehicle-catalog-next; runtime, merge/deploy и live тесты не выполнялись.


## Решения владельца: изменение автомобиля, исключения и электромобили — 2026-11-17

Владелец: при изменении марки/модели/года система повторно определяет класс,
направляет автомобиль на проверку; автомобиль не допускается на линию. При
исключении администратор может внести все необходимые параметры, после чего
класс определяет система. Ранее утверждённый выбор соответствующей модели
из справочника не отменён; уточнить его применение, если соответствия нет.
О влиянии запрета на уже выполняющуюся поездку решение отдельно не заявлено.
Другие только электромобили исключить из списка; тип конкретного исполнения
важен, поскольку у ряда моделей есть гибридные и полностью электрические версии.

Проверены источники, зафиксированные в backend документе
ELECTRIC_VEHICLE_REVIEW_2026-11-17.md; из локального актуального CSV исключены
10 подтверждённых BEV моделей: Mercedes-Benz EQS, BMW i5/i7, NIO ET7, IM Motors
L7, Luxeed S7, Xpeng P7, Xiaomi SU7, Zeekr 001/009. Сохраняются Li Auto L7/L9
как утверждённое исключение и модели со смешанными версиями; для последних BEV
должны исключаться по силовой установке конкретного автомобиля. Остальные
модели/годы не проверены полностью. По известным данным 009 может получить
будущий гибрид; сам по себе анонс не является допуском или запретом на будущее.

Сравнение CSV с HEAD до удаления: ровно10 удалений,121 оставшаяся строка
сохранена, 76 Комфорт/22 Бизнес/23 Минивэн, все approved; SHA256
553384af5b49252d3b3acbc3973ef6dae7fc40d348156debf4f0fab24c5ae880.
Проверка BEV не завершена, перечисленный состав промежуточный; поле типа
силовой установки в существующем CSV отсутствует, runtime enforcement нет.
Runtime, schema, real data, merge/deploy не изменялись; тесты продукта не
выполнялись. Две локальные отдельные ветки, G1 остаётся на паузе.


## Решение владельца: остановка и переназначение во время поездки — 2026-11-17

На вопрос о смене марки/модели/года во время уже начатой поездки владелец
ответил: «Лучше остановить и переназначить водителя». Зафиксированы остановка
выполнения поездки с прежним назначением и переназначение водителя; прежнее
правило не допускать автомобиль на линию до проверки сохраняется. Завершение
старым водителем не предполагается. Способ безопасной остановки, пассажирский
сценарий и ручной/автоматический выбор замены этим ответом не определены;
их нужно конкретизировать без подмены решения об остановке.

Текущий backend имеет сервис reassignOrderByAdmin с проверкой reassignable;
его пригодность для поездки в движении и действие на реальной инфраструктуре
в этом обзоре не подтверждены. Контракт обновлён, runtime/схема/данные не
изменялись, тесты реализации не выполнялись. Текущая проверка электромобилей
и локального списка из121 правила остаётся неполной.


## Решение владельца: нового водителя выбирает диспетчер — 2026-11-17

Владелец уточнил: «Нового водителя только диспетчер вручную». При остановке
уже начатой поездки из-за изменения марки/модели/года переназначение выполняет
диспетчер вручную; автоматически выбирать нового водителя не разрешено.
Ранее утверждены остановка, повторная проверка и запрет выпуска автомобиля
на линию. Контракт обновлён, повторно эти решения не запрашивать.

Статическое чтение backend: существующий reassignOrderByAdmin проверяет право
orders.reassign, ревизию и статус заказа taken, а SQL — кандидата и активное
назначение. Проверка не доказывает пригодности для остановленной поездки с
пассажиром или live работы; безопасный порядок остановки и пассажирский
сценарий остаются для проработки. Код/схема/инфраструктура не менялись,
тесты реализации не выполнялись; отдельные локальные ветки, G1 на паузе.


## Решения владельца по пяти вопросам классификатора — 2026-11-17

Владелец ответил на пять вопросов: 1) подтверждён безопасный порядок остановки:
водитель останавливается в безопасном месте и сообщает местоположение, диспетчер
вручную назначает замену и информирует пассажира; 2) ранее зарегистрированный
автомобиль без года не допускается на линию до указания и подтверждения года;
3) невыполненное условие устранить, если устраняемое, а также рассмотреть
исключение; 4) если подходящей модели нет, разрешить администратору внести
модель в список и изменить правило; 5) конкретное гибридное/электрическое
исполнение проверять по документам. Сохраняются системный выбор класса и
предыдущие решения владельца, исключение не становится автоматическим допуском.

Полные ответы отражены в Android-документе
VEHICLE_RULES_OWNER_DECISIONS_2026-11-17.md и проекте контракта. Нужны
технический дизайн изменения справочника, версия, права и аудит, совместимость
со старыми данными/клиентами и тесты; исполнение и результаты тестов пока
не заявлены. Проверка полностью электрических исполнений 121 оставшейся строки
ещё не завершена. Код, схема, реальная инфраструктура не менялись; две
локальные рабочие ветки, G1 на паузе.


## Продолжение: проверка справочника и технический проект — 2026-11-17

Владелец: «Продолжаем». Повторно сверены актуальные локальные ветки и решения.
Продолжена проверка установок: источники производителей подтверждают наличие
разных типов исполнения Citroën SpaceTourer и Opel Zafira (ссылки в backend
ELECTRIC_VEHICLE_REVIEW_2026-11-17.md); конкретные поколения/годы надо проверить.
Изменений списка в этом шаге нет. Ревизия BEV всех оставшихся строк не завершена.

Добавлена выполняемая документальная проверка
`python tests/vehicleClassifierReference.test.py -v`: 6 PASS. Проверены CSV
структура,121 approved/76/22/23, отсутствие10 установленных BEV, сохранение
моделей смешанных типов, двух Li Auto исключений,112 исходных правил и
оставшихся китайских дополнений с их утверждёнными условиями. Не проверены
все существующие силовые установки и runtime ограничения по конкретной версии.

Независимо выполнены существующие тесты backend: npm run test:driver-registration
PASS, npm run test:admin-authorization PASS, npm run test:admin-vehicle-read
12/12 PASS. Это регрессии старого кода, не подтверждение нового классификатора.
Подготовлен Android-документ VEHICLE_CLASSIFICATION_IMPLEMENTATION_DESIGN_2026-11-17.md:
системный класс, проверка установок, администрирование правил, миграция,
перепроверка при изменении и безопасная остановка с ручным назначением.
Технические интерфейсы, влияние изменений правил на действующий автопарк и
полная миграция требуют конкретизации; автоматический допуск не объявляется.
Runtime код, схема и инфраструктура не менялись; G1 paused; merge/deploy нет.


## Решение владельца: изменённые правила — новым регистрациям — 2026-11-17

На вопрос, отправлять ли ранее одобренные автомобили на повторную проверку
после изменения администратором правила модели или применять изменение только
к новым регистрациям, владелец ответил: «Только к новым регистрациям». Одно
изменение правила не запускает массовую повторную проверку ранее одобренных
автомобилей и не должно автоматически менять их класс. Не отменено отдельное
решение: при изменении марки/модели/года самого автомобиля повторно определить
класс, направить на проверку и не выпускать на линию. Выбор версии правила
при таком отдельном изменении не следует выдумывать: эти случаи различаются.

Технический проект и проект контракта актуализированы; нужна привязка принятого
правила/версии и тесты, исключающие ретроактивное применение. Код, schema,
продуктовые данные и инфраструктура не изменялись, новые runtime проверки
не выполнялись. BEV ревизия 121 оставшейся строки остаётся незавершённой.
Первый вызов ожидания среды содержал неверный идентификатор, был отклонён;
затем доступен готовый контекст. Локальные рабочие ветки, G1 на паузе.


## Начата серверная логика классификации — 2026-11-17

По поручению «Всё верно. Продолжаем» в backend локально добавлен изолированный
`src/core/vehicleClassification.js`, не подключённый к регистрации, маршрутам
или базе: по переданному доверенному сервером правилу и проверенным параметрам
возвращает candidate с версией, ручную проверку для отсутствующей модели или
недостаточного года, excluded для BEV. Candidate не является одобрением,
допуском на линию или подтверждением текстовых условий. Неизвестный тип
установки/ошибочный ввод безопасно отклоняются; неподтверждённый тип направляет
на ручную проверку без класса. `powertrainVerified` допустим только из серверной
модерации, не из запроса водителя; механизм этого доверия ещё не реализован.

Правило по конкретной версии передаётся извне: сохранение и выбор версии,
применение изменений только новым регистрациям и исторические автомобили ещё
не реализованы. Соответствие марки/модели точное, автоматические алиасы/догадки
не вводились. Смена полей/остановка поездки/назначение диспетчером, проверка
документов, управление справочником, миграция и запись событий не подключены.
Нельзя выпускать этот компонент как реализованное системное правило.

Добавлен `npm run test:vehicle-classification` в npm test. Локально 7/7
unit cases PASS, тесты справочника Python 6/6 PASS, существующие
test:driver-registration и test:admin-authorization PASS. Проверка снапшотов
подтверждает только чистую функцию, не БД/миграцию и не применение правила
только к новым регистрациям. Полный CI, native Worker/D1, интеграция, Android,
безопасность всего приложения и оставшиеся электроверсии не проверены этим
шагом. Код/тесты только в отдельной локальной ветке backend; обе журнальные
записи локальны, нет deploy/merge/реальных данных, G1 paused.


## Решение владельца и хранение версий — 2026-11-17

Владелец ответил «По текущей версии» для повторной классификации при изменении
марки/модели/года уже зарегистрированного автомобиля. Решение не отменяет
применение изменённых правил только к новым регистрациям без массового
пересмотра прежних данных. В отдельной ветке arch/g2-classifier-version-store
реализованы миграция0019, внутренний repository и12 actual SQLite tests:
неизменяемая история, текущая версия для новой ревизии, защита от гонок
смены правила и vehicle revision, отсутствие фиктивного класса. После
самопроверки усилены CHECK от NULL reasons/дробных чисел и проверка совпадения
candidate с классом/годом правила; добавлены соответствующие регрессии.

Локально12/12 store,7/7 evaluator,6/6 reference,19 migrations smoke,12 D3
preflight PASS. Полный npm test прошёл предыдущие группы и остановился на
существующем OWNER control-plane CLI: spawnSync --help возвращает EPERM,
пустой stdout. Тесты не ослабляются; полный прогон перенесён в штатный CI.
Подготовлен native local D1 harness с реальными triggers и новый workflow step.
При чтении инструментов был указан отсутствующий check_availability_sqlite.py;
существующий native harness прочитан и применён вместо этого пути.

Репозиторий не является внешним auth API; аудит/права/владение/доверенное
подтверждение установки обязан обеспечить вызывающий сервис. Новые таблицы
пустые, seed и live data не используются; регистрация/Android/автостоп/диспетчер
не подключены. Подробные границы в VEHICLE_CLASSIFICATION_VERSION_STORE_2026-11-17.md.
Срез требует итогового CI; merger/deploy/remote migration отсутствуют, G1paused.


## Первый CI version store и исправление fixture — 2026-11-17

Draft PR33, remote code3583ca6f9c341730d2a18cb3dcdc63fe6ac6dcf2,
CI44051103873/job133928833867: новые unit/SQLite/reference/migrations и
native classification D1 PASS, а protected OWNER provisioning fixture FAIL.
Причина: защищённая setup-команда допускает ровно18 миграций; fixture начал
копировать новую0019. Это существующая fail-closed граница, не повод расширять
OWNER-only scope или разрешать удалённую миграцию0019.

Исправлен только тестовый fixture: пять прежних сценариев моделируют исходный
18-migration target; добавлен шестой сценарий, где настоящий неизменённый CLI
на цепочке19 должен отказаться до prompts/import/upload и любых записей.
Ни одного production/setup условия не ослаблено. Python syntax PASS; исполнение
реального PTY/Wrangler fixture проверяется новым CI, не объявлено локальным PASS.
При поиске теста один путь adminOwnerPhoneSetup.test.mjs отсутствовал, далее
прочитан существующий helper и точное условие state(). Изменения только
в feature-ветке; remote/production запуск и миграция не выполнялись.


## Version store: финальный CI PASS — 2026-11-17

Code aef9dfc77dc861a46e97792a27773cb4c5f6542b,
tree c8bfbb39385e494e17112f2d0e87711cca0cf5dc,
CI44052040564/job133931991226 SUCCESS.71 npm test scripts,7 evaluator cases,
12 actual SQLite store cases,6 reference checks,19 migrations,12 preflight,
7 native local workerd/D1 workflows,6 protected CLI scenarios,audit0 и
Worker bundle dry-run PASS. Полный CI преодолел локальную spawnSync EPERM
границу без ослабления assertions. Guard OWNER setup по18-миграциям не
изменялся; шестой сценарий подтвердил отказ на19 до prompts/import/upload.
Первый failed CI сохранён в истории, не считается успешным.

Backend Draft PR33, Android docs Draft PR13. Опубликованные feature trees
сравнены с local staged trees; Android docs payload сначала превысил лимит
вывода и не распарсился, remote mutation не было; повторное чтение файлами/
частями успешно дало точное tree parity. Локальные source hashes в receipt
VEHICLE_CLASSIFICATION_VERSION_VERIFICATION_2026-11-17.json. Последующие
изменения только документация; проверенный code SHA указан отдельно.
Это внутренний компонент, не завершение регистрации/прав/MFA API/модерации/
линии/поездки/Android. Ни snapshot candidate, ни CSV не дают допуска на линию.
Не выполнялись seed, remote migration, реальные документы, merge/deploy.
Полный обзор электрических исполнений и интеграция остаются дальнейшей работой.


## Подготовка schema/чтения регистрации к системному классу — 2026-11-17

По поручению «Далее» создана отдельная ветка arch/g2-classifier-registration-schema
от проверенного version store. Выявлена необходимая зависимость: исходный
vehicles.class NOT NULL не позволяет draft неизвестной модели без фиктивного
класса. Миграция0020 снимает NOT NULL через DROP COLUMN/ADD COLUMN с временным
сохранением реальных классов, без DROP TABLE. Добавлены nullable model_year
и powertrain, triggers запрета approved без класса. Старые значения не меняются.
Репозиторий поддерживает draft без класса и внутренние декларации; GET Driver me
отдаёт новые поля и null-класс. Внутренний metadata read ограничен владельцем.

8 новых actual SQLite/HTTP cases PASS: заполненная база19 с документами, фото,
проверками, назначением, immutable snapshot сохранила все связанные таблицы
и старые значения после0020; integrity/FK PASS, rollback восстанавливает старую
схему/данные; nulldraft и JSON read, owner-bound read, constraints проверены.
Первый прогон после добавления новых полей дал2 ошибки теста: новая функция
чтения была вызвана до миграции на старой19-схеме. Проверка исправлена на прямое
сравнение полных старых строк до/после, а новый repository читается после0020.
Это не поддержка нового кода на немигрированной базе. Был указан отсутствующий
путь miniflare database.worker.js при поиске реализации; новый native fixture
готовит SQL конкретной миграции и проверяет upgrade напрямую на D1.

Миграции smoke20 PASS, существующие registration и12 version-store cases PASS.
Локальный npm test вновь дошёл до OWNER CLI и остановился на sandbox EPERM;
не ослабляется и должен пройти полный CI. Добавлены72-й npm script и native
populated D1 upgrade step. Публичные POST/PATCH пока принимают прежний класс
от водителя, Android DTO не готов к null, полноценная интеграция ещё не выполнена.
Нет подтверждения документов, новых guards линии/поездки, seed/реальных данных,
remote migration/merge/deploy. Данные BEV121 ещё не полностью проверены.


## Schema/чтение регистрации: итоговый CI PASS — 2026-11-17

Source0de3ffd83e9adebc1c2409bce9f0a2082733c3bd,
tree1759e9b423af9e7693e0a2d7a6c61f4e668bb345,
CI44055860164/job133944966595 SUCCESS.72 npm test scripts,8 новых actual
SQLite/HTTP cases,20 migrations,12 D3 preflight,6 reference tests,8 native
D1 workflows,6 protected CLI scenarios,audit0 и Worker dry-run PASS.
Native D1 подтвердил сохранность populated upgrade19→20, rollback намеренной
ошибки, null draft, owner-bound read и запрет approved без класса.
Первый run44055638704 отменён после добавления rollback проверки, не считается
финальным PASS. Локальный EPERM не обходился; полный CLI проверил CI.

Backend Draft PR34, local/remote tree parity проверена. Точные hashes и
границы в VEHICLE_REGISTRATION_SCHEMA_VERIFICATION_2026-11-17.json.
Следующие изменения только docs [skip ci], проверенный code SHA не подменять.
Публичные POST/PATCH сохраняют прежний driver-supplied vehicleClass и не
принимают modelYear; Android DTO ещё не готов к null. Реализованы только
storage/read prerequisite, не полная классификация, не проверка документов,
не line/trip guards. Не включать null drafts через старые клиенты.
Нет seed/полного BEV обзора/remote migration/merge/deploy/реальных данных,
G1paused. Далее согласованно обновить API записи/клиент и trusted moderation.


## Driver write API: класс системы и сброс допуска — 2026-11-17

По поручению «Далее» продолжен утверждённый G2: отдельная ветка
arch/g2-driver-system-class-contract от schema0020. POST/PATCH больше не
принимают vehicleClass от водителя; POST требует numeric modelYear, draft
имеет null-класс. Фактическая смена марки/модели/года атомарно очищает класс,
отправляет approved/photo_check_required на pending_review, отключает линию
активного автомобиля и пишет минимальный аудит. Audit failure откатывает batch.
SQL записи повторно требует активного driver; revision/ownership сохранены.
При активном назначении ACK требует ручного диспетчерского переназначения;
phase и оба пути completion блокируются до восстановления допуска. Назначение
не отменяется/не завершается автоматически. Это не законченный handoff уже
идущего заказа и не проверка документов/классификация текущим справочником.

Восемь новых real SQLite/HTTP cases PASS, existing registration PASS; phase
repository/service, terminal SQLite7 и schema8 regression cases PASS. Первая
проверка legacy completion вызвала функцию неверной сигнатурой; исправлен
именно тест, затем8/8 PASS. Новый native Miniflare/D1 harness добавлен в CI,
73-й npm script включён в полный набор. Локальный npm test достиг OWNER CLI,
но protected child-process scenarios не прошли в sandbox (ограничение запуска
дочернего Node); CI обязан выполнить полный набор без пропусков/ослаблений.
Повторно8/8 и registration PASS после SQL active-account predicate; diff check
PASS. При восстановлении контекста один агрегированный вывод инструмента
превысил лимит: результат CI не предполагался, перечитан из API/локального лога.

Android зависимая форма опубликована отдельно: Draft PR14, source
58102355b24201f6eba06f2d5190341c7541be06, CI44060885312 ещё выполняется.
Подробный контракт/границы: DRIVER_SYSTEM_CLASS_CONTRACT_2026-11-17.md.
Trusted moderation/current-rule integration/legacy year guard, full in_progress
handoff и оставшийся BEV обзор впереди; G1paused, D4–D7 не утверждены.
Нет real data/seed/remote migration/merge/deploy. Финальный CI пока не объявлен.


## Driver system-class API: полный CI PASS — 2026-11-17

Source57c17bbc67b5c8aef3f137d9c13341f619dbd8a2,
tree87b4af13798cb318bfcf4b9f8172eece63f88484,
CI44062029259/job133966070138 SUCCESS.73 npm scripts (включая8 новых actual
SQLite/HTTP cases),20 migrations,12 preflight,6 reference cases,9 native
workerd/D1 workflows,6 protected OWNER CLI scenarios, audit0, Worker dry-run
PASS. Native D1 подтвердил запрет клиентского класса, сохранение года,
сброс класса/линии, manual-dispatcher flag и полный откат при ошибке аудита.
Локальное ограничение CLI не обходилось; assertions прошли в штатном CI.

Draft PR35 https://github.com/lobanov0710-blip/uber-v3/pull/35, basePR34.
Публикация: первый JSON read не распарсился из-за prefix warning; повторный
агрегированный read оказался неполным. Обязательная tree parity остановила
публикацию, исходники перечитаны отдельно, финальное local/remote tree точное.
Ошибочный промежуточный Git tree не привязан к ветке/PR; branch обновлён
только точным source. Это техническая ошибка чтения, не ослабление проверки.

Receipt: DRIVER_SYSTEM_CLASS_API_VERIFICATION_2026-11-17.json. Последующий
docs-only commit не подменяет проверенный code SHA. Trusted moderation/year
verification/current-rule integration, legacy year admission и полный
in_progress handoff остаются незавершёнными; нового допуска по справочнику
не выдавалось. Android CI44060885312 ещё проверяется отдельно. G1paused,
нет реальных документов, seed, remote migration, merge или deploy.

Уточнение записи: backend receipt подтверждает только серверные проверки;
Android принимает отдельный receipt в Driver PR14. Исторический schema scope
дополнен ссылкой на текущий write API. Первая попытка такого docs patch не
нашла заголовок и не изменила файл; после чтения точного заголовка применена.


## Следующий Admin/system-class этап: аудит и проект контракта — 2026-11-17

По поручению «Продолжаем» среда восстановлена wait_for_environment, сверены
AGENTS, ТЗ/D1–D3, owner decisions, план и финальные записи предыдущего этапа.
Отдельные ветки arch/g2-admin-classification-contract обоих repo созданы от
проверенных feature trees backend56693ae2/Driver2cebbc55; remote parents
5adfd2a6 и57f69b30 совпадают с локальными деревьями.

Сверка выявила8 открытых blockers следующего внедрения: Admin metadata/DTO
без года/trusted результата и null→empty class; approval и line/assignment SQL
без новых trusted guards;0019 FK/minYear не представляют модель-основание
исключения; общая revision не должна автоматически выбирать новое правило;
evaluator не подтверждает кузов/notes; права/API авторства не выбраны; BEV
обзор121 строк не завершён. Это не объявление исправления или production
эксплуатации найденного. Runtime код в этом шаге не меняется.

Подготовлены подробный ADMIN_VEHICLE_CLASSIFICATION_CONTRACT_PROPOSAL_2026-11-17.md,
машиночитаемый OpenAPI и audit JSON в backend; Android next-step документ
связывает их с формой/допуском и критериями приёмки. Предложены новые права
vehicle_rules.manage/vehicles.approve_exception без auto-grant; текущий
vehicles.verify для проверки параметров; правило закрепляется при первом
сохранении автомобиля, сохраняется при unrelated revisions, смена make/model/
year использует текущую версию. Сопоставление той же марки, immutable assessment,
условия/документы и hard BEV/business-body guards; класс только от сервера.
Старый approved route тоже обязан проверять trusted результат в будущей SQL.

Новые права и момент фиксации версии ожидают явного решения владельца. Это
не повтор бизнес-вопросов, уже решённых им. AGENTS п.3 запрещает заменять
отсутствующее решение предположением; owner decisions требуют согласованный
контракт правил до реализации. Независимая подготовка завершена до запроса;
handlers/grants/DDL/seed не вводились. Предлагаемый контракт не является
разрешением выпуска или скрытым расширением OWNER-only STAGING.

Проверки baseline сейчас:5 Node test entry points PASS (classifier,store,
Driver write contract,admin authorization,moderation flow),6 Python reference
cases PASS,8 Driver/5 Admin security guards PASS. OpenAPI3.1 JSON schemas и
local refs корректны,5 операций,4 valid/8 rejected synthetic request examples.
Это проверки документа/прежнего кода, не выполнение будущих API. Новых APK,
полного backend или Android CI в docs-only шаге нет. Предыдущие CI44062029259/
44060885312 остаются evidence своих точных code SHA, не новой реализации.

Первое агрегированное чтение превысило output limit; нужные источники
перечитаны малыми частями. Поиск включил отсутствующий driverEligibilityService
путь; проверены реальные availability/assignment источники. Секреты/приватные
материалы не читались. Все будущие runtime checks перечислены отдельно.
G1paused,D4–D7pending; нет remote state audit/migration/real documents/merge/
deploy. Полный dispatcher in_progress handoff/BEV обзор не завершены.


## Решение владельца: контракт утверждён, новые права диспетчерам запрещены — 2026-11-17

Ответ владельца: «Утверждают, но права диспетчерам не давать». Контракт
Admin vehicle classification утверждён с этой поправкой: vehicle_rules.manage
и vehicles.approve_exception диспетчерам не выдавать и не признавать как
разрешение, даже если такая запись ошибочно присутствует в staff_permissions.
Эти новые полномочия доступны OWNER в действующей модели с серверным MFA.
Ранее существующие операционные права диспетчера этим ответом не отзываются.
Фиксация версии при первом сохранении автомобиля утверждена; изменения
марки/модели/года используют текущую версию, unrelated revision её не меняет.
Повторное утверждение этих двух решений не требуется. Merge/deploy/seed и
расширение OWNER-only STAGING не разрешены; G1paused,D4–D7pending.

Начинается отдельный серверный prerequisite: immutable binding истории
марки/модели/года с атомарным выбором версии в D1 trigger первого сохранения
и фактической смены данных; защита новых OWNER-only прав на сервере и в БД.
Trusted assessment/review API, итоговый admission guard и Admin UI ещё впереди.
Это не автоматический допуск или объявление полной реализации контракта.


## Binding/OWNER-only prerequisite реализован, CI предстоит — 2026-11-17

От утверждённого contract correction создана ветка arch/g2-classifier-binding.
Миграция0021 атомарно фиксирует версию при первом INSERT vehicles и создаёт
immutable input history при фактической смене make/model/model_year. Нет
backfill/фиктивных лет/версий/классов. Unrelated изменения не выбирают новую
версию. Internal read owner-bound; binding failure не оставляет автомобиль,
audit failure откатывает key edit/off_line/новый binding одной транзакцией.
Server resolver фильтрует новые права у DISPATCHER; adminCan отказывает даже
при ошибочном permission list. SQL INSERT/UPDATE protected grants не-владельцу
запрещён; согласован trim/регистр, включая Unicode edge whitespace. Старые
ошибочные grant rows сохранены без доступа. OWNER сохраняет существующий MFA.

16 новых actual SQLite/HTTP cases PASS. Первые2 ошибки были в fixture: неверное
имя колонки bound_at вместо created_at и legacy test с невалидным VIN/opaque
ID вместо допустимого HTTP UUID. Исправление VIN отдельно не устранило ID
ошибку; fixture заменён настоящим HTTP-created UUID на20-схеме и nullable
legacy годом до21, assertions/публичная валидация не ослаблялись. Затем16/16
PASS, including make/model/year отдельно и Unicode permission cases.
21 migrations smoke,6 reference,12 preflight PASS. Existing admin authorization
и8 Driver write-contract cases PASS; version-store/schema regressions идут
отдельно. Полный local npm test дошёл до protected OWNER CLI и вновь не
прошёл из-за sandbox child process restriction; не объявлен PASS и не ослаблен.
74-й test script и десятый native D1 workflow добавлены для полного CI.

Один поиск вызвал отсутствующий adminProfileService.js; реальные entrypoints
найдены через rg, source не менялся по предположению. Новые документы
VEHICLE_RULE_BINDING_SCOPE_2026-11-17.md отделяют binding от trusted assessment.
Legacy captureCurrentVehicleClassification остаётся unintegrated current-head
candidate helper и не представляет approved pinned review. Нельзя подключать
его к допуску/маршруту; будущий trusted service читает новый binding.
Trusted API/admission/Admin UI/BEV review/legacy transition/in_progress handoff
ещё не готовы. Нет seed/real materials/remote migration/merge/deploy, G1paused.


Первый CI44077774303/job134020146192, sourcec959ed587388d89b660578e5156fa5c18b20aa7f,
FAILED на existing native Driver contract: POST вернул409 вместо201. Полный
74-script npm набор прошёл, но первый run не является итоговым PASS. Найдено
реальное отличие D1 meta.changes: он включает INSERT binding из триггера,
прежний helper ожидал максимум1 и мог объявить ошибку уже committed vehicle
write. Для insert/update теперь SQL changes() читается сразу после top-level
mutation в той же atomic batch; допустимы только0/1. Audit condition сохраняет
changes() semantics после SELECT. Нельзя заменять это проверкой meta>=1,
которая не различает основную запись и trigger side effects.

Добавлен17-й actual SQL/HTTP regression с увеличенным D1 wrapper metadata,
legacy fake расширен для чтения top-level count в batch. New17, existing8
Driver write и registration service PASS локально; полный native CI повторяется
на исправленном source. Ошибка и первый failed run сохранены, проверка не
пропущена/не ослаблена. Реальных данных/deploy в этом инциденте не было.


## Binding/OWNER-only: итоговый CI PASS — 2026-11-17

Проверенный sourcea52b83ba1da0e8024946f2d92288e6f6e52cc383,
treedad21bcb855f8d49bc2446f6bbfc5a0eb9745c55, CI44078545851/
job134022783461 SUCCESS.74 npm scripts,17 новых actual SQLite/HTTP cases,
21 migrations,12 preflight,6 reference,10 native workerd/D1 workflows,6
protected OWNER CLI scenarios,audit0 и Worker dry-run PASS. Native D1 реально
подтвердил populated20→21/rollback, first-save binding, сохранение старой версии
при unrelated edits, текущую при явной смене года, rollback history/audit и
отказ новых dispatcher grants/игнорирование legacy ошибочных строк. Существующий
native Driver contract после исправления meta.changes также PASS. Local CLI
ограничение не обходилось: полный protected набор исполнился в штатном CI.

Первый failed44077774303 не скрыт: trigger-inclusive D1 счётчик исправлен
через top-level SQL changes() в той же транзакции,17-й regression добавлен.
Docs-only checkpoint после CI не меняет verified code SHA. Scope и source
hashes в VEHICLE_RULE_BINDING_VERIFICATION_2026-11-17.json. Draft PR37
https://github.com/lobanov0710-blip/uber-v3/pull/37, baseapproved PR36.
Tree parity локального/удалённого code проверена до публикации.

Поправка владельца отражена в AGENTS и approved contracts обоих repo, не
нуждается в повторном подтверждении. В Android изменены только документы,
security guards8/5 PASS; новый APK/Android CI не создавались. Trusted assessment
и его HTTP API/правила/evidence, admission guards, Admin UI и оставшийся BEV/
legacy/in_progress handoff ещё не готовы. Нет seed/real materials/remote
migration/merge/deploy/нового доступа OWNER-only STAGING; G1paused,D4–D7pending.


## Решение владельца: цвет кузова обязателен — 2026-11-17

Указание владельца: «Исправить: цвет кузова на обязательно». Обязательность
внесена без повторного согласования. Отдельные fix/vehicle-color-required
ветки созданы от проверенных backend PR37/Android docs PR15. Backend POST
требует строковый color1..80 после trim, запрещает null/missing/пустое/пробелы/
нестроковое/внутренние controls. PATCH проверяет итоговую запись: пропущенный
color сохраняет имеющийся действительный цвет, legacy без цвета нужно заполнить.
Readiness анкеты требует цвет; missingColor явно указывает причину. Нулевые
старые значения разрешены только для чтения/исправления, не выдумываются.
Нет массового исправления/снятия допуска или нового правила классификации.

Driver: «Цвет (необязательно)» заменён на «Цвет кузова», required validation
с понятной ошибкой. Existing native create/edit scenario расширен: blank/
whitespace не отправляются, очистка цвета при edit блокирует PATCH; валидный
цвет явно проверяется в body. DTO продолжает читать legacy null для заполнения.
Обновлены только synthetic fixtures, связанные с новым обязательным полем.
Новых палитр/списков цветов/библиотек/ролей/миграций нет.

10 actual API cases PASS (2 новых случая цвета),17 binding regressions,
existing registration/readiness PASS локально. Security guards8 Driver/5 Admin
PASS. В existing native D1 harness добавлен requiredColor check; полный backend
и Android CI ещё предстоят. Новый APK пока не объявлен проверенным.

Ошибки инструментов: команда создания Android worktree сначала ошибочно
вызвана в backend repo и остановилась на уже существующей ветке, исправлена
на правильный repo без изменения его кода. Поиск readiness/submit сначала
использовал несуществующие имена, реальные реализации найдены через rg в
driverPrivateUploadService; один Android read выполнен в backend cwd, затем
прочитан по правильному пути. До CI исправлено неверное ожидание строки ошибки
в native test (фактическая ошибка формы «Проверьте поля...»). Assertions не
ослаблялись. G1paused,D4–D7pending; нет seed/real data/remote migration/merge/deploy.


## Обязательный цвет: backend CI PASS — 2026-11-17

Sourcea8a67fd9aaaf32359aa04370ebece424709d87df,
treea560708c194fd1f9639f7d8d81751f94cfc89745, CI44088974938/
job134058811280 SUCCESS.74 npm scripts,10 actual Driver write HTTP cases
(2 новых по цвету),17 binding regressions,21 migrations,12 preflight,6
reference,10 native D1 workflows,6 protected CLI scenarios,audit0,Worker
dry-run PASS. Native D1 явно подтвердил requiredColor. Existing readiness
проверил7 недопустимых вариантов цвета; без цвета машина не complete.
Первый run успешен. Не подменять это проверкой Android: его CI/receipt
самостоятельны. Draft PR38, exact source hashes/границы в
REQUIRED_VEHICLE_COLOR_API_VERIFICATION_2026-11-17.json. Следующий commit
только docs; code tree уже сверен локально и удалённо.
Нет новой миграции/backfill/массового снятия допуска/палитры/новых прав/
изменения pinned classification. G1paused, remote migration/merge/deploy нет.


## G2: Admin rule API и полные определения — 2026-11-17

По утверждённому контракту/поправке OWNER продолжен prerequisite для trusted параметров. Добавлены три Admin rule operations и classification metadata GET; POST review/assessment и допуск ещё не реализованы. Migration0022 immutable definitions без seed/backfill. OWNER-only authoring с фактическим MFA/session SQL guard, CAS, idempotency и audit одной batch; dispatcher новые права не получает. Неизвестные поля/марки/economy/неверный кузов отвергаются. Утверждённые142 labels и два исторических CSV spellings сохранены без выдуманных aliases. Новая версия не меняет ранее закреплённую у автомобиля. Metadata не выдаёт legacy candidate за доверенную проверку.

При анализе исправлены два края: audit target_id120 не вмещал допустимый legacy version128 (для длинных ссылок применяется детерминированный SHA256 ref); чтение теперь проверяет actual access после audit и его top-level SQL changes(), иначе не выдаёт данные. Tests охватывают подавленный audit, поздний отзыв прав/MFA/session/tokenVersion/OWNER binding, CAS competition, same-key replay, rollback, immutable history и лимиты16KiB против прежних4KiB auth. Цвет обязателен в public save, legacy null на чтении сохраняется.

Ошибки тестов до проверки: synthetic HTTP transport не передавал CF-Connecting-IP для MFA; исправлен транспорт, вход не ослаблен. Затем revocation fixture записывал revoked_at=1 раньше created_at и нарушал CHECK, а scope test вызывал router вместо Worker entrypoint; исправлены fixture/точка входа. Первый focused run16 имел14 PASS/2 FAIL, повтор16 PASS, затем расширен до20. Служебные ошибки чтения: два устаревших имени workflow/harness и ownerPhoneScope найдены через rg; node --test с фильтром в ограниченной среде не стартовал штатно, полный direct test выполнен. Один общий tool вывод превысил контекст, состояние перепроверено по файлам и тесты повторены. Секретов/реальных данных в выводе не было.

Вопрос владельца о всех проверках: локально допустим риск-ориентированный выбор нужных проверок, существующие обязательные CI/приёмочные gates не отменены. Здесь изменения auth/БД требуют полного server CI и native D1. Android код не менялся, сборка нового APK не заявляется. Локальные20 новых/17 binding/10 Driver/4 MFA,22 migrations,12 preflight,6 reference PASS; полный GitHub CI ещё предстоит. Scope/границы: ADMIN_VEHICLE_RULE_API_IMPLEMENTATION_2026-11-17.md. G1paused,D4–D7pending; allowlist phone unchanged, нет remote migration/seed/merge/deploy.


## Admin rule API: первый CI и исправление native harness — 2026-11-17

Первый source60cbdcf72236c692cf0cb0ebc60eadd24c9a8331, tree914ee53dfd7175f60fab8374e33b5c6409cd0a37, CI44108752691/job134128241688 FAILURE. До нового harness прошли75 npm scripts (включая20 новых cases),22 migrations,12 preflight,6 reference,dependency audit и10 прежних native D1 workflows. Новый harness ошибочно перечислял все таблицы через native sqlite_master и включил provider _cf_METADATA, доступ к которой D1 правильно запрещает SQLITE_AUTH. Protected CLI/Worker dry-run после этого шага ещё не исполнялись; полную проверку успешной не объявлять.

Исправлено только перечисление: имена всех таблиц берутся из точной application schema21, скопированной в native D1 перед тестом. Все таблицы проекта остаются в populated before/after сравнении и rollback, закрытая таблица провайдера не читается. Не менялись D1 permissions/runtime guards или assertions сохранности. Source tree до публикации сверен локально/удалённо, draft PR39 от PR38; create_tree ответ сначала требовал object-aware parser, повтор дал то же дерево без изменения веток. Медленный посимвольный export заменён на построчный, его собственный процесс остановлен. Полный CI повторяется на исправлении; сбой не скрывается и шаг не пропускается.


## Admin rule API: совместимые PRAGMA D1 — 2026-11-17

Повторный source100b8cd7640c0b9d812d269e04e1f92b41367f52, treeec84323ed7407aca6df1eb23205584b5d57b2cfc, CI44109157270/job134129707568 FAILURE. Исправленный populated snapshot/rollback, actual OWNER MFA HTTP CRUD/replay/audit rollback, immutable definitions/body/FK уже прошли; последняя добавленная PRAGMA integrity_check получила SQLITE_AUTH. Это неподдерживаемая D1 команда, не обнаруженная порча БД; полный CI всё ещё не PASS, поздние CLI/bundle шаги skipped не считаются выполненными.

Поддержка проверена по официальной Cloudflare docs, commit8add1831851c52f3580c56b3612d35a225526f97, src/content/partials/d1/use-pragma-statements.mdx: разрешены quick_check и foreign_key_check, integrity_check отсутствует. Native test теперь требует quick_check='ok' плюс FK и полный before/after application tables; полный SQLite integrity_check='ok' явно добавлен в populated21→22 test. Проверка целостности не отменена, используется документированный интерфейс каждой среды, никаких новых provider permissions. Полный CI повторяется. Read-only source hash сначала запрошен ошибочно в Android cwd и затем получен в правильном backend cwd; код этим не менялся.


## Admin rule API: итоговый CI PASS — 2026-11-17

Проверенный source2a5e7b487e9b2a06923586de8230b6b7e63f5f17, tree0aca51165beb7557721a5988aa97132fa8834539; CI44109843561/job134132126272 SUCCESS, все26 steps success.75 npm scripts (20 новых HTTP/SQLite),22 migrations,12 preflight,6 reference,11 native Worker/D1 workflows,6 protected CLI scenarios,dependency audit0,Worker dry-run PASS. Native новый workflow подтвердил populated21→22/rollback без seed, actual OWNER MFA/create/version/read/replay, запрет dispatcher write, audit rollback без SQL leakage, неизменяемость definitions, body constraints,FK и документированный quick_check. Полный integrity_check='ok' выполняется в populated SQLite test. Два прежних failed runs44108752691/44109157270 сохранены с причинами; это исправления compatibility harness, не обход запретов провайдера и не замена assertions на skip.

Source/tree parity с локальным65486668b4b0c0994f9c10f172c3f432b3cbb0de проверена. Receipt ADMIN_VEHICLE_RULE_API_VERIFICATION_2026-11-17.json содержит SHA256 проверенных файлов и раздельные границы. Draft PR39 https://github.com/lobanov0710-blip/uber-v3/pull/39 от fix/vehicle-color-required(PR38); не merge. Следующий checkpoint только docs, проверенный code SHA не подменяет. Исходный docs-only срез контракта помечен историческим и дополнен фактическим текущим этапом.

Вопрос о проверках не изменяет gates: при разработке — относящиеся к изменению и рискам, в текущем auth/DB этапе — весь server CI. Android runtime не менялся, нового APK/Android CI здесь нет; последний собственный проверенный Android color source e5712c969049fb6670fd64863db189f3d32eb038 и CI44089001617 остаются самостоятельным baseline, не результатом этой ветки. Канонические журналы обоих repo синхронизируются append-only.

Четыре API операции — prerequisite; trusted assessment/review/evidence/history, admission/assignment guards и Admin UI ещё предстоят. Полный powertrain обзор121 строк и legacy/activation также не закрыты. Нет runtime seed/remote migration/реальных чувствительных материалов/merge/deploy/расширения OWNER-phone allowlist. G1paused,D4–D7pending. Следующий шаг по утверждённому контракту — trusted classification/review и атомарные допуски, без ручного выбора класса.


## G2: trusted assessment storage перед публичной orchestration — 2026-11-17

Продолжен следующий утверждённый этап PR39: внутреннее хранилище неизменяемой проверки параметров и гарантии потери доверия. Migration0023/actual SQL recorder/pure decision добавлены в отдельной ветке arch/g2-trusted-vehicle-assessment. Фактические make/model/year и исключение по basis модели одной марки сохраняются раздельно. Verified СТС обеих сторон с точными owner/vehicle/type/revision проверяются перед записью и в транзакции; actual session/grants/OWNER MFA, CAS общей revision, idempotency и минимальный audit одной batch. Причина/evidence не попадают в replay receipt. Класс кандидата отдельный, нет проекции класса/статуса/линии/назначения. Общий rule authorizer вынесен без изменения политики.

Новый current view не возвращает старый candidate, если после него записан manual_review/excluded; make/model/year/powertrain/VIN/plate/selected document changes/deletion создают immutable invalidation. Возврат прежнего значения не оживляет доверие. Цвет/unrelated revision/new rule head не меняют прежний pin/результат. BEV/неподходящий кузов нельзя разрешить exception, условия только явно и по IDs. SQL независимо проверяет candidate. Legacy без binding не получает выдуманных параметров. Новый публичный review POST пока закрыт404 до атомарных исправлений/safe stop/handoff/проекции и всех approval/line/assignment guards; это prerequisite, не выполненный допуск. Existing GET пока не показывает внутренние данные.

Локально15 new cases,20 existing rule,17 binding,4 MFA transport,23 migrations,12 preflight,6 reference PASS. Первые11 новых cases прошли; при расширении15 были13 PASS/2 FAIL из-за fixture VIN неверной длины17 и ошибочного ожидания403 после полного отзыва MFA (действующий authenticator возвращает401 до recorder). Исправлены именно synthetic VIN/ожидание фактической границы; повтор15 PASS. При чтении были ограничены/truncated совмещённые выводы и одно устаревшее имя migration0011, реальные файлы найдены через rg. Анализ trigger-inclusive meta.changes не потребовал ослабления счётчиков: Driver mutation уже исправлена, document moderation работает с pending и не создаёт новую invalidation verified assessment. Нет raw credentials/real data.

Границы/следующие операции: TRUSTED_VEHICLE_ASSESSMENT_STORAGE_2026-11-17.md. Полный CI76 npm scripts и12 native D1 workflows ещё предстоит; локальные subprocess/socket ограничения не обходятся. Android runtime не менялся, APK/Android CI не заявляются. G1paused,D4–D7pending; seed/legacy backfill/remote migration/merge/deploy/OWNER-phone expansion отсутствуют.


## Trusted storage: исправлена модель для hard business body guard — 2026-11-17

При ручном анализе обнаружено: первая реализация выбирала исключение business crossover по rule/basis модели вместо фактической модели. В exception это могло распространить конкретное разрешение L7/L9 на Li Auto L8 через basis L7. Ошибка исправлена до открытия публичной операции: и JS decision, и независимый SQL candidate trigger проверяют фактические make/model. Правило справочника по-прежнему ограничивает собственный allowedBodyTypes; разрешение кузова не переносится на другую фактическую модель. Добавлен16-й regression: реальный OWNER exception для фактического L8 через basis L7 даёт excluded, прямой forged SQL candidate тоже отвергается. Native workflow расширен тем же фактическим кейсом. Линия/класс не активировались, real data/remote DB не затронуты. Первый CI44114419676 относится к предыдущему sourcea4fcd1ed8024bed4cf15810533fd6de9fd45cfbe и не является итоговой проверкой исправления; CI будет повторён на новом source.


## Trusted assessment storage: итоговый CI PASS — 2026-11-17

Проверенный source4a6440d669ab6a2d18a5099adb4bd3363ba13280, tree35a0c03aa216878d42f387139a6229a7b0e75f94, CI44114884841/job134150145663 SUCCESS: все27 steps,76 npm scripts,16 новых cases,23 migrations,12 preflight,6 reference,12 native D1 workflows,6 protected CLI,audit0 и Worker dry-run PASS. Новый native workflow подтвердил populated22→23/rollback, фактическую staff/OWNER MFA authentication, internal storage/replay, evidence invalidation после изменения/возврата, immutable history/audit rollback, no admission projection и actual model body guard с прямым отказом forged SQL candidate. Scope и hashes в TRUSTED_VEHICLE_ASSESSMENT_STORAGE_VERIFICATION_2026-11-17.json. Первый sourcea4fcd1ed8024bed4cf15810533fd6de9fd45cfbe/CI44114419676 тоже PASS, но superseded: ручной анализ нашёл модель для бизнес-исключения, добавлен16-й regression и весь CI повторён после исправления.

Draft PR40 https://github.com/lobanov0710-blip/uber-v3/pull/40 от PR39. Tree parity с local40b9de7c348a83d81a3b4ece77ea0b11dd3ec6db сверена. Поздний docs-only checkpoint не подменяет code source. В OpenAPI исправлено расхождение read schema: color теперь явное обязательное поле declaredParameters с legacy null по прямому указанию владельца; действующий GET уже возвращал его. ReviewWrite не расширялся, новые бизнес-правила/права не вводились. Контракт дополнен текущим storage prerequisite. Канонические журналы обоих repo обновляются append-only.

Публичный POST review по-прежнему404; нет class/status/line/assignment projection, нового APK или Android CI. Последние проверенные Android color sourcee5712c969049fb6670fd64863db189f3d32eb038/CI44089001617 остаются отдельным baseline. Следующие утверждённые части: атомарные исправления/safe stop/manual dispatcher handoff, trusted GET/history/evidence и public review, approval/line/assign/reassign/phase/done guards, Admin UI. Full powertrain121/legacy/activation pending. G1paused,D4–D7pending; нет seed/backfill/remote migration/real data/merge/deploy/OWNER-phone expansion.


## G2: atomic review corrections и старое approved — 2026-11-17

Продолжен утверждённый этап после PR40, отдельная arch/g2-vehicle-review-atomic. Внутренний recorder одной D1 batch исправляет make/model/year, берёт current rule только при ключевом изменении, сохраняет binding/history/assessment, class NULL и pending вместо прежнего approved, off_line, audit/idempotency и hold активного назначения. Same make/BEV/actual-model body guards сохраняются. expectedRuleVersion проверяет применяемую целевую версию, expectedInputRevision исходную generation; basis exception отдельно. Нет публичного review POST до оставшихся admission/read/UI частей.

Migration0024 immutable assignment holds без backfill. Потеря доверия selected evidence снимает class/approved/line и фиксирует hold; reapproval автомобиля не снимает остановку старого trip. On_line, phase и оба done paths проверяют hold, нет автоназначения/завершения; новый driver только ручным действием диспетчера. Существующий approved handler требует current trusted candidate/evidence/year/обязательный цвет и сам проецирует system class; final registration approved проверяет matching proof. SQL повторяет полномочия/session/tokenVersion/реальный OWNER MFA после precheck. Прежние photos/docs/usage/D4 guards не отменены.

10 новых сценариев SQL/auth/HTTP PASS локально; existing16 trusted,17 binding,10 Driver и moderation policy/repository PASS. Первая new7 PASS; позже authority/document rollback и color расширили до10. В color fixture попытка сохранить пустую строку нарушила существующий DB CHECK (9 PASS/1 FAIL); заменена на допустимые в legacy DB blanks, отдельно проверяются null/Unicode blanks/internal controls/NUL и валидный цвет. В старом16-suite ожидался422 для запретной прежде коррекции; заменён на проверку утверждённого теперь atomic success с новой generation и реальным годом, остальные race/rollback assertions сохранены. Краткое exec-server transport disconnected восстановилось одним повтором, файлы не потеряны. Некоторые совмещённые чтения были truncated, нужные участки прочитаны адресно.

Native harness теперь копируют view/trigger вместе с таблицами/index, чтобы проверять полную реальную схему23/24. Исторические upgrade20→21/21→22/22→23 assertions сохранены; storage native workflow после23 явно применяет24 для новой runtime зависимости. Новый native workflow23→24 проверяет legacy HTTP approved, correction, rollback, hold/reapproval и оба done paths. Scope/границы ATOMIC_VEHICLE_REVIEW_2026-11-17.md. Полный77-script/13-native CI пока предстоит. Общий assessment guard для всех admission paths/legacy/evidence expiry ещё pending; не выдавать hold guard за всю готовность.

Android runtime не менялся, APK/новый Android CI не создавался. G1paused,D4–D7pending. Нет seed/backfill/remote migration/real data/merge/deploy/нового OWNER-phone доступа. Действуем только по утверждённым решениям; новых грантов/тарифов/ручного выбора класса/автовыбора driver нет.


## Atomic review: первый CI и аутентифицированная replay fixture — 2026-11-17

Первый sourcefe79c7fcf26902806b14343ba715698f6c1b8965/tree1a23b54efbf9f9c95f714b69f90aa98cdebdf0bf, CI44127749679/job134196078083 FAILURE в mutationReplay.sqlite:12 PASS/2 FAIL. Vehicle rejection и final registration rejection теперь проверяют actual session/tokenVersion/OWNER MFA в SQL; прежняя fixture передавала только id/role и OWNER binding. Добавлено явное synthetic staff session/MFA factor/family DB state и sessionId/tokenVersion principal именно в replay test, без настоящих credentials. Статусы/транзакционные/replay assertions сохранены, SQL guards не ослаблены. Повтор14 PASS локально. Этот тест не выдаётся за настоящее MFA enrollment: реальные synthetic HTTP/MFA flows отдельно проверяются новым10-suite и native workflow.

До первого сбоя прошли migration24/preflight12/reference6/dependency audit и более ранние npm suites; последующие native/CLI/bundle steps ещё не выполнялись, весь CI не PASS. Draft PR41 https://github.com/lobanov0710-blip/uber-v3/pull/41 от PR40. Tree parity проверена, полный CI повторяется на исправлении. Provider/credentials/remote D1 не использовались.


## Atomic review: изоляция obsolete evidence — 2026-11-17

Дополнительный анализ выявил лишнюю инвалидизацию: новый trigger0024 реагировал на invalidation любой исторической assessment той же машины. Изменение старого selected документа после новой проверки по другим документам могло сбросить актуальное одобрение. Исправлено WHEN по последней sequence этого автомобиля; old history invalidation сохраняется, но не снимает допуск актуального независимого результата. Это исправление принятого scope selected evidence, не новое бизнес-правило. Добавлен11-й regression и native workflow obsoleteEvidenceIsolation: после новой проверки/approved изменение obsolete документа сохраняет новый class/status/revision. Полный CI повторяется на исправлении; sourceb4cac2eca137aabe18a47879644ac4661bad347a/CI44128288418 относится к предшествующему варианту и не является окончательным доказательством нового guard. Real data/deploy отсутствуют.


## Atomic review: второй CI и populated native fixture clone — 2026-11-17

Sourceb4cac2eca137aabe18a47879644ac4661bad347a/tree45f6a0473828e15546fa6494967eca4469f0bfc4, CI44128288418/job134198016208 FAILURE. Все77 npm scripts и10 тогдашних new cases PASS;24 migration/preflight12/reference6/audit также PASS. Первый native availability harness после добавления полной схемы ставил live triggers до копирования уже заполненной SQLite fixture. Vehicle INSERT повторно создавал first-save bindings, затем копирование их сохранённых строк правильно падало на UNIQUE. Исправлен порядок только клонирования: tables/index → точные rows → проверка полного before/after snapshot всех project tables → views/triggers → actual native workflow. Ни production triggers, ни FK/UNIQUE/guard не отключаются; все они действуют при проверяемых операциях. Остальные native harness создают пустую схему и затем seed через работающие triggers, для них порядок корректен. Полный CI повторяется вместе с исправлением obsolete-evidence scope; ошибки не скрыты, native/CLI/bundle пока не PASS.


## Atomic review: итоговый CI PASS — 2026-11-17

Проверенный source db77501734115d07b5ada4034e09ade6290a0ede, tree ffec930fba73dabfb736c42ba44ac5245d571566, CI44129315936/job134201671230 SUCCESS: все28 steps,77 npm commands,11 новых cases,24 migrations,12 preflight,6 reference,13 native D1 workflows,6 protected CLI,audit0,Worker dry-run. Native явно подтвердил legacyApprovalBypassDenied,serverClassOnApproval,correctionUsesCurrentRule,bindingHistoryPreserved,offline,reapprovalDoesNotReleaseTrip,lineAndPhaseBlocked,bothDonePathsBlocked,noAutomaticReplacement,atomicCorrectionAuditRollback,obsoleteEvidenceIsolation,populatedUpgradePreserved/rollback/FK/quickCheck. Для последней версии класса не используется старый0019 candidate. Local source6b85841f566f54d4a086c468e40b6f48c85e8f87 и remote tree совпадают; hashes/границы в ATOMIC_VEHICLE_REVIEW_VERIFICATION_2026-11-17.json.

Предыдущие failed44127749679/44128288418 сохранены с причинами и исправлениями. Авторизованная synthetic replay fixture не заменяет реальные HTTP/MFA tests, native trigger cloning не отключает рабочие ограничения. Дополнительный manual анализ устранил лишний revoke от obsolete evidence;11-й regression есть в actual SQLite и native D1. Draft PR41 https://github.com/lobanov0710-blip/uber-v3/pull/41 от PR40. Следующий docs-only checkpoint добавляет receipt/итог и уточняет описание исходной/целевой revision в OpenAPI, не меняя поля/лимиты/права и проверенный code source. Контракт дополнен текущим этапом, канонические журналы синхронизируются append-only.

Сделаны атомарные corrections, старый approved/final registration guard и постоянная остановка конкретного назначения. Это не общий assessment guard всех admission paths: legacy без trusted года и expiry evidence без изменения строки, public classification POST, trusted GET/history/evidence и Admin UI ещё pending. Нового driver никто автоматически не назначает; passenger informing/полный manual handoff — отдельная интеграция/E2E. Android runtime не менялся, новый APK/Android CI отсутствует; прежний color baseline sourcee5712c969049fb6670fd64863db189f3d32eb038/CI44089001617 самостоятельный. G1paused,D4–D7pending; нет seed/backfill/remote migration/real sensitive data/merge/deploy/OWNER-phone expansion.


## G2: единый assessment admission guard — 2026-11-17

После PR41 в отдельной arch/g2-vehicle-admission-guard добавлен trustedVehicleGuard: current latest assessment/binding/matching STS/year, candidate и matching system class, обязательный color и свежая expiry относительно MAX(server time,SQL UTC now). Применён к on_line,assign/reassign,phase,guarded/legacy done, precheck/advisory и существующему approved/final registration (без matching старого class на отдельном class projection). Legacy approved/class или0019 candidate/флаг не считаются доказательством. Убран done fallback без active assignment — нет автомобиля для проверки. Manual canceled/off_line сохраняются, новые права/автопереназначение не добавлены. Цвет/unrelated revision/new head не меняют pin. Естественная expiry не требует row mutation, guard запрещает новые операции, не выдумывает новую background policy и не переписывает историю.

9 новых real SQLite/auth/HTTP cases PASS, native workflow повторяет действительные HTTP/MFA review/approval/line/assign/reassign/phase и direct SQL deny при expiry,оба done paths,no assignment,legacy negative,manual cancel/offline. Time-only race имитируется сменой SQLite clock между precheck и batch; исходная тестовая override была нулевой арности и не заменяла julianday('now'), исправлена на один аргумент без ослабления assertion. Граница expiry<=now закрыта; stale server time не продлевает доказательство. Дополнительно0019 candidate и новое manual/excluded не дают обойти guard через projection.

Старые положительные operational fixtures закономерно перестали проходить без доверенного состояния. Теперь явно готовятся rule до first save, год/цвет, immutable assessment, STS и audit (только tests, не product/negative legacy). Node/D1 helper требует уже корректную привязку и данные, ничего не backfill в runtime. Fixture audit выделен literal namespace, утверждения actual operation audits считают изменения отдельно; actual app аудит не исключается и не удаляется. Для трёх terminal replay/rollback позитивных cases явно добавлен active assignment, отсутствие assignment проверяет новый negative test. При механической правке test audit SQL были JS quote/повторный WHERE, исправлены; 14 replay/7 terminal снова PASS. Три photo/support assertions учитывали теперь и два preparation audit — исправлен helper подсчёта только операции, проверка exact audit/replay/rollback сохранена. Clock slot terminal guard проверен по реальному timestamp?4. Одно устаревшее имя assignment OpenAPI при поиске не найдено, без изменения исходников.

Локально9 new,15 Admin assignment read,12 vehicle read,7 availability,14 replay,7 terminal,11 atomic,16 trusted,17 binding,6 photo lifecycle,5 photo/support,5 support lifecycle и связанные service/repository suites PASS. 24 migrations,12 preflight,6 reference PASS. Полный78-command/14-native CI ещё предстоит, локальные subprocess/socket ограничения не обходятся. Scope VEHICLE_ADMISSION_GUARD_2026-11-17.md. Новых schema/зависимостей нет. Public review POST/GET trusted/history и Admin UI ещё pending; полный powertrain121/legacy rollout не активирован. G1paused,D4–D7pending; нет seed/backfill/remote migration/merge/deploy/real data/OWNER-phone expansion/нового APK/Android CI.


## Admission guard: первый CI и positive push fixture — 2026-11-17

Source9b1637c9a9291bdf4891f9012d834af6af1ec687/tree120a0680aa2dfdb3abba673016849e14efdb79ca, CI44182941687/job134391790606 FAILURE в orderAssignmentPush.test. Старый подставной candidate возвращал approved без нового SQL field vehicle_classification_valid, поэтому fail-closed precheck правильно вернулfalse. Добавлено явное значение1 только в positive fake row теста уведомлений (как в двух уже обновлённых service fixtures); runtime guard/classification и assertions события/повторного уведомления не ослаблены. Локальный test:order-assignment-push PASS после исправления. Positive mutation/expiry защиты проверяются независимо actual SQLite/native, флаг клиента не принимается. До первого сбоя migration24/preflight12/reference6/dependency audit и ранние npm suites прошли; последующие native/CLI/bundle ещё не исполнялись, весь CI не PASS. Draft PR42 https://github.com/lobanov0710-blip/uber-v3/pull/42 от PR41. Tree parity проверена, полный CI повторяется; raw credentials/real messages/provider calls отсутствуют.


## Admission guard: точка остановки после прерванной публикации — 2026-11-17

Вызов GitHub-публикации исправления positive push fixture прерван; подтверждение его завершения не получено. Локальный код сохранён: source9f9504f6e775f2f4d402960be117670116be749c/tree9dbeddf70927798fbca846669c0596ca183c6a7c, working tree до этой записи чистый. Локальные9 новых actual admission scenarios и исправленный order-assignment-push PASS. Последний подтверждённый remote source9b1637c9a9291bdf4891f9012d834af6af1ec687/tree120a0680aa2dfdb3abba673016849e14efdb79ca, draft PR42, CI44182941687 FAILURE на старой positive push fixture; итоговый повтор CI не подтверждён. Не выдавать локальные PASS за полный CI.

Временный functions store оказался пустым, состояние было восстановлено из local git/файлов и ранее подтверждённых GitHub SHA, без обхода прав/проверок. Публикация могла частично выполниться до прерывания; отсутствие локальной remote-state receipt не доказывает отсутствие remote commit/ref update. Следующий шаг только read-only reconciliation: прочитать head arch/g2-vehicle-admission-guard, сравнить tree с9dbeddf70927798fbca846669c0596ca183c6a7c и проверить соответствующий workflow. Не повторять запись/создание commits вслепую; update_ref только с актуальным expected_sha. Canonical журналы не объявлены синхронизированными для этого этапа. Remote migration/merge/deploy/новый APK не выполнялись. G1paused,D4–D7pending.

## Admission guard: результат сверки после прерывания — 2026-11-17

Read-only GitHub API подтвердил: ветка `arch/g2-vehicle-admission-guard` и открытый draft PR №42 указывают на `9b1637c9a9291bdf4891f9012d834af6af1ec687`, tree `120a0680aa2dfdb3abba673016849e14efdb79ca`. Для ветки найден один запуск CI: `44182941687`, статус `completed`, результат `failure`. Исправление positive push fixture из локального `9f9504f6e775f2f4d402960be117670116be749c` в head ветки не опубликовано; повторного запуска нет. Пограничное состояние ветки устранено сверкой, запись в GitHub при этой сверке не выполнялась.

Локальная точка остановки сохранена отдельным docs-коммитом `8a71690`; исправление и результаты локальных проверок сохранены. Следующий шаг для возобновления: опубликовать исправление с актуальной проверкой head, дождаться полного CI, разобрать возможные ошибки и только после подтверждения зафиксировать итоговую проверку и синхронизировать канонические журналы. Полный CI, выпуск APK, merge и deployment не объявляются выполненными.

## Admission guard: возобновление проверки — 2026-11-18

По команде владельца «Продолжаем» восстановлена среда. Сверены AGENTS.md, утверждённый порядок G2 и журнал. GitHub head по-прежнему `9b1637c9a9291bdf4891f9012d834af6af1ec687`; чужих изменений в ветке при сверке нет. Повторены `test:order-assignment-push` и `test:vehicle-admission-guard`: PASS, все 9 новых сценариев без пропусков. Публикуется сохранённое исправление одной положительной тестовой фикстуры вместе с записями о прерывании и сверке. Runtime-проверки допуска не ослабляются, бизнес-правила и полномочия не меняются. Полный CI до получения результата остаётся pending; G1 на паузе, D4–D7 ожидают утверждения. Remote migration, merge, deployment и выпуск APK не выполняются.

## Admission guard: полный npm PASS, исправление native-скрипта — 2026-11-18

Исправление опубликовано: source `5577f8c17d13c2ffaa1abdee54dc29930e1924fc`, tree `788b28ba307b9e12dbdc15fc28bca76852ada49e`; local source `0b4b7676518fd333a6620301c7221254aa49403e`, tree parity подтверждена. CI `44229768142` / job `134551646267`: FAILURE на первом native D1 шаге. До этого успешно выполнены все 78 npm-команд, dependency audit, 24 migration smoke, 12 preflight и 6 reference checks. Причина остановки — конфликт кавычек JavaScript/SQL в запросе подсчёта audit в `tools/check_availability_d1.mjs`. Исправлены только внешние кавычки; SQL, исключение помеченных fixture audit, реальные operation audit assertions и production-код не менялись. Локальная синтаксическая проверка всех 38 затронутых JS/MJS и native D1 скриптов: PASS. Полный native/CLI/bundle результат ещё не получен; CI повторяется на исправлении, предыдущий сбой сохраняется в журнале.

## G2: единый контроль доверенного допуска проверен — 2026-11-18

Финальный проверенный source `3daddf4d1d8d9e492cb352f971a40b16e53b8c1a`, tree `459c59598901d3ccce891c96daa21b9ba836045f`; local source `edec14ba8e1b47af2d6d6be32e11a8d5959b20f5` имеет тот же tree. CI `44230028222` / job `134552504408` SUCCESS: все 29 steps, 78 npm-команд, 9 новых admission cases, 24 migrations, 12 preflight, 6 reference checks, 14 native workerd/D1 workflows, 6 protected OWNER CLI scenarios, dependency audit 0 и Worker bundle dry-run PASS. Native admission подтвердил positive line/assign/reassign/phase, expiry без изменения строк, отказ обоих done paths и done без назначения, direct SQL guards, отказ legacy без proof, сохранение manual cancel/offline; FK и quick_check PASS. Остальные native workflows подтвердили сохранность MFA, прав, immutable history, audit rollback и populated upgrades.

Ручная сверка SQL-путей подтвердила повторную проверку доверия непосредственно в записи; advisory bool не заменяет SQL guard. Helper принимает только внутренние SQL alias/placeholder, не вводит пользовательский SQL или новый вывод evidence/credentials. Исправления двух выявленных сбоев касаются положительной notification fixture и кавычек native-скрипта; runtime-защита и audit assertions не ослаблены. Предыдущие failed CI `44182941687` / `44229768142`, прерывание и read-only восстановление состояния сохранены выше. Точные hashes проверенных исходников, все step conclusions, native witnesses и границы — `VEHICLE_ADMISSION_GUARD_VERIFICATION_2026-11-18.json`. Последующие docs-only commits не подменяют проверенный source SHA. Draft PR №42 остаётся отдельным зависимым PR от №41.

Следующая утверждённая часть: public review и trusted GET/evidence/history, затем Admin DTO/readonly class/форма проверки/подтверждение/privacy и Android acceptance. Полный powertrain121/legacy activation inventory остаётся открытым. Backend CI не является live-приёмкой всего классификатора. Новых dispatcher powers, seed/backfill, remote migration, merge, deployment, OWNER-phone расширения, реальных чувствительных данных и нового APK нет. Последний проверенный Android baseline — source `e5712c969049fb6670fd64863db189f3d32eb038`, CI `44089001617`; Android в этом этапе не менялся. G1 на паузе; D4–D7 ожидают отдельного утверждения. Канонические журналы обновляются отдельными append-only docs-записями с теми же проверенными SHA и границами.

### Подтверждение публикации и синхронизации журналов — 2026-11-18

Verification receipt опубликован docs-only commit `3e4d692092da39f28c87c629056c18bd8f0ea90d`, tree `95e2317228ce094b649c32b8f6b2cdb4336c482d`; удалённый файл побайтно совпал с локальным. PR №42 обновлён итоговым поведением, проверенным source/CI и открытыми частями плана; остаётся draft, merge не выполнен. Канонический TransferDriver `arch/spec-v1-security-baseline` обновлён до `47534a7d3c0c2d216f4e36ef87391ef87ff9607d`, backend `arch/spec-v1-backend-phase1` — до `e7c47a4970fbe78c39f75a58bfe97d09ad01d754`; последующее read-only чтение обоих refs подтвердило эти SHA. Каждый канонический commit меняет только `docs/PROJECT_JOURNAL.md`: 11 добавленных строк, 0 удалённых; AGENTS.md и runtime не затронуты. Все ref updates выполнены с expected head, без force. Этот финальный checkpoint содержит только журнал и не меняет проверенный source `3daddf4d1d8d9e492cb352f971a40b16e53b8c1a`.

## G2: public classification/review и доверенная история — 2026-11-18

Продолжен следующий утверждённый срез в отдельной `arch/g2-admin-classification-review` от PR №42. Сверены AGENTS.md, контракт/OpenAPI, решения владельца и журнал. POST review подключён к проверенному atomic recorder с явной проекцией ответа без internal assessmentId; verified GET/evidence и история подключены к trusted storage. История по 50 строк, cursor привязан к автомобилю/actor и vehicle revision/max sequence; scope mismatch/malformed — 400, stale — 409. Каждая страница проходит SQL current access/session/MFA и атомарный read audit. Natural expiry и permanent invalidation возвращают null текущей проверки, сохраняя history. Никаких content/keys/URL/PII/free reason в проекции.

Анализ обнаружил отсутствие проверки исправляемой make по утверждённому перечню во внутреннем recorder: перед public подключением добавлена та же allowlist, что используется в правилах/Driver. Новые марки не добавлялись. Новые права диспетчерам не выдаются; OWNER exception по фактическому серверному MFA, existing vehicles.verify сохранён. Итоговое approved остаётся отдельным, класс не приходит от клиента. Corrections/off_line/hold и manual dispatcher handoff используют уже проверенную атомарную реализацию.

Первая локальная new suite: 7 PASS/1 FAIL, потому что negative fixture пыталась создать запрещённый dispatcher grant и правильно получила DB trigger error. Исправлен тест: он явно проверяет отказ SQL grant и затем отказ exception API; constraints не отключались. Расширенная suite 9 PASS, включая manual/excluded и natural expiry. При проверке прежних suites выявлены устаревшие ожидания закрытого 404 и лишний idempotency conflict от нового HTTP probe. Обновлены по реализованному контракту: malformed public payload — 400, public same-actor/body/key replay — 200 без новой записи. Тесты исходного storage/replay/rollback сохраняются; продакшен-защита не ослаблена. Scope: ADMIN_CLASSIFICATION_REVIEW_API_2026-11-18.md. Полный CI/native/CLI/bundle пока pending; локальный PASS не заменяет его. Android/UI/новый APK ещё следующий этап; G1paused,D4–D7pending, нет remote migration/seed/backfill/merge/deploy/real data/OWNER-phone expansion.

Перед публикацией локально PASS: 9 public API cases, 16 trusted storage, 20 rule API, 11 atomic review, 9 admission; 24 migration smoke, 12 preflight, 6 reference и синтаксис 23 затронутых/native JS/MJS. Shared native scenario проверяет те же actual HTTP/auth/MFA, correction/hold, 51 assessment, страницы/scope/stale cursor и read/write rollback. Полный CI теперь содержит 79 npm-команд и 15 native workflows; он ещё предстоит. Remote parent PR №42 сверён: `9ca3860df9f4f540366ed396a91de841ec8076fc`; новая remote ветка отсутствует, чужие изменения не затрагиваются.

## Public classification API: первый CI и native schema dependency — 2026-11-18

Опубликован source `92168663fb5b0cdfbdc4b6f53c5371036513160f`, tree `abfd21414005f25b7e93c939bd752bfdb6784a29`, local `8c980995e22a6001dee45c3593fca60a76867e72`; tree parity подтверждена. [Draft PR №43](https://github.com/lobanov0710-blip/uber-v3/pull/43), база PR №42. CI `44240460978` / job `134586814612` FAILURE: все 79 npm-команд, migration/preflight/reference/audit и первые 10 native workflows PASS, затем старый rule API native harness вернул 500 вместо 200 на classification GET. Причина подтверждена кодом: populated upgrade fixture останавливался на schema22, а актуальный GET требует trusted view из23. Исходные assertions populated21→22, rollback и no seed сохранены; после них harness теперь применяет уже существующие23/24 для текущего runtime и проверяет отсутствие выдуманных assessments. Production-код и миграции не менялись, security checks не обходились. Синтаксис исправленного script проверяется; полный CI повторяется.

## G2: public review и доверенная история проверены — 2026-11-18

Финальный проверенный source `5836e183f86c656c17bf77f77bb94e968f730df5`, tree `0d8b0dcf52393db97e4bf532be8e6f8e784c52fd`; local `95fddd1a100ea5402b8701b8f82ba3167c61cfd4` имеет тот же tree. CI `44240856017` / job `134588130917` SUCCESS: все 30 steps, 79 npm-команд, 9 новых actual HTTP/SQLite cases, 24 migrations, 12 preflight, 6 reference, 15 native workerd/D1 workflows, 6 protected OWNER CLI scenarios, dependency audit 0 и Worker bundle dry-run PASS. Новый native workflow подтвердил public review/replay по настоящим staff/OWNER MFA, correction/current rule, раздельное approved, off_line/manual dispatcher hold, 51 assessment/две страницы без дублей, actor/vehicle scope и stale cursor, permanent invalidation, read/write audit rollback, minimal projection, FK и quick_check. Historical rule harness дополнительно подтвердил runtimeSchema24 при сохранённых populated21→22/rollback/no seed. Реальных Cloudflare requests в synthetic workflows нет.

Ручной анализ чтения/записи: строгая форма review и make allowlist, bounded body, серверный класс, явная публичная проекция без internal assessmentId; trusted metadata/evidence из current view, минимальная immutable history вместо свободного reason/PII/ключей/URL. Cursor не предоставляет доступ: каждый запрос повторяет фактические права/session/MFA в audited batch; natural expiry и permanent invalidation не выдаются за текущую проверку. Старые версии и история не переписываются. Найденные локальные fixture failures и failed CI сохранены выше; SQL ограничения и audit checks не ослаблены. Exact source hashes, все step conclusions, native witnesses и ограничения — `ADMIN_CLASSIFICATION_REVIEW_API_VERIFICATION_2026-11-18.json`. Последующие docs-only commits не заменяют проверенный code SHA. Draft PR №43 остаётся отдельным, не merged.

Далее по утверждённому контракту — Admin DTO/UI с введёнными/проверенными параметрами, реальной/сопоставленной моделью, readonly class, условиями/основанием, confirmation, foreground privacy и Android acceptance. Full powertrain121/legacy activation inventory/live acceptance ещё открыты. Нет новых dispatcher powers, schema/dependencies, seed/backfill, remote migration, merge, deployment, реальных sensitive data, OWNER-phone allowlist расширения или нового APK. Android runtime не менялся, его отдельный baseline `e5712c969049fb6670fd64863db189f3d32eb038` / CI `44089001617` не подменяется backend-проверкой. G1paused,D4–D7pending. Канонические журналы синхронизируются append-only отдельно. Временный dependency symlink удалён; общий node_modules и исходные рабочие папки не изменены.

### Подтверждение публикации public API и синхронизации — 2026-11-18

Receipt/scope/результаты опубликованы docs-only commit `f0e5a2b4eb757d733018553aa9c30196b12d5b99`, tree `30633c2c2dd50b8ac47595d2c6e33beae6101b79`; удалённый receipt побайтно совпал с локальным. PR №43 обновлён итоговым поведением, проверенным source/CI и открытыми частями; остаётся draft, не merged. Канонический TransferDriver `arch/spec-v1-security-baseline` — `504c90e96f01a273be6749e31d23a2b29505f7b6`, backend `arch/spec-v1-backend-phase1` — `f4c542adbb77f7a436efa3bcbdef05e45292102d`; последующее чтение refs подтвердило эти SHA. Каждый канонический commit меняет только `docs/PROJECT_JOURNAL.md`: 11 добавленных строк, 0 удалённых, AGENTS/runtime не меняются. Ref updates выполнены с expected head без force. Этот последний checkpoint — только журнал; проверенный source `5836e183f86c656c17bf77f77bb94e968f730df5` не подменяется docs SHA.


## G2: readiness audit и локальная инвентаризация — 2026-11-18

По команде владельца «Далее» сверены AGENTS, утверждённый контракт, план и журналы.
Продолжена следующая часть после OWNER editor PR19. Новая отдельная ветка
`arch/g2-classifier-readiness-audit`; backend parent PR43 head
`84bcb31655b9a952816a226c1807d5a243e20bcb`, Android docs parent PR19 head
`eaea54a7bfb64439eec08bb60d55cb2188341f5d`. Heads сверены read-only через GitHub.

CSV121 SHA256 `553384af5b49252d3b3acbc3973ef6dae7fc40d348156debf4f0fab24c5ae880`
сохранён: 76/22/23, годы/поля/порядок без изменений, архив116 не изменён.
Новый реестр учитывает121 правило: 9 mixed families с частичными первичными
свидетельствами,112 pending; полного покрытия всех поколений/лет/рынков нет ни
у одной строки. Уточнён источник SpaceTourer: бензин в статье относится к
Berlingo. S9 получает первичный HIMA source; Avatr12 имеет hybrid trim, но кузов
и фактический автомобиль не объявлены проверенными. BEV-удаления/L7-L9 сохранены.

Подготовлен offline Python aggregate inventory: существующий закрытый snapshot,
mode=ro+immutable/query_only, одна read transaction, fixed SQL/deny writes и
functions/ATTACH, reject WAL/sidecars, безопасный отказ без raw error/path/PII,
18 счётчиков, всегда admissionEvaluated=false/activationAuthorized=false.
Только синтетические файлы; реальная legacy inventory НЕ выполнена. Данные
snapshot не запрашивались/не загружались. Runtime/API/schema/Android не менялись.

Локально11 новых tests,24 migrations,12 preflight,6 reference PASS. Новые tests
добавлены в штатный CI. При подготовке исправлены ошибки синтетической фикстуры:
число owner-binding columns, длина VIN, уникальность document object key; первые
запуски были FAIL, после исправления11 PASS. Локальный общий npm остановился
на существующем ownerMfaControlPlaneCli: spawnSync EPERM/пустые streams в этой
среде; это не PASS и не доказательство дефекта runtime. Полный Node22/native
D1/CLI/dependency audit/Worker dry-run ожидается в GitHub CI, ограничения не обходились.

Подробности: VEHICLE_CLASSIFIER_READINESS_2026-11-18.md и machine-readable
VEHICLE_POWERTRAIN_AUDIT_2026-11-18.json в backend. До активации нужны полный
powertrain обзор, реальная защищённая инвентаризация и рассмотрение плана пробелов.
Нет seed/backfill/remote migration/merge/deploy/нового APK/расширения OWNER-phone
или dispatcher powers. G1paused,D4–D7pending. Android только docs, прежняя
проверка PR19 сохраняется отдельно. CI/публикация фиксируются следующим checkpoint.


## G2 readiness: совместимость inventory до миграций — 2026-11-18

Первый source `8fbc3c3e4930c3efe11cc3e37a34a5b8799f8c04`, tree
`7ee1245a91be11f0b6dcb6d750dffd05bda04024`, draft backend PR44: CI
`44333828910` / job `134904994763` SUCCESS (все30 steps):79 npm commands,
11 новых inventory tests,24 migrations,12 preflight,6 reference,15 native D1
workflows,6 actual Wrangler CLI scenarios, audit0, Worker dry-run PASS.
Raw logs проверены; real Cloudflare requests0 в CLI/новых classification scenarios.
Android docs-only draft PR20 опубликован отдельно от проверенной сборки PR19.

При сверке порядка внедрения найдено ограничение первого inventory: требовал
новую схему0024, хотя legacy нужно оценивать до миграций. Исправлено: поддержка
базовой Driver schema и последовательно отсутствующих слоёв классификатора,
явные schemaCapabilities; частично сломанный уже существующий слой отклоняется.
Год/доказательства/кандидаты не выдумываются. Ноль записанных BEV/holds при
отсутствующем слое не является подтверждением отсутствия проблем. Пустой цвет
включает Unicode whitespace по правилам trim. Добавлены реальные синтетические
pre-classifier, broken trust и whitespace cases:14 tests PASS локально.

Первая CI проверка11 tests сохранена как успешная предыдущая версия. Изменённый
инструмент проходит новый полный CI; старый PASS ему не приписывается. Пределы
121 audit/реальной inventory/активации и запреты публикации чувствительных данных,
G1paused,D4–D7pending сохраняются. Ошибки patch context при обновлении отчёта не
изменили файлов; контекст перечитан, документ обновлён. Бизнес-правила не менялись.


## G2 readiness: финальная проверка исправленного inventory — 2026-11-18

Source `a3dc5bd299cd063bbeee4f1195ac5d6e656faabb`, tree `cac28aa06c0688af58efb228869ff99add848e7d`,
local `bf550cd5ff47d56ab825070149fed8169fbe48a3`: tree parity подтверждена. CI
`44334924707` / job `134908905914` SUCCESS, все31 steps:
14 inventory tests,79 npm-команд,24 migrations,12 preflight,6 reference,
15 native workerd/D1 workflows,6 protected CLI scenarios с actual Wrangler4.125.0,
dependency audit0 и Worker bundle dry-run PASS. Raw decoded job log и точный
head проверены. Первая CI44333828910 с11 inventory tests также SUCCESS;
локальный EPERM и исправленные ошибки фикстур не скрыты предыдущими записями.
Уточнение счётчика шагов: GitHub добавляет финальный Complete job; прежние30
в предварительной записи были без него. Финальный API возвращает31 SUCCESS.

Новая проверка подтверждает чтение pre-classifier snapshot без миграций,
явные schemaCapabilities, безопасный отказ для повреждённого слоя/WAL/sidecars,
отсутствие raw PII/errors, запрет записи/ATTACH/extension, expiry без invalidation,
immutable hold/offline, отсутствие выдуманного года/pin/trust. Runtime/schema/
зависимости backend не менялись; после CI публикуются только docs/receipt.
JSON receipt: VEHICLE_CLASSIFIER_READINESS_VERIFICATION_2026-11-18.json.

Draft backend PR44 и Android docs PR20 остаются открытыми; не merged.
CSV121 и архив116 сохранены. 9 семейств имеют частичные первичные свидетельства,
112 pending в реестре; это не исчерпывающий обзор годов/поколений/рынков.
Реальная inventory/обработка legacy/активация/live acceptance остаются открытыми.
Нет real sensitive data, remote migration, seed/backfill, deployment, нового APK,
расширения OWNER-phone или dispatcher powers. Android docs-only; отдельный
проверенный PR19 baseline сохраняется. G1paused,D4–D7pending.
Следующий шаг — продолжить powertrain evidence и подготовку защищённой реальной
инвентаризации в рамках отдельно утверждённого доступа; новые допуски не назначены.


## G2: первый powertrain проход всех 121 семейств — 2026-11-18

По команде «Далее» сверены AGENTS, актуальный план, журнал и remote feature/
canonical heads. Продолжены существующие отдельные draft ветки PR44/PR20.
G1paused,D4–D7pending; новые производственные действия не разрешались.

К 9 исходным первичным источникам добавлены102: всего111. Для каждой121 строки
найдено хотя бы частичное первичное свидетельство ДВС/гибридного исполнения;
строк без семейного источника0, исчерпывающе проверенных диапазонов лет/рынков/
поколений0. Это первый проход семейств, не снятие activation gate и не проверка
фактических авто. Revision2 ledger сохраняет все поля121 CSV и archive116/hash.

Lexus ES имеет BEV/HEV в первичной публикации; существующий hard BEV guard и
каталог не менялись. BMW i5/i7, EQV/eVito, ID.Buzz и иные соседние названия не
превращены в alias. SAIC G10 MY2025 даёт точное имя и petrol/diesel; LDV G10+
cargo/вторичные продавцы отклонены как доказательство passenger Maxus G10.
Точная таблица Opel Italy ZAFIRA LIFE diesel найдена в первичном индексе;
прямой fetch PDF timeout, полного чтения не заявлено. Публикации, indexed
excerpts и доступные PDF passages различены evidenceAccess. Некоторые ранние
источники лежат вне minYear, это явно ограничено scope; годы не выдумываются.

Подготовка поиска выявила пустые выдачи по неверным/узким доменам,404,403 и
redirect; использованы доступные первичные источники/индекс с явными пределами,
не обход авторизации. В локальном черновике исправлено разбиение FAW / Bestune
B70; Bestune/T90 отдельно как утверждено, actual CSV не менялся. Raw статьи/
руководства не копируются в Git; сохраняются короткие пересказы/URL/дата/пределы.

Найден вопрос: официальные UNI-V/B70 названы лифтбеками при разрешённых
sedan/crossover в Комфорте. Утверждённого тождества в repo не найдено.
Владельцу сразу отправлен вопрос: разрешить отдельный liftback только Комфорт
или сохранить ограничения. Ответ пока ожидается; вариант не выбран, время не
считается согласием. Зависимые enum/schema/API/body-rule changes не начаты.
См. VEHICLE_BODY_POLICY_CLARIFICATION_2026-11-18.md.

Изменения только docs. Новый полный Android/backend CI не требуется для этих
текстов; проверенный runtime source a3dc5bd299cd063bbeee4f1195ac5d6e656faabb /
CI44334924707 остаётся отдельным baseline, не объявлен тестом новых ссылок.
Проверки целостности данных/границ и публикация фиксируются следующим checkpoint.
Нет real vehicle data, remote inventory, seed/backfill/migration/merge/deploy,
нового APK/активации/расширения OWNER-phone или dispatcher powers.


## G2: проверки revision 2 powertrain evidence — 2026-11-18

PASS:121 исходных rule rows/порядок/поля совпадают с актуальным CSV; архив116 и
оба фиксированных SHA256 сохранены.111 уникальных source IDs и HTTPS URL без
embedded credentials; все row references разрешаются, пары brand/model точные,
9 прежних source records сохранены.121 partial,0 exhaustive,activation blocked,
actual legacy inventory false. Ledger SHA256
`8df887adebca225eb9b6c3fc0b08351f384ad2623849ba11307538d0257883ff`.
6 existing vehicle reference tests PASS. Runtime tool/test/workflow SHA256
сверены с receipt source a3dc5bd299cd063bbeee4f1195ac5d6e656faabb — без изменений;
в diff только docs. diff --check PASS в обоих worktrees. Новые Android/backend
CI/APK не запускались и не объявляются проверкой этих документов. Исторический
receipt остаётся привязанным к прежнему source, новый ledger проверен отдельно.
Вопрос лифтбеков pending; никакое решение за владельца не принято. Публикация
в PR44/PR20 и append-only канонические журналы выполняется после этих проверок.


## G2: опубликован первый проход 121 семейства — 2026-11-18

Backend docs source `0fd9cd414fbedb02ac43c3a59ee906664e0cd73a`, tree `81197f2d8f63c026af10d73d265fdfb9b910e61b`,
local `35e736a8de39cc828735ff6e0c8b4d543235e165`; Android docs source `7267d682caaebc96253ae0e2b9e63dc876443eae`,
tree `6400a0f667d50c440f2c925f826f8a092d8fd600`. Локальные/remote trees совпали при публикации;
PR44/PR20 остаются draft, remote branch обновлялись с expected-head без force.
Все121 строки имеют частичное первичное свидетельство;111 источников,
0 исчерпывающих диапазонов. EvidenceAccess/пределы индекса/timeout сохранены.
Verification receipt: VEHICLE_POWERTRAIN_EVIDENCE_VERIFICATION_2026-11-18.json.
6 reference PASS и целостность ledger/hash/ссылок/исходных строк PASS. Runtime
hashes прежнего CI44334924707 source a3dc5bd299cd063bbeee4f1195ac5d6e656faabb
не изменились. Этот этап docs-only, нового полного CI/Android APK нет.
Вопрос лифтбеков ожидает решения владельца; body enum/guards и business/minivan
не менялись. Исчерпывающий обзор/actual legacy inventory/активация не закрыты.
G1paused,D4–D7pending; нет seed/backfill/remote migration/merge/deploy/real PII.
Канонические журналы синхронизируются отдельным append-only checkpoint.


## G2: OWNER утвердил лифтбек только в Комфорте — 2026-11-18

В ответ на предложенный выбор владелец сказал «Только в комфорте». Решение
явное, повторного утверждения не требуется: отдельный liftback разрешён только
для comfort, включая запрет business/minivan/OWNER exception bypass. Сохранены
Li Auto L7/L9 crossover exceptions, BEV запрет, pin/history, проверка года/
документов, class вычисляет backend; авто не получает допуск автоматически.
Обновлены AGENTS и решение. Новые отдельные worktrees/ветки
arch/g2-comfort-liftback созданы поверх проверенных PR44/PR20. G1paused,D4–D7pending.

Перед реализацией исследована SQLite миграция с FK ON: простая замена parent
таблицы с RESTRICT children завершилась FK failure только в in-memory probe;
данные проекта не затронуты. Выбран явный атомарный rebuild трёх связанных
assessment/invalidation/hold таблиц с сохранением идентификаторов, всех значений,
rowid, FK и NOT NULL/CHECK; временного кодирования liftback как other не будет.
Populated upgrade/rollback и запрет записи/изменения истории обязательны в tests.
Backend/Admin проверки и полные CI ещё не выполнены для нового изменения.
Remote migration/seed/backfill/merge/deploy/реальные данные не выполняются.


## G2: подготовлена реализация liftback только для comfort — 2026-11-18

Backend enum/API/decision/SQL guard и миграция0025, Admin DTO/body selector/
readonly label/OWNER checkbox/confirmation обновлены в новых отдельных ветках.
minivan null policy не обходит liftback restriction. Старые definitions/pins и
неявный fallback2 сохранены, SQL требует явного liftback в definition. Driver
runtime не меняется. Body metadata ledger теперь отражает утверждение OWNER,
но ranges/actual inventory/activation остаются открытыми.

Локально2 новых populated upgrade/HTTP/SQL/policy tests PASS,16 trusted assessment
и9 admission cases PASS,25 migration smoke/12 preflight/14 inventory/6 reference
PASS. Android security8/5 и native runner5 PASS. Исправлена ошибка нового replay
test: requestId каждого HTTP запроса новый, неизменный receipt сравнивается
отдельно; серверный replay не менялся. Один локальный запуск неверного имени
adminVehicleRules.test.mjs получил MODULE_NOT_FOUND; правильный npm script
adminVehicleRuleApi запускается отдельно, это не дефект runtime/успешный тест.
3 JVM и2 native UI cases добавлены, полные Android/backend CI ещё pending.
Screenshots используют liftback в тех же synthetic states; никаких real data.
Описание/пределы: COMFORT_LIFTBACK_IMPLEMENTATION_2026-11-18.md.


Локальный правильный `npm run test:admin-vehicle-rules` завершён:20 tests PASS. Новый liftback workflow повторён после добавления HTTP unknown-body отрицательного случая:2 tests PASS. Перед публикацией diff --check PASS; полные CI и Android JVM/native остаются pending.


## Liftback: первый backend CI и ограничение snapshot проекта — 2026-11-18

Первый source20c9f3b45823437ae78b2e04e0d1c70cd4193ef0/tree81f59a7f94407d5ade65337133f4ddcead4ed7f7
в draft PR45: CI44358568865/job134993291607 FAILURE на новом native upgrade
шаге. До него80 npm-команд,25 migrations,12 preflight,14 inventory,6 reference,
audit0 и15 прежних native D1 workflows PASS. Ошибка тестового snapshot: общий
перечень sqlite_master включал защищённую provider metadata table, которую D1
запрещает читать. Миграция на native engine ещё не выполнялась в этом тесте;
успех populated upgrade D1 пока не заявлен.

Исправлен только тестовый snapshot: явный список всех проектных таблиц берётся
из локальной schema фикстуры24, schema comparison ограничен ими и current view.
Provider-private таблицы не читаются, разрешения не обходятся. Равенство всех
проектных строк/rowid, schema rollback, immutable guards, FK/quick_check и новая
HTTP/SQL матрица сохранены. После исправления2 локальных tests PASS; запускается
новый полный CI. Runtime/migration/требования проверок не ослаблены.

Публикация Android source56d2cc129b12ca52e4982933f4a37a025e654f2d/tree26e7c3c4217662224425c86a274e149d95c17f18
в draft PR21 успешна, CI44358868461 выполняется. Сначала большой локальный
payload и затем целый plan превысили лимит вывода; обе попытки остановились до
записи Android tree/ref. Повторная публикация читала файлы отдельно, большие
журнал/план — parent+проверенный append; tree parity подтверждена. Обрезанные
данные не публиковались. Никаких remote migration/merge/deploy/активации нет.


## Liftback: backend CI после исправления snapshot PASS — 2026-11-18

Source `b51176226a6f85eb01abb7dc56abec8450e1f713`, tree `f79751cdc2cd4e5903e20e589dbb28a6860199b5`, local `ea77c9a90ec3ddeef79238698cbb666a94c11d97`:
CI44359299631/job134995931727 SUCCESS, все32 steps.80 npm,25 migrations,
12 preflight,14 inventory,6 reference,16 native D1 workflows,6 protected actual
Wrangler CLI cases,audit0,Worker dry-run PASS. Raw decoded log/head проверены.
Native engine подтвердил actual OWNER/MFA/Dispatcher boundaries, comfort
standard/explicit exception, отказ business/minivan-null/direct SQL, старый
pin/implicit fallback, BEV/year/strict enum, отсутствие automatic approval/hold
release. Populated24→25 сохраняет все проектные rows/rowid/immutable graph;
failed upgrade rollback,FK/quick_check PASS,realCloudflareRequests0.

Первый failed CI44358568865 сохранён и разобран; исправление только test snapshot
scope, runtime/миграция после первого source не менялись. Backend receipt
COMFORT_LIFTBACK_BACKEND_VERIFICATION_2026-11-18.json привязан к tested source;
Android CI44358868461 и artifact review ещё pending, их PASS не заявлен.
В canonical AGENTS добавлено утверждение владельца; canonical backend
69dff6ed7937c704067b62dae93b08a80425e551, Android
 df06d6fd35f6e724a84f742a6c0ee71502e7b1a8 (оба2 files/append-only,0 deletions).
Нет production/remote migration/активации/seed/backfill/real sensitive data.


## Liftback: Android attempt1 FAILURE, системный launcher ANR — 2026-11-18

CI44358868461/job134994375409 source56d2cc129b12ca52e4982933f4a37a025e654f2d
завершился FAILURE. Build/JVM/lint/API endpoint locks/signing isolation прошли;
48 native UI cases не прошли (3 Driver availability,45 Admin). Safe diagnostic
artifact14455626085 содержит `hostFocused=false lifecycle=RESUMED`,
`mCurrentFocus=Application Not Responding: com.google.android.apps.nexuslauncher`,
keyguard=false, screen awake. Для Driver причина потери focus подтверждена;
Admin stack traces показывают последующие launch/focus waits. Артефакт
не содержит APK/успешного набора screenshots; PASS instrumentation не заявлен.

Запущен attempt2 того же source в новом runner/emulator. Runtime/test assertions,
таймауты, privacy gates и набор обязательных тестов не ослаблены; системное ANR
окно не обходилось принудительным закрытием. Первый failure сохранён, повторный
PASS сам по себе не будет означать исправление emulator launcher. Итоговый
APK/evidence review ожидается только после полностью успешного CI.


## Liftback: второй Android FAILURE и readiness gate эмулятора — 2026-11-18

Тот же source56d2cc129b12ca52e4982933f4a37a025e654f2d/CI44358868461 attempt2,
job135012835848 FAILURE: снова3 Driver/45 Admin native failures. Новый artifact
14456922082 повторно показывает RESUMED/awake/keyguard=false, но focus у ANR
`com.google.android.apps.nexuslauncher`. Повтор не устранил внешнюю причину.
APK/native evidence PASS не заявлены; исходные assertions/timeouts сохранены.

Добавлен отдельный readiness gate перед suites: дождаться boot_completed,
обычно запустить HOME через am start -W, потребовать3 последовательных focus
наблюдения штатного launcher. ANR/неизвестный HOME/ошибка adb/таймаут — FAIL;
нет force-stop/kill/кликов по ANR/изменения image/API/security settings. Это
проверяемая гипотеза о незавершённом старте launcher и диагностическая защита,
не доказанное исправление root cause. После native failure записываются только
focus/process и категория причины ANR, без полного dumpsys/provider/SQL вывода.
8 unit cases нового gate и6 runner flow checks (5 прежних+новый) PASS, security8/5,
bash/diff PASS. Неготовая среда останавливает обе suites и удаляет stale markers.
Запускается новый полный source CI; разрешение liftback/backend runtime не
менялись. Если gate остановит CI, результат останется BLOCKED, не PASS.


## Liftback: новый source CI с emulator readiness gate — 2026-11-18

Android source5eb857497d84ff17d1a1034ed48f69ca6d349564/local
b372aa3e654fa98504b5701c5fd1bf25af23032b/tree6df234f6232f99b3716d2ce329667304819cd94a,
CI44368213906 выполняется. Draft PR21 обновлён с tree parity/branch lease;
проверенная backend реализация b51176226a6f85eb01abb7dc56abec8450e1f713 неизменна.

Docs-only publication helper сначала штатно отказал публиковать tools/workflow
изменения; ref/tree тогда не записывались. Для нового source использован явный
список7 изменённых файлов с теми же tree parity/lease и append-only journal.
Краткий exec-server transport disconnected устранён повторным подключением;
Cloud Environment status подтвердил ту же running/connected машину, local
commit/чистое рабочее дерево проверены до публикации. Секреты не запрашивались.

Сравнение с двумя прежними успешными OWNER-editor CI: emulator37.2.13.0,
Google APIs35 x86_64/Pixel6 и2560MB совпадают. Доказательств смены image/emulator
или исправления launcher пока нет; готовность HOME проверяется отдельно,
платформа и обязательные native cases сохранены.


## Liftback: CI44368213906 остановлен ошибкой нового gate — 2026-11-18

Source5eb857497d84ff17d1a1034ed48f69ca6d349564/job135027592164 FAILURE:
build/JVM/lint3 variants,security8/5,runner6/readiness8 PASS, но новый HOME
readiness gate выдал FAIL через60 секунд до запуска обеих native suites.
Artifact14457882609 содержал только пустую строку. Этот прогон НЕ подтверждает
новое ANR/неисправность среды: найдена ошибка самой добавленной проверки.

В Android15 WMS команда `dumpsys window windows` вызывает dumpWindowsLocked,
тогда как mCurrentFocus/mFocusedApp печатает DisplayContent; нужная команда —
`dumpsys window displays`. Проверено по AOSP android15-release:
https://github.com/aosp-mirror/platform_frameworks_base/blob/android15-release/services/core/java/com/android/server/wm/WindowManagerService.java
https://github.com/aosp-mirror/platform_frameworks_base/blob/android15-release/services/core/java/com/android/server/wm/DisplayContent.java
Исправлена команда gate/diagnostic; фикстура теперь принимает только точную
команду displays, а не любой dumpsys. Добавлены2 meaningful cases на diagnostic
focus/редактирование ANR reason и явное отсутствие полей:10 tests PASS; runner6
PASS. Ранее2 запуска44358868461 с реальными launcher ANR/48 native failures
сохраняются. Не объявляется успешный APK/native evidence или исправленный ANR.
Бизнес-правила/runtime apps не менялись, assertions/timeouts сохранены.


## Liftback: публикация исправления gate прервана — 2026-11-19

Исправленный local source0b5cd04279b386c54094627f6c945152b7593649 готов:
Android15 display dump вместо windows,10 readiness tests/6 runner tests PASS.
Публикация через GitHub create_tree была прервана, runtime заменён; последующая
проверка ожидаемого tree4375da69b4c5f4d7dc313a2a9760731013f453ae дала404.
Попытка загрузить отдельный code blob тоже прервана. Branch update/новый CI
исправленного source не подтверждены. Последний подтверждённый remote head:
5eb857497d84ff17d1a1034ed48f69ca6d349564.

Текущий итог: backend b51176226a6f85eb01abb7dc56abec8450e1f713/CI44359299631
SUCCESS. Android44358868461 attempt1/2 FAILURE с подтверждённым launcher ANR;
44368213906 FAILURE до suites из-за ошибки нового gate, исправленной локально.
Native145/PNG56/APK для новой версии НЕ объявлены PASS. Для завершения нужны
успешная публикация подготовленного исправления, полный CI и проверка artifacts.
Прерванные GitHub write операции не повторялись после последней отмены; состояние
ветки повторно прочитано. Нет merge/deploy/remote migration/активации. G1paused.


## Liftback: возобновление публикации исправления — 2026-11-19

По указанию владельца «Продолжаем» среда восстановлена. Remote head повторно
проверен:5eb857497d84ff17d1a1034ed48f69ca6d349564; прежние ожидаемые tree/code blob
отсутствовали. Повторены10 readiness/6 runner tests:PASS; diff whitespace PASS.
Повторная загрузка code blobs теперь отвечает: gate1b56e966438a19635065602619bc7f1bbffa1b80,
fixture3549d8fe457ab5211b7735a6c3361ef27d2257ce. Исправлен разбор ответа
вспомогательной публикации: create_blob возвращает structuredContent.sha напрямую,
а fetch blob — декодированный текст, не JSON. Ошибки разбора ответа не меняли
branch ref; созданные объекты проверены до продолжения. Рабочий runtime приложений
и бизнес-правила не менялись. Готовится атомарный commit с tree parity/branch lease,
затем полный Android CI; native/APK PASS до его окончания не заявляется.


## Liftback: CI44473172878 gate FAIL и короткий emulator probe — 2026-11-19

Source81fab1ffd22aa02e621aca60ed713173d7d2b4af/job135387301056 FAILURE до native
suites:build/JVM/lint3 variants/security8/5/runner6/readiness10 PASS. Новый
artifact14504843534 содержит фокус штатного NexusLauncher; ANR не зафиксирован.
Точной причины несовпадения readiness пока нет: ожидаемый HOME и sample counters
не записывались. Этот отказ не объявляется ошибкой runtime приложений/новым ANR.

Добавлены безопасные stage/boot flag/expected system HOME package/focus counters
в failure diagnostic и2 unit cases (итого12) для этих состояний. Секретные поля,
raw command/provider/SQL output не выводятся. Добавлен отдельный короткий probe
workflow на изменения gate:тот же API35/Google APIs/x86_64/Pixel6/animations off,
без application builds. Это диагностика инфраструктуры, не замена обязательного
полного Android CI/native/PNG/APK. Main workflow/gates/assertions/timeouts прежние.
12 readiness/6 runner tests,YAML parse/diff PASS. В среде локально нет KVM/emulator;
установка альтернативной платформы/обход focus/ANR не выполнялись. Полный результат
остается BLOCKED до исправления причины и проверки артефактов нового source.


## Liftback: причина readiness FAIL подтверждена probe — 2026-11-19

Source98305cc7b02bdf9c5aaf9ed942af46952749ed8d, probe CI44475128578/job135393701100
FAILURE,artifact14506386048:bootCompleted=True,homeStartOk=True,expected HOME
com.android.settings,56 samples/1 matched/stable0; фактический focus NexusLauncher.
Подтверждено зависание логики проверки на первом временном HOME, а не ошибка
приложений. AOSP Android15 Settings FallbackHome регистрирует HOME с priority-1000
и завершает себя после появления реального HOME:
https://github.com/aosp-mirror/platform_packages_apps_settings/blob/android15-release/src/com/android/settings/FallbackHome.java
https://github.com/aosp-mirror/platform_packages_apps_settings/blob/android15-release/AndroidManifest.xml

Исправлено:обычный HOME start сохраняется; цель HOME разрешается заново при каждом
наблюдении, смена package сбрасывает стабильность. Focused Settings.FallbackHome
не принимается за готовую среду. Нужны3 последовательных совпадения реального HOME;
ANR всё ещё немедленный FAIL, deadline60/adb15/native assertions не изменены.
Добавлены3 regression cases:bootstrap→real HOME,persistent focused fallback,
сброс трёх наблюдений при смене HOME.15 readiness/6 runner tests PASS,diff PASS.
Main CI44475128391 того же диагностического source не является готовой сборкой;
его итог/cancellation будет сохранён отдельно. Новый source должен пройти короткий
probe и весь main CI; первоначальные2 реальных ANR root cause пока не закрыты.


## Liftback: bootstrap fix source и superseded CI — 2026-11-19

Опубликован source110b864897e69d31dfed07eeaa63cd08f7e15d71/local
6582d574e110127ce0e99b4cc54dd62cb5d33f4f/tree245b80bb6d841423341bedacedfb34b89f6970aa
(точный local SHA сверяется state file). Новый main CI44475834159 и probe44475834201
выполняются. Main CI44475128391 диагностического source98305cc7 завершён cancelled
автоматической concurrency после публикации исправления; complete native/APK
PASS по нему не заявлен. Все неуспешные/отменённые попытки сохраняются в receipt.


## Liftback: настоящий pre-suite launcher ANR и pin host Ubuntu24 — 2026-11-19

Main CI44475834159/job135396046450 source110b8648 FAILURE до native suites;
artifact14505419809:stage=anr,bootCompleted/homeStartOk=True,expected NexusLauncher,
1 matched/stable sample; focus у Application Not Responding:NexusLauncher,
ANR_REASON=input_dispatch_timeout. Bootstrap race уже исправлен; это реальный
системный ANR,а не прежняя ошибка displays/FallbackHome. Probe44475834201 того же
source SUCCESS (15 unit cases,HOME ready) не заменяет провал полного CI.

Сопоставлены raw runner headers:latest main Ubuntu26 image20261116.202.1,
probe/прежний green Ubuntu26 image20261111.196.1. Первый liftback ANR также был
на196.1,поэтому смена image НЕ объявляется доказанной единственной причиной.
Для воспроизводимой базовой среды оба Android workflows закреплены на
поддерживаемом GitHub host ubuntu-24.04:
https://github.com/actions/runner-images/blob/main/README.md
Это контролируемая стабилизация CI,не доказанное устранение launcher root cause.
Android35/Google APIs/x86_64/Pixel6/renderer/RAM и app code/таймауты/assertions
сохранены; ANR всё ещё блокирует тесты. YAML parse/diff PASS; новый source должен
пройти отдельный probe и полный main CI. Backend/runtime source не менялись.


## Liftback: host24 probe PASS и сохранение технической истории — 2026-11-19

Source1ad5e6f5cceaedae55ca019b85e112f9b99d3d79:probe44477348025/job135400991290
SUCCESS наubuntu-24.04,15 readiness cases,actual HOME ready,transitions0/bootstrap
observedFalse. Main44477347924/job135400991011 выполняется; probe не заменяет
native/PNG/APK acceptance. Backend10 non-doc source hashes сверены без изменений.

Для точности истории публикации:временный bundle helper ранее отказал на duplicate
previousSha keyword после расширения state; объект результата заменён на update
с явным overwrite. После замены exec runtime пропадал сохранённый V8 publisher
helper; публикация остановилась до ref write, helper восстановлен из файлов.
Отдельные ошибки JSON parsing ответа GitHub create_blob/fetch исправлены с
проверкой созданных объектов. Это сбои tooling публикации,не скрытые тестовые
PASS/production mutations. GitHub blobs/tree сверялись с локальными Git hashes;
canonical/ref записи применяются только с ожидаемым parent SHA/force=false.


## Liftback: состояние после прерванного ожидания CI — 2026-11-19 07:21 UTC

Инструмент ожидания прерван; сам GitHub main CI44477347924/job135400991011
(source1ad5e6f5cceaedae55ca019b85e112f9b99d3d79) не отменён. Повторное чтение:
status=in_progress,Run Android security instrumentation tests; artifacts ещё нет.
Build/JVM/lint3 variants выполнены,probe44477348025 SUCCESS наUbuntu24.04.
Полный native145/PNG56/APK acceptance пока НЕ подтверждены; итоговый verified
receipt не создавался и canonical checkpoint не закрывался. Далее получить
завершённый CI,при PASS проверить bytes/source/digests/signature и raw frames,
затем опубликовать итоговые docs/журналы с сохранением всей failed/cancelled истории.
Нет merge/deploy/remote migration/activation; G1paused,D4–D7pending.


## Liftback: main CI PASS и offline artifact validation — 2026-11-19

Main44477347924/job135400991011 source1ad5e6f5cceaedae55ca019b85e112f9b99d3d79
SUCCESS:432 JVM/145 native,оба приложения build/lint3 variants,security8/5,
runner6/readiness15/actual HOME ready,variant endpoint/signing isolation/AppCheck
PASS. Прежние failures/cancellation сохранены. Artifact14508325451 (56 PNG) и
14507872500 (Admin APK) скачаны,archive digests/size/source и все56 PNG CRC/
dimensions/hash совпали с actual CI log. Driver APK artifact14508525046 только
metadata,не скачивался и не объявляется offline проверенным.

Первый offline verifier остановился на `aapt dump badging`:не разрешён внешний
системный android:icon reference0x01080042. Сам APK не изменён; чтение binary
AndroidManifest через штатный `aapt dump xmltree` успешно. Проверены package
ru.transferservis.admin,debuggable=true,allowBackup=false,usesCleartextTraffic=false.
`apksigner verify --print-certs` PASS,один certificate SHA256. Manifest/icon/подпись
не обходились изменением сборки. История метода сохранена в artifact receipt.
Визуальный осмотр восьми changed raw frames ещё предстоит; полный checkpoint
не закрывается до него. Нет release/phone acceptance/merge/deploy/activation.


## Liftback: visual finding после green CI — 2026-11-19

Непосредственно осмотрены8 raw frames source1ad5e6f5. Assessment form/confirmation
и rule confirmation показывают реальный Лифтбек,класс серверный; layout/action
кнопки читаемы вlight/dark-large. Найдено устаревшее пояснение rules_body_policy:
перечисляло только sedan/crossover дляcomfort при корректном новом checkbox.
Это visual finding,поэтому green CI/56 hashes не объявляются итоговой приёмкой.

Исправлена одна строка Android XML:«Комфорт:седан,кроссовер или лифтбек».
Бизнес/L7/L9/BEV и runtime restrictions не менялись. XML parse/diff PASS;
новый APK должен быть собран и проверен своим полным CI/артефактами. Новые тесты,
дублирующие текст строки,не добавлялись. Предыдущие successful CI44477347924,
validated archives/manifest/signature и8 inspected frames сохранены как
intermediate source с finding,не как итоговый APK. Probe44477348025 относится
к неизменным gate/workflows;их4 source hashes зафиксированы для проверки reuse,
а app acceptance нового source будет только из его полного main CI.


## Liftback: guidance fix опубликован — 2026-11-19

Source d09d5f1e2d581a6c9c866c6c389f27d53a726c75/local
93691652d92594a756222aa0eb107256a399d770/treee7c7a1b94990d4d932e866dc637e4f1d764080e2
(точный local source хранится в publication state):ровно1 XML string и append-only
journal,tree parity/branch lease PASS. Первый GitHub create_commit вернул ошибку
без сохранённого детального ответа; ref оставался1ad5e6f5,prepared tree проверен,
повторное создание успешно и выбранный commit проверен до единственного ref update.
Успех/точная причина первой ошибки не выдумываются. Новая APK-проверка ожидает CI.


## G2 liftback: проверенная реализация и Android APK — 2026-11-19

Утверждённое «Только в комфорте» реализовано: отдельный liftback только comfort,
запрет business/minivan/OWNER exception/nullable bypass. Для liftback нужна явная
rule definition. Старые versions/pins/implicit sedan-crossover не расширяются;
candidate не approved/online/освобождение assignment hold, class определяет сервер.

Backend draft PR45 sourceb51176226a6f85eb01abb7dc56abec8450e1f713, CI44359299631 SUCCESS:
80 npm,25 migrations,16 native D1 workflows,6 protected actual Wrangler cases,
audit0,dry-run PASS. Populated24→25 сохраняет graph/rows/rowids/pins; failed
upgrade rollback,immutable guards,FK/quick_check PASS. Первый backend failure
с provider-private snapshot сохранён; исправлен только scope проектных таблиц.

Android draft PR21 sourced09d5f1e2d581a6c9c866c6c389f27d53a726c75, treee7c7a1b94990d4d932e866dc637e4f1d764080e2,
local93691652d92594a756222aa0eb107256a399d770: CI44488353051 attempt1,
job135437379379 SUCCESS.432 JVM/145 native без failure/error/skip;
обе apps build/lint3 variants,security8/5,runner6,readiness15,endpoint/signing
isolation/AppCheck policy PASS. HOME readiness реально PASS; действующие focus,
gesture/privacy/MFA/CAS/original retry assertions и таймауты не ослаблены.

Промежуточный green source1ad5e6f5 осмотром выявил пропуск liftback в подсказке;
исправлена1 XML строка,новый source прошёл свой main CI. Ранее успешный probe
использован только для4 неизменных gate/workflow hashes; acceptance app source
подтверждён своим CI/APK,не перенесён с прежней версии.

56 PNG сверены по source/archive digest/CRC/dimensions/hash;8 raw changed frames
(assessment/rule-editor form+confirm в light/dark-large) осмотрены непосредственно.
Остальные48 кадров заново визуально не принимались. Admin APK package/signature/
certificate/hash проверены offline. Это synthetic debug/ephemeral CI key,
без live phone/release/гарантии обновления установленного приложения.
Exact source/artifacts/границы: COMFORT_LIFTBACK_VERIFICATION_2026-11-19.json.

Прежние44358868461 attempts1/2 FAILURE48 native cases с launcher ANR сохранены;
44368213906 — отдельная ошибка нового gate (windows вместо displays), исправлена.
Readiness дополнительно исправлен по доказанному Settings.FallbackHome→NexusLauncher
переходу:HOME переопределяется,стабильность сбрасывается,bootstrap не принимается.
Короткий probe подтверждён отдельно; superseded CI44475128391 cancelled сохранён.
Прерванные публикации/замены runtime и ошибки helper response parsing не скрыты;
объекты проверялись перед повтором, tree parity/lease подтверждены. Последний
PASS не доказывает исправление root cause системного launcher.

CSV121/архив116/годы/условия сохранены; новых Dispatcher прав/phone scope нет.
Full powertrain ranges121/actual legacy inventory/live acceptance открыты.
Нет seed/backfill/remote migration/activation/merge/deploy. G1paused,D4–D7pending.


## Проверка итоговых документов перед публикацией — 2026-11-19

Оба final receipts побайтно совпадают,432 JVM/145 native/56 PNG/8 direct visual
frames и новая подпись Admin APK привязаны к d09d5f1e/CI44488353051. При review
документов обнаружена ошибка временного генератора:он создал отсутствовавший в
backend отдельный короткий PROJECT_PLAN_V1_0.md. До commit файл сверён побайтно
с только что созданным checkpoint и удалён. Единый утверждённый план остаётся
в TransferDriver;backend обновляет свой журнал/ссылки,не создаёт параллельный план.
Runtime/CSV/история не менялись; дальнейшая публикация docs-only [skip ci].
