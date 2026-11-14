# D3 STAGING E2E preflight

> **Индекс 2026-11-14:** SDK config и identifiers получены; подпись/App Check/Play/private R2/E2E
> ещё не подтверждены. Старые наблюдения ниже относятся к их датам, не к новому live probe.
> [Полный аудит](https://github.com/lobanov0710-blip/TransferDriver/blob/arch/spec-v1-security-baseline/docs/AUDIT_SPEC_PLAN_JOURNAL_2026-11-14.md) · [актуальный план](https://github.com/lobanov0710-blip/TransferDriver/blob/arch/spec-v1-security-baseline/docs/PROJECT_PLAN_V1_0.md).

Статус: подготовка к D3 Driver E2E. Этот документ и preflight **не выполняют**
Cloudflare deploy, D1 migration apply, создание R2 bucket или иные remote writes.

## Подтверждённое состояние на 2026-11-07

Read-only Cloudflare audit подтвердил:

- Worker: `uber-v3-staging`;
- D1: `transfer-servis52-staging`;
- D1 ID: `66474481-a123-47f9-81b4-12af7565ec8d`;
- KV `DRIVERS`: `b8fdeb74fda8415ab06b3b1c86c78e8f`;
- active Worker bindings сейчас содержат только `APP_ENV`, `DB`, `DRIVERS`;
- binding `DRIVER_PRIVATE_FILES` сейчас отсутствует;
- попытка создать `transfer-servis52-driver-private-staging` через current
  Cloudflare API token заблокирована `Authentication error [code: 10000]`;
  token не имеет требуемого R2 permission;
- Firebase D2 identifiers `FIREBASE_PROJECT_ID`, `FIREBASE_PROJECT_NUMBER`,
  `FIREBASE_DRIVER_APP_ID` в staging Worker отсутствуют;
- в активном production Worker эти D2 identifiers также отсутствуют, поэтому
  их нельзя безопасно копировать из production deployment;
- live Driver v1 probe на текущем staging deployment возвращает 404 даже для
  `GET /v1/driver/me`, то есть Worker deployment отстаёт от D3 backend code;
- migrations `0005`–`0017` **применены к STAGING D1** после явного
  подтверждения владельца;
- post-apply remote pending migrations: `0`;
- orders: `6 -> 6`, quotes: `14 -> 14`;
- обязательные D3 tables: `13/13`;
- `STAGING_D1_MIGRATION_VERIFICATION=PASS`;
- повторный migration workflow при pending=0 был fail-closed заблокирован и
  повторный apply не выполнял.

Следовательно, текущий STAGING ещё **не готов** к photo-control/support E2E.

## Fail-closed configuration gate

`tools/d3_staging_preflight.py` проверяет локальную staging Wrangler-конфигурацию
до любого deploy:

- exact Worker name `uber-v3-staging`;
- `workers_dev=true`, custom `route` и `routes` запрещены;
- nested `[env.*]` overrides запрещены: проверяется один явно выбранный STAGING target;
- `APP_ENV=staging`;
- exact staging D1/KV identities выше;
- production D1/KV использовать нельзя;
- обязательный private R2 binding `DRIVER_PRIVATE_FILES`;
- bucket должен быть именно согласованным
  `transfer-servis52-driver-private-staging`;
- дополнительные D1/KV/R2 bindings не допускаются этим gate;
- `DRIVER_UPLOAD_MAX_BYTES` обязателен и должен находиться в безопасном диапазоне
  1–20 MiB;
- обязательны публичные Firebase identifiers:
  `FIREBASE_PROJECT_ID`, `FIREBASE_PROJECT_NUMBER`,
  `FIREBASE_DRIVER_APP_ID`; они должны быть подтверждены из реальной
  Firebase Android-конфигурации, а не придуманы;
- Android app ID должен иметь корректный формат и содержать тот же project number;
- hourly D3 cron `0 * * * *` обязателен;
- credentials/secrets в `[vars]` запрещены;
- migration chain `0001`–`0017` должна быть полной;
- pending D3 migrations `0005`–`0017` блокируются при `DROP/DELETE/UPDATE/
  INSERT/REPLACE/TRUNCATE` или ALTER, отличном от `ADD COLUMN`.

Пример проверки будущего локального staging config:

```bash
python3 tools/d3_staging_preflight.py \
  --staging-config wrangler.staging.toml
```

Успешный preflight означает только, что config прошёл локальные guards. Он не
разрешает автоматически применять remote migrations или deploy.

## Что требуется перед реальным E2E

1. Создать или независимо подтвердить отдельный **private staging R2 bucket** и
   привязать его как `DRIVER_PRIVATE_FILES`.
2. Установить разумный `DRIVER_UPLOAD_MAX_BYTES` в staging config.
3. Подтвердить Firebase project ID/number и Android app ID из реальной
   Firebase-конфигурации Driver app; настроить App Check Play Integrity для
   тестового канала распространения.
4. Сформировать реальный `wrangler.staging.toml` из подтверждённых bindings и
   прогнать fail-closed preflight.
5. Выполнить deployment **только** `uber-v3-staging` после прохождения
   полного preflight.
6. Повторить unauthenticated route probe:
   - `/v1/driver/me` → 401;
   - `/v1/driver/photo-checks` → 401;
   - `/v1/driver/support-cases` → 401;
   - GET `/v1/driver/uploads` → 405.
7. Только после этого запускать authenticated Driver E2E:
   photo-check → private R2 upload → backend state refresh → support case →
   support message/history.

Production Worker/D1/KV/R2 в этот gate не изменяются.

## Checkpoint 2026-11-11

Владелец подтвердил: R2 permissions ещё не добавлены, bucket не создан.
Firebase public identifiers пока неизвестны; владельцу даны шаги их получения
и задан выбор существующего/нового проекта. Значения не подставлялись из CI fixtures.

Unauthenticated route probe 2026-11-11:
`/v1/driver/me`, `/v1/driver/photo-checks`, `/v1/driver/support-cases`,
`GET /v1/driver/uploads` — все HTTP 404. Рабочий D3 deployment ещё не подтверждён.

Локальный preflight усилен против одиночного route, environment overrides,
дополнительных bindings, неподтверждённого bucket и несовместимых Firebase IDs.
12 regression tests и 17 migrations smoke проходят.

Создание R2 bucket, повторный migration apply и deploy не выполнялись.
Локальный PASS не заменяет реальные R2 privacy/permission checks, Firebase
Phone/App Check и authenticated photo/support E2E.


## Checkpoint 2026-11-12 — Firebase identifiers получены от владельца

FIREBASE_PROJECT_ID=transfer-driver-1590d;
FIREBASE_PROJECT_NUMBER=502279442547;
FIREBASE_DRIVER_APP_ID=1:502279442547:android:0cfc722af33b476bc41a06;
package=ru.transferservis.driver. Project name/App nickname: Transfer Driver.
Формат и согласованность номера проекта/App ID/package проверены локально.
Независимая сверка с Firebase API ещё не выполнена; настоящий google-services.json
ещё отсутствует. Официальная CLI 15.36.0 проверена; login:list — No authorized accounts.
Владелец выбрал получение SDK config через CLI на своём компьютере;
точные команды приведены в D3_STAGING_OWNER_SETUP.md.
R2 permission/bucket блокер сохраняется. Эти identifiers не означают готовность
Phone Auth/App Check, SDK-сборки или authenticated E2E. CI fixtures не заменялись.


## Checkpoint 2026-11-12 — SDK config получен, требования к тестовому каналу

Переданный владельцем настоящий google-services.json проверен: project ID/number,
Android app ID/package совпадают с указанными выше. Он хранится только локально
в gitignored Android app/google-services.json; API key в Git/журнал не включается.
Локальная первая сборка с этим config: 29 JVM tests и 7 guards PASS;
debug/release APK, release AAB и AndroidTest APK собраны. Authenticated E2E и
runtime instrumentation с реальным Firebase config пока НЕ выполнялись.

Владелец подтвердил Phone enabled / App Check not configured; выбрал Google Play
и прямую раздачу APK. Play Console/внутренний канал не подтверждены, release/upload
key пока отсутствует. Подготовлена инструкция создания ключа у владельца и
настройки App Check для обоих каналов; см. D3_STAGING_OWNER_SETUP.md.
Для тестового Play канала Android добавляет отдельный non-debug staging buildType:
STAGING backend при той же applicationId, без отключения Play Integrity.
Обычный release использует PRODUCTION и не подменяет STAGING E2E.
R2 permission/private bucket блокер сохраняется; deploy/migration apply и remote
Firebase changes в этом checkpoint не выполнялись.

Android non-debug staging variant и session backend binding проверены:
source 5cd807568b7b84b9e151867eb930cfbadad4c086, CI run 43314469461 SUCCESS:
87 JVM + 12 API 35 runtime + 7 source guards. Локальные staging APK/AAB собраны
с настоящим SDK config; unsigned до owner upload key. Реальный authenticated
Phone/App Check и R2/photo/support E2E остаётся заблокирован владельческими gate.
