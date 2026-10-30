# STAGING-TG-01 — Telegram-уведомление для тестового заказа Android

**Назначение:** проверить сквозной путь пассажирского Android Debug → staging PHP Gateway → `uber-v3-staging` → staging D1 → Telegram **тестового бота**. Подписанный APK, production Worker/D1, Firebase FCM и настоящие пассажирские заявки в этот этап не входят.

## Изменение поведения

В `src/core/telegram.js` действуют разные режимы:

| Окружение | Настройка | Результат |
|---|---|---|
| `APP_ENV=staging` | `STAGING_TELEGRAM_ENABLED` не равен `true` | Telegram пропущен (`skipped: true`), без HTTP-запроса |
| `APP_ENV=staging` | `STAGING_TELEGRAM_ENABLED=true` | Отправка только через `STAGING_TG_BOT_TOKEN` и `STAGING_TG_CHAT_ID` |
| `APP_ENV=staging` | Флаг включён, тестовые реквизиты не заданы | Ошибка конфигурации, **нет** резервного использования production токена |
| Production / без `APP_ENV=staging` | Независимо от staging-флага | Прежние `TG_BOT_TOKEN` и `TG_CHAT_ID`, без изменений |

На каждое staging-сообщение добавляется префикс `[ТЕСТ / STAGING]`. Функция Telegram ограничивает тело 4000 символами. Водительские FCM-push в staging **по-прежнему запрещены** независимо от Telegram-флага.

Сохранение заказа в D1 и Telegram — разные события: код `createOrder()` перехватывает Telegram-ошибку после записи, поэтому успешный HTTP-ответ заказа **не подтверждает** отправку Telegram. Сравнивать ID заказа и `TELEGRAM SENT.messageId` в логах; затем непосредственно проверять наличие сообщения в тестовом чате. Повторный идемпотентный заказ не должен отправлять новое сообщение.

## Настройка только в Cloudflare staging

Владелец должен подготовить **отдельный тестовый бот и тестовый чат**, дать боту права отправлять сообщения и сохранить секреты **в настройках Worker staging**, не в Android APK, PHP-хосте, GitHub, PR, stdout или чате с помощником.

Используя существующий **локальный** `wrangler.staging.toml` (конфигурация staging-хранилища и Worker уже была настроена отдельно, не копировать production bindings):

```powershell
npx wrangler secret put STAGING_TG_BOT_TOKEN --config wrangler.staging.toml
npx wrangler secret put STAGING_TG_CHAT_ID --config wrangler.staging.toml
```

В обоих случаях значение вводится непосредственно в консоли; нельзя добавлять значение токена в параметры PowerShell или публикации. `STAGING_TELEGRAM_ENABLED` можно задать секретом (строка `true`), чтобы не коммитить staging-конфигурацию:

```powershell
npx wrangler secret put STAGING_TELEGRAM_ENABLED --config wrangler.staging.toml
```

**Порядок:** сначала PR и тесты → согласование слияния `uber-v3/main` → контролируемый deployment **только** `uber-v3-staging` → внесение тестовых секретов и включение флага → один явно помеченный тестовый заказ из Android Debug. Перед развёртыванием проверить реальные bindings, `APP_ENV=staging` и URL в локальной конфигурации. Не использовать `npx wrangler deploy` без `--config wrangler.staging.toml`. **Этот PR ничего не развёртывает.**

## Приёмка с Android-эмулятора

1. Проверить Debug package `ru.transferservis.app.staging`; API должен быть `https://staging.transfer-servis52.ru/` и загружен актуальный тестовый access-token. Не использовать Release `ru.transferservis.app`.
2. Сделать расчёт маршрута в staging, затем оформить **одну** синтетическую заявку (тестовое имя, тестовый телефон, будущая дата, комментарий `ТЕСТ STAGING-TG-01`). Не использовать персональные данные настоящих клиентов.
3. Сверить `orderId`, HTTP-успех, наличие **одной** записи в staging D1 и Telegram-лог `TELEGRAM SENT` с `messageId`.
4. В тестовом Telegram-чате подтвердить полученное сообщение с префиксом `[ТЕСТ / STAGING]`, ожидаемым маршрутом и ID заказа.
5. Проверить повторную отправку того же сохранённого payload: ID тот же, второго Telegram-сообщения нет. Не запускать новую заявку ради проверки идемпотентности.
6. Убедиться, что ни один водитель не получил FCM из staging. Отсутствие FCM подтверждается по логам/счётчикам; факт отсутствия доставки на все устройства из интерфейса установить нельзя.

**Статус:** новая логика требует CI, слияния, проверки staging-секретов, отдельного deployment и реального E2E. До этого Telegram-сообщение с эмулятора **не подтверждено**.

## Откат

Быстрый отказ от тестовых Telegram-сообщений: установить `STAGING_TELEGRAM_ENABLED` в `false` через секрет **только** staging Worker (или удалить его) и проверить, что отправки больше нет. Не изменять production `TG_BOT_TOKEN` / `TG_CHAT_ID`, D1 и Firebase.
