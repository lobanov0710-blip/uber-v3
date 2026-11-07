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
- live Driver v1 probe на текущем staging deployment возвращает 404 даже для
  `GET /v1/driver/me`, то есть Worker deployment отстаёт от D3 backend code;
- remote D1 migration list показывает к применению `0005`–`0017`;
- статический аудит этих 13 pending migrations: 0 destructive statements,
  28 `ALTER TABLE ... ADD COLUMN`, 0 unsafe ALTER.

Следовательно, текущий STAGING ещё **не готов** к photo-control/support E2E.

## Fail-closed configuration gate

`tools/d3_staging_preflight.py` проверяет локальную staging Wrangler-конфигурацию
до любого deploy:

- exact Worker name `uber-v3-staging`;
- `workers_dev=true`, custom routes запрещены;
- `APP_ENV=staging`;
- exact staging D1/KV identities выше;
- production D1/KV использовать нельзя;
- обязательный private R2 binding `DRIVER_PRIVATE_FILES`;
- bucket должен быть явно staging-scoped;
- `DRIVER_UPLOAD_MAX_BYTES` обязателен и должен находиться в безопасном диапазоне
  1–20 MiB;
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
3. Сформировать реальный `wrangler.staging.toml` из подтверждённых bindings и
   прогнать fail-closed preflight.
4. Перед remote apply отдельно подтвердить применение migrations `0005–0017`
   к staging D1.
5. После migrations выполнить deployment **только** `uber-v3-staging`.
6. Повторить unauthenticated route probe:
   - `/v1/driver/me` → 401;
   - `/v1/driver/photo-checks` → 401;
   - `/v1/driver/support-cases` → 401;
   - GET `/v1/driver/uploads` → 405.
7. Только после этого запускать authenticated Driver E2E:
   photo-check → private R2 upload → backend state refresh → support case →
   support message/history.

Production Worker/D1/KV/R2 в этот gate не изменяются.
