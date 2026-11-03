# PUSH-01G — локальный HTTP E2E и проект WAF-правила

**Дата:** 03.11.2026. **Статус:** тестовый Draft PR, не развёрнуто.  
**Основа:** [Worker PUSH-01F PR №18](https://github.com/lobanov0710-blip/uber-v3/pull/18), PHP [PUSH-01F PR №8](https://github.com/lobanov0710-blip/public_html/pull/8). Обе цепочки PR ещё не слиты.  
**Цель:** проверить реальный вызов новых PHP HTTP gateway через cURL без доступа к production, а также зафиксировать изолированную конфигурацию WAF для отдельного рассмотрения.

## Проверка реальной HTTP-цепочки без удалённого сервера

Workflow `.github/workflows/passenger-push-http-loopback.yml` получает Worker branch и **закреплённый SHA** PHP PR №8: `27e0a8a32a096fcb4b2268e45cac7dc74d3b0a6e`. Тест `tests/passengerPushHttpLoopback.e2e.mjs`:

1. Создаёт **временную** файловую структуру `/tmp/.../public_html/api` и `/tmp/.../transfer-private`; использует исходные PHP файлы из PR №8, включая полный код `api/passenger-push-grant.php` и `api/passenger-push-device.php`.
2. **Только во временных копиях** меняет единственный закреплённый Worker URL на `http://127.0.0.1:<port>/passenger/push-*`; проверяет, что реальный URL `workers.dev` больше не присутствует в передаваемых PHP-копиях. Файлы исходного репозитория не изменяются. **Никаких соединений с production Worker.**
3. Поднимает настоящий `php -S` на `127.0.0.1` и локальный Node HTTP server, который запускает **оригинальный** `src/router.js` Worker, без сетевого вызова Cloudflare.
4. Worker использует SQLite in-memory через `node:sqlite` с миграциями **0001–0008**, фактическими SQL `prepare/bind/first/run/batch`. Применение миграций только в оперативной памяти тестового процесса.
5. Проверяет: без двух приватных PHP enable-флагов получение grant и отзыв устройства возвращают 503 и не обращаются к D1; затем флаги создаются **только в `/tmp`**, успешный запрос проходит PHP HTTP → PHP cURL с HMAC v2 nonce → Worker → D1; повтор старого grant не меняет регистрацию; отзыв помечает запись; новое включение отозванного устройства запрещено; `orders` и `staff_push_devices` не меняются.
6. Используются исключительно фиктивные ключи, FCM registration token и заказ с тестовым UUID. **Ни один настоящий заказ или push не создаётся/отправляется.** В конце удаляются все временные PHP/secret файлы и закрывается локальная база.
7. Отдельно повторяются действующие Node/SQLite тесты и интеграционный тест PHP signer → Worker router из PUSH-01E/F.

**Ограничения:** Это локальный тест, но он **действительно** вызывает HTTP-контроллеры PHP и cURL. Это **не** тест настоящего Cloudflare Workers/D1, edge-конкурентности, origin TLS, public hostname, Cloudflare rate limiting или deployed staging. Запуск PHP и Node выполняется в localhost на runner без доступа к секретам аккаунта. Зелёный CI не разрешает переключить production.

## Проект узкого правила Cloudflare WAF

Файл `config/passenger-push-waf-proposal.json` — **только человекочитаемая заявка** с признаком `PROPOSAL_ONLY_DO_NOT_APPLY`. Это **НЕ** API-конфигурация для автоматической установки.

Предлагаемая match expression (Cloudflare zone-level rate limiting):

```text
(http.host eq "transfer-servis52.ru" and
 ((http.request.uri.path eq "/api/passenger-push-grant.php"
   and http.request.method eq "POST") or
  (http.request.uri.path eq "/api/passenger-push-device.php"
   and http.request.method in {"POST" "DELETE"})))
```

Ключ счётчика: IP клиента. Предварительный вариант для анализа: **30 запросов за 60 секунд на IP**, действие Block с настраиваемой длительностью. **Порог, действие и поддержка конкретным тарифным планом Cloudflare не проверены и не утверждены**; не запускать правило на production без анализа NAT/CGNAT, распределения реального трафика, false positives и тарифных возможностей. Два URI изолированы; не ограничивать `/api/order.php`, `/api/order-status.php`, калькулятор или staff endpoints.

Важно:
- WAF должен действовать **до** обработки PHP/cURL, поскольку rate-limit из PUSH-01D учитывает только уже авторизованный `orderId`; одно не заменяет другое.
- Ответ origin/edge при блокировке и поведение мобильного retry требуют отдельного теста и мониторинга; не утверждать заранее точный HTTP status или availability.
- Публичные `PHP` endpoints в этом PR отсутствуют и остаются выключенными до отдельных флагов.
- **Счётчики на IP не разделяют пассажиров за одним CGNAT/IP**. Нужно оценить нормальный burst на один заказ/устройство и лимитировать ошибочные запросы без создания ложных блокировок.
- Включение Cloudflare WAF требует согласия владельца и записи через Cloudflare Dashboard/API в отдельной операции. В этом PR нет API token, zone ID, правил и записи в Cloudflare.

Тест `tests/passengerPushWafScope.test.mjs` подтверждает **строго два указанных URI и методы**, отсутствие wildcard, исключение рабочих маршрутов и то, что конфигурация отмечена как `DO_NOT_APPLY`.

Источники: Cloudflare [Rate limiting parameters](https://developers.cloudflare.com/waf/rate-limiting-rules/parameters/), [best practices](https://developers.cloudflare.com/waf/rate-limiting-rules/best-practices/) и [local D1 development](https://developers.cloudflare.com/workers/local-development/local-data/).

## Оставшийся план проверки STAGING — только после разрешения

1. Проверить актуальное состояние `uber-v3-staging`, собственные test D1/KV, исключение реальной отправки Telegram/FCM, тестовый PHP gateway и валидацию rollback-плана; production Worker/D1 оставить нетронутыми.
2. Утвердить временную установку миграций **0005–0008 только в staging D1**, строго `--remote` с staging config/database и отдельными безопасными credentials. Ошибка выбора базы критична — перед любыми командами независимая проверка namespace/database ID.
3. Использовать фиктивные order/installation IDs и тестовую capability; разрешить тестовое создание **только staging заказа**, если для E2E иначе невозможно. Не использовать реальные FCM токены и не включать sender.
4. Разрешить/запретить временный private-флаг PHP gateway в staging, выполнить реальный HTTPS grant → register/revoke через staging; проверить guard 403/503/409, одноразовость nonce и идентификаторов при одновременных запросах.
5. После теста выключить флаги и убедиться, что production не изменялся. При необходимости rollback выполнять только по отдельно утверждённому плану.
6. Без успешного staging, WAF и согласованной политики retention нельзя включать production/Firebase.

**Итог:** новый PR не меняет ни публичный сайт, ни Worker production, ни удалённые базы, ни текущие Android-приложения; никаких merge/deploy, WAF записи и реальных push.
