# Действия владельца перед STAGING E2E

Checkpoint: 2026-11-11. Проект Firebase уже существует, но его identifiers
пока не сообщены. Права R2 ещё не добавлены, bucket не создан — подтверждено
владельцем в текущем сеансе.

## 1. Найти существующий Firebase-проект

Откройте https://console.firebase.google.com/ в своём браузере и нажмите
карточку нужного тестового проекта. Firebase Studio — другой интерфейс;
для этих настроек нужна именно Firebase Console.

Слева, рядом с **Обзор проекта / Project Overview**, нажмите шестерёнку,
затем **Настройки проекта / Project settings → Общие / General**.

На этой странице нужны:

| Что прислать | Где находится | Имя настройки backend |
|---|---|---|
| Идентификатор проекта / Project ID | Верхний блок «Ваш проект» | FIREBASE_PROJECT_ID |
| Номер проекта / Project number | Там же; число, не отображаемое название | FIREBASE_PROJECT_NUMBER |
| Идентификатор приложения / App ID | Ниже, «Ваши приложения»: Android с package ru.transferservis.driver | FIREBASE_DRIVER_APP_ID |

App ID имеет форму `1:<тот же номер проекта>:android:<идентификатор>`.
Package `ru.transferservis.driver`, название карточки и App ID — разные значения.
Если Android-приложения с таким package нет, его нужно зарегистрировать в
выбранном тестовом проекте. Это отдельное действие владельца; автоматически
приложение/проект в текущем сеансе не создавались.

Эти три identifiers публичные. Пароль Google, SMS-код, API token Cloudflare,
service-account private key и полный конфигурационный файл в чат не нужны.

## 2. Настоящая Android-конфигурация

После выбора подтверждённого Project ID и авторизации используется официальная
Firebase CLI. В авторизованной локальной среде владельца/сборки:

```sh
npx -y firebase-tools@latest apps:sdkconfig ANDROID <APP_ID> \
  --project <PROJECT_ID> --out app/google-services.json
```

Команда приведена для последующего выполнения с реальными значениями.
`app/google-services.json` уже исключён из Git. Вывод конфигурации не направляется
в логи CI или чат. Наличие файла подтверждает конфигурацию сборки, но не
Phone Auth/App Check: их ещё нужно проверить для реального тестового канала.
Play Integrity и backend App Check verification не отключаются ради E2E.

В текущей облачной среде установлена Firebase CLI 15.35.0; `login:list` не
вернул авторизованных аккаунтов. Project ID не выбран. Инструменты управления
общим Chrome отсутствуют, поэтому учётная запись владельца здесь не подключалась.

## 3. Разрешить создание отдельного R2 bucket

Cloudflare credential, передаваемый GitHub Actions в `CLOUDFLARE_API_TOKEN`,
должен иметь право создания/просмотра R2 buckets в **нужном конкретном аккаунте**.
В Cloudflare API token permissions это account-level **Workers R2 Storage → Edit**.
Object-only/S3 credentials для этого шага недостаточно.

Обновите соответствующий GitHub Actions secret через настройки репозитория;
секрет не должен попадать в исходники или чат. Альтернатива — владелец сам
создаёт private bucket в Cloudflare Dashboard и сообщает подтверждённое имя:

`transfer-servis52-driver-private-staging`

Не включать public access/custom public domain. Не использовать production bucket.
После готовности отдельно проверяются фактическое существование, приватность,
доступ credential и binding `DRIVER_PRIVATE_FILES`.

## 4. Что выполнит следующий STAGING checkpoint

Уже применённые migrations `0005–0017` повторно не применяются по догадке:
перед действиями проверяется remote pending set. Затем:

1. проверить подтверждённые Firebase identifiers и private R2;
2. сформировать staging-only Wrangler config;
3. пройти `tools/d3_staging_preflight.py`;
4. выполнить ранее разрешённый staging-only deploy;
5. проверить `/v1/driver/me`, `/photo-checks`, `/support-cases` без авторизации:
   ожидается 401, а GET `/v1/driver/uploads` — 405;
6. только затем выполнять настоящий Phone Auth/App Check → staff session →
   photo upload → backend refresh → support chat E2E с тестовыми данными.

На 2026-11-11 все четыре route probes ещё дают 404. Локальный preflight PASS
не означает, что инфраструктура создана или что authenticated E2E пройден.
Production и неутверждённые решения D4–D7 этим checkpoint не изменяются.
