# PUSH-01E — автономная интеграционная проверка PHP HMAC → Worker → D1 SQL

**Дата:** 03.11.2026. **Статус:** отдельный тестовый PR, основан на [PUSH-01D PR №16](https://github.com/lobanov0710-blip/uber-v3/pull/16), который зависит от №15 → №14 → №13. Основные ветки и production не затронуты.

## Что действительно проверяется

Workflow `.github/workflows/passenger-push-php-worker-integration.yml`:
1. Получает **реальный файл** `public_html/api/_proxy_auth.php` из публичного репозитория `lobanov0710-blip/public_html` с закреплённого коммита PHP PR №7: `4d68b78e73261f9f3864dd270a9fdf4ab3d91610`. Файл копируется в каталог внутри `os.tmpdir()` с приватным тестовым секретом за пределами тестового webroot.
2. Вызывает **оригинальную PHP-функцию** `buildProxyAuthHeaders(path, rawBody)` через отдельный локальный процесс PHP CLI. Генерируемые этим кодом `X-Proxy-Timestamp` / `X-Proxy-Signature` передаются **оригинальному Worker router** из текущей feature-ветки.
3. В Worker включены *только в тестовом объекте env* `PASSENGER_PUSH_API_ENABLED` и `PASSENGER_PUSH_DEVICES_ENABLED`; используются независимые заранее известные тестовые secret strings.
4. Worker обращается к `env.DB` — адаптеру **реальной SQLite in-memory** через встроенный Node `node:sqlite`. Применяются **настоящие миграции 0001…0007**; `prepare/bind/first/run` выполняют исходный SQL, `batch` делает BEGIN/COMMIT/ROLLBACK.
5. Интеграционно проверяются issuance grant на своём заказе, отправка запроса регистрации по PHP HMAC, привязка установки к одному заказу, запрет повторного `jti`, отзыв и отказ в повторной регистрации, запрет чужого заказа, изменения HMAC body/path, отсутствие подписи, отключённые флаги, терминальный статус, ручное обезличивание FCM token, подлинный rolling-limit 5/60.
6. После завершения весь тестовый SQLite и тестовый private secret удаляются. Тестовый script **не импортирует FCM sender, не выполняет fetch, не использует Wrangler и не обращается к Cloudflare**.

Отдельный шаг workflow повторяет `npm test` и три прежних `python3 ...sqlite.py` suites, чтобы обнаружить регрессии.

## Существенные ограничения (не считать production E2E)

- Тестируется **подлинный PHP HMAC signer**, но **не** HTTP-контроллер `api/passenger-push-grant.php` или `api/passenger-push-device.php` в режиме с включёнными флагами. Их предыдущий GitHub CI проверяет только fail-closed (503 при отсутствии enable). **Реальная цепочка HTTPS PHP → Worker → D1 в staging/production ещё не проверена.**
- Используется Node SQLite, близкая по SQL, но это **не настоящая Cloudflare D1 binding** и не edge-concurrency. Отдельно перед деплоем проверить D1 `batch()`, consistency, race и применимость миграций на изолированной тестовой D1.
- PHP и Worker на этом тесте не работают по сети; `Request` создаётся и передаётся исходному роутеру в памяти.
- Node24 `node:sqlite` на runner может иметь experimental warning; SDK/FCM не подключены.
- Тестовый контур может фиксировать **неустранённый replay**: одинаковый подписанный HMAC `POST /passenger/push-grant` может выпускать разные `jti` в пределах лимита 5/60, потому что базовый HMAC пока включает timestamp/path/body, но не уникальный nonce. Перед production нужен отдельный nonce/HMAC replay cache или согласованный эквивалент, **не трогая замороженный proxyAuth v1 глобально**.
- WAF для публичных маршрутов пока НЕ включён.

## WAF / Rate Limiting — только проект для рассмотрения, не настройка Cloudflare

Предлагается отдельно защитить только адреса сайта, не рабочие калькулятор, заказ, status и FCM водителя:

```text
(http.host eq "transfer-servis52.ru" and
 (
   (http.request.uri.path eq "/api/passenger-push-grant.php" and
    http.request.method eq "POST") or
   (http.request.uri.path eq "/api/passenger-push-device.php" and
    http.request.method in {"POST" "DELETE"})
 ))
```

Начальный кандидат для тестовой зоны: **IP + дата-центр Cloudflare**, 30 запросов / 60 секунд, исключить доверенный тестовый диапазон только при документированном разрешении, ответ 429/короткий mitigation timeout и наблюдение за ложными блокировками. **Порог является гипотезой, не утверждённой политикой**; нельзя выставлять его на production без анализа фактического трафика/NAT и возможностей тарифного плана. Учитывать normalization и возможные несовпадения URI. Не применять правило ко всем `/api/` — это нарушит работу бронирования.

Официальные источники: [Cloudflare rate limiting rules](https://developers.cloudflare.com/waf/rate-limiting-rules/), [best practices](https://developers.cloudflare.com/waf/rate-limiting-rules/best-practices/), [настройка через dashboard](https://developers.cloudflare.com/waf/rate-limiting-rules/create-zone-dashboard/).

## Приёмка и безопасный переход

1. CI `PHP real signer → Worker router → SQLite` и все существующие тесты `success`.
2. Проектные решения по HMAC nonce/replay, retained tombstones, сроку FCM registration, устройствам на заказ и WAF зафиксированы и утверждены отдельно.
3. С отдельного разрешения владельца готовится **изолированный staging E2E** (в staging FCM отправка отключена), без реальных заказов и токенов. В production Worker/PHP/D1 ничего не изменять по этому PR.
4. Только после подтверждённого staging — отдельный rollout с сохранением rollback плана, включая edge cases терминальных заказов, невозможности выдачи grant и отказа уведомлений.

**Важное правило:** создание PR и зелёный CI не являются разрешением на `merge`, D1 миграцию, production deploy, WAF-запись, запись секретов или отправку FCM.
