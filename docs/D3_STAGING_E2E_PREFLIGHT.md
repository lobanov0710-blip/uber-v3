# D3 STAGING E2E preflight

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
