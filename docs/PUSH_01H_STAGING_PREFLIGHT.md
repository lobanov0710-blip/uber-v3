# PUSH-01H — проверка готовности STAGING без изменения удалённой D1

**Дата:** 03.11.2026. **Статус:** тестовый Draft PR поверх [PUSH-01G PR №19](https://github.com/lobanov0710-blip/uber-v3/pull/19).  
**Объекты реального STAGING: не тронуты.** Нет удалённых запросов Wrangler/D1, deploy, секретов, создания заказов, включения PHP-флагов или FCM.

## 1. Факты аудита

- Текущий `wrangler.toml` в рабочем GitHub-дереве указывает на **production**: `name=uber-v3`, D1 `transfer-servis52-core`.
- **`wrangler.staging.toml` отсутствует в GitHub-ветке PR №19.** Ранее существовавшая локальная конфигурация STAGING не может считаться проверенной по текущему содержимому GitHub. Не создавать вместо неё копию production конфига, не предполагать, что подключение STAGING сейчас доступно.
- Миграции `0005–0008` находятся в зависимых Draft PR №13–19. Их применение **ни к STAGING D1, ни к production D1** не подтверждено и в этом PR не предпринимается.
- Staff FCM в `src/core/staffPushNotificationService.js` отключается при точном `APP_ENV=staging`. Поэтому несоответствие этого параметра является критическим и блокируется.
- Будущий PHР gateway будет связан с Worker только после отдельного разрешения и утверждённого временного маршрута. Существующий PHP-контур production в этом этапе не меняется.

## 2. Реализованный безопасный read-only preflight

`scripts/push01h_staging_preflight.py` использует только Python `tomllib` для **чтения файлов**, без subprocess Wrangler, Cloudflare API и переменных секретов. Он проверяет:

1. Файл именно STAGING-конфигурации существует и синтаксически корректен.
2. `name=uber-v3-staging`, `main` совпадает с рабочим Worker entrypoint, `[vars].APP_ENV=staging`.
3. Отдельный D1 binding `DB`, точное имя `transfer-servis52-staging`, уникальный UUID равен **независимо подтверждённому** параметру `--expected-staging-db-id` и отличается от production ID.
4. `DRIVERS` KV изолирован от production; никаких дополнительных production D1/KV bindings нет.
5. Пассажирские push-флаги остаются выключенными. Запрещено сохранять HMAC, Firebase, service-account ключи и другие похожие значения в `[vars]` конфигурации.
6. Имеются миграции 0001–0008, без пробелов в цепочке.

Пример **после самостоятельного подтверждения STAGING DB ID**, только на контролируемой копии репозитория:

```bash
python3 scripts/push01h_staging_preflight.py \
  --staging-config wrangler.staging.toml \
  --production-config wrangler.toml \
  --expected-staging-db-id "UUID_НЕЗАВИСИМО_ПОДТВЕРЖДЁННОЙ_ТЕСТОВОЙ_D1"
```

Это не deploy и не тест удалённой D1. Для реального конфига сейчас ожидается **BLOCKED**, поскольку файл отсутствует в GitHub. Нельзя просто подставить production `wrangler.toml`.

`tests/push01hStagingPreflight.test.py` проверяет отрицательные сценарии: production D1/KV, не тот UUID, неправильные worker/APP_ENV, включённые флаги, секреты в конфиге, отсутствие пути/миграции.

## 3. Реальный local workerd + local D1 без Cloudflare

`scripts/push01h_local_workerd.sh` создаёт только **временный тестовый** TOML:

- Worker `ts52-push01h-local-only`; DB `ts52-push01h-test-only` с фиктивным ID, никогда не с ID staging/prod.
- `APP_ENV=staging`, локальные push-флаги включены только в тестовом объекте Worker, все четыре ключа — **публичные фиктивные строки CI**, не реальные секреты.
- Все команды Wrangler имеют обязательные `--config=<temporary>`, `--local` и уникальное `--persist-to=<temporary>`; Cloudflare credentials перед запуском удаляются из окружения.
- Миграции 0001–0008 применяются **только локально**, создаётся единственный тестовый заказ в локальной D1; `wrangler dev --local` запускает Cloudflare `workerd` на 127.0.0.1.
- `tests/push01hWorkerdD1.smoke.mjs` выполняет POST grant, replay одного HMAC nonce (403), регистрацию (200), запрет повторного grant (409), отзыв (200), запрет повторной регистрации (409) и чужой accessToken (403).
- После работы временный TOML, локальная D1 и тестовые файлы удаляются. Скрипт **не использует** `wrangler dev --remote`, `wrangler deploy` или `wrangler d1 ... --remote`.
- Это принципиально иная проверка, чем Node SQLite из PR №19: код выполняется в настоящем **локальном workerd** с интерфейсом local D1 binding. Но это **не** настоящая удалённая D1.

GitHub Actions `.github/workflows/passenger-push-staging-preflight.yml` сначала выполняет unit-тесты статической проверки, затем `npm ci` и local workerd smoke. **Успех подтверждать только по завершённым CI**, не по наличию исходных файлов.

Документация Cloudflare: [Local Workers](https://developers.cloudflare.com/workers/local-development/) и [D1 local](https://developers.cloudflare.com/d1/best-practices/local-development/). Explicit `--local` не обращается к удалённым D1.

## 4. Действия, которые остаются только проектом

До *сетевой* проверки реальной STAGING D1 требуется отдельное разрешение владельца на конкретные операции. При таком разрешении:

- Проверить актуальный Cloudflare account, Worker `uber-v3-staging`, D1 `transfer-servis52-staging`, KV `DRIVERS`, соответствующие им UUID **из независимого источника**, не из production TOML. Сверить результат preflight. Отдельно установить, что STAGING не подключает реальные FCM/Telegram уведомления и не использует production secrets.
- Только после сверки допускается отдельный **read-only** `wrangler d1 migrations list DB --config wrangler.staging.toml --remote`. Этот PR команду не выполняет.
- До `wrangler d1 migrations apply ... --remote` отдельно согласовать миграции 0005–0008, резервную копию/point-in-time recovery, тестовый заказ, тестовую capability, границы доступа и план отката. Wrangler CI часто пропускает подтверждение миграции — **никогда не запускать remote apply автоматически по PR**.
- Проверить временны́е PHP flags и HMAC **только в staging**. Не менять конфигурацию production-сайта, даже ради испытания.
- Для WAF пока существует только проект `config/passenger-push-waf-proposal.json` из PR №19, **не развёрнутое** правило. Его нужно согласовать отдельно (NAT, IP burst, тариф Cloudflare).

## 5. Gate на следующий этап

**Можно считать завершённым сейчас:** статические тесты isolation/identity, локальный workerd+D1 smoke, рецензирование миграций и выполнение GitHub Actions (если CI green).

**Нельзя считать выполненным:** сетевой STAGING E2E, миграции реальной тестовой D1, подключение реальных Firebase устройств, проверка WAF, реальный FCM, production deploy.

**Развёртывание, слияние любых PR, подпись APK, отправка сообщений — только после отдельного явного разрешения владельца.**
