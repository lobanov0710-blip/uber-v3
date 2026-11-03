# PUSH-01F — одноразовый HMAC nonce для пассажирских push-маршрутов

**Дата:** 03.11.2026. **Статус:** feature/Draft, не развёрнуто.  
**Зависимость:** [PUSH-01E PR №17](https://github.com/lobanov0710-blip/uber-v3/pull/17), который зависит от PUSH-01D → C → B → A. PHP-часть: [public_html PR №8](https://github.com/lobanov0710-blip/public_html/pull/8).  
**Обязательное условие:** новые серверные и PHP изменения должны быть объединены совместно перед каким-либо включением. Frozen v1 и staff auth не изменяются.

## 1. Контракт HMAC v2

Новые endpoints (другие маршруты Worker продолжают использовать существующий v1 verifier):

| PHP | Worker | Методы |
|---|---|---|
| `/api/passenger-push-grant.php` | `/passenger/push-grant` | POST |
| `/api/passenger-push-device.php` | `/passenger/push-device` | POST, DELETE |

PHP генерирует новый nonce через `bin2hex(random_bytes(16))`: ровно 32 строчных hex-символа (128 бит). Каждый новый запрос имеет **новый nonce**, даже если JSON и время совпадают.

Пример канонической HMAC-строки (разделитель — один LF, **без завершающего LF**):

```text
PASSENGER-PUSH-V2
POST
<Unix timestamp seconds>
/passenger/push-grant
<32 lowercase hex nonce>
<unchanged raw JSON body>
```

Подпись: `HMAC-SHA256(PROXY_HMAC_SECRET, canonical)` в строчном hex. PHP отправляет `X-Proxy-Timestamp`, `X-Proxy-Nonce`, `X-Proxy-Signature`. Все поля, включая метод, bind к подписи. Нельзя получать nonce от Android/браузера. Nonce и подпись нельзя писать в обычные application/access логи.

Worker `verifyPassengerPushProxyRequest`:
- проверяет точный path и разрешённый HTTP-метод, timestamp формата 10 цифр с допуском ±300 секунд, nonce 32 lowercase hex, HMAC подпись 64 lowercase hex, содержимое body до 8192 байт;
- сверяет HMAC через Web Crypto `crypto.subtle.verify()`;
- **после успешной криптографической проверки** атомарно выполняет `INSERT OR IGNORE` в отдельную D1 таблицу `passenger_push_proxy_nonces` (миграция `0008`). Уникальный PRIMARY KEY предотвращает повтор при последовательной и конкурентной доставке;
- только при `changes=1` возвращает `ok=true`. При повторном nonce — HTTP 403 без выдачи grant и без изменения регистрации; при DB error/отсутствии секретов — 503 (fail-closed).

Nonce принадлежит **всему пассажирскому контуру**, а не одному устройству. Старый HMAC v1 **не принимается** на новых маршрутах, в то время как `/calculate`, `/orders`, `/order-status` и staff маршруты остались на прежнем verifier.

## 2. Срок жизни и очистка

`prunePassengerPushProxyNonces(env, now)` — **отдельно вызываемая**, не scheduled и не exposed по HTTP функция. Удаляет только nonce старше 20 минут. Это длиннее окна допустимого timestamp ±5 минут; удаление после 20 минут безопасно при корректной синхронизации часов. База может расти, пока план очистки не утверждён и не включён; **для production это блокер**. В этой ветке нет вызова Cron, удалённого D1 и правок существующего планировщика.

Миграция `0008_passenger_push_proxy_nonces.sql` аддитивная. В staging/production **не применялась**. Включать v2-маршруты до применения миграций 0005–0008 и проверки совместимости PHP/Worker нельзя.

## 3. Тестирование

- PHP: реальный `buildPassengerPushAuthHeaders()`, случайный nonce, верная каноническая подпись, запрещённые method/path; локальный fail-closed GET=405, POST/DELETE=503 без out-of-webroot enable-файлов.
- Worker: unit-тесты правильной подписи, replay (включая два конкурирующих запроса), отсутствие/ошибка D1, tampered body/path/method/nonce, v1 rejection, границы timestamp, nonce purge.
- D1: применение миграций 0001–0008, фактические `INSERT OR IGNORE`, уникальность, очистка в локальной SQLite.
- Интеграция: **реальная PHP v2 signing function** → Worker router (in-memory HTTP `Request`) → SQL SQLite, подтверждение, что одинаковые signed headers не приводят к двойной выдаче grant, а новые независимые nonce проходят до лимита 5/60.
- Реальный edge Worker/Cloudflare D1 и действующий PHP-шлюз **не испытывались в сети**.

## 4. Оставшиеся условия для релиза

1. Вариант E2E только через изолированный staging (реальные FCM отключены) и только после отдельного разрешения. Не считать локальный Node/SQLite эквивалентом Cloudflare D1 concurrency.
2. WAF/rate limiting на Cloudflare для **двух новых PHP endpoint**, до PHP/Worker; per-order лимит не заменяет защиту от неавторизованных запросов.
3. Утвердить хранение FCM, срок жизни регистрации, правила смены installationId, очистку tombstones, безопасное расписание обслуживания nonce/FCM и способность отката миграций.
4. Отдельно настроить Firebase Android app, opt-in и mock-уведомления. Без этого доставка FCM не существует.
5. Ни один из PR не означает одобрение merge, deploy, записи secrets, production D1 migration или реальных push.

**Никакой production Worker, сайт, staff FCM и Android APK этой веткой не изменены.**
