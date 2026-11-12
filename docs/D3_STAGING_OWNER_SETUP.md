# Действия владельца перед STAGING E2E

Checkpoint: 2026-11-12. Владелец сообщил существующий Firebase-проект и выбрал
получение настоящего SDK-конфига на своём компьютере. R2 permissions/bucket
по последнему подтверждению владельца ещё не готовы.

## 1. Подтверждённые владельцем Firebase identifiers

| Поле | Значение |
|---|---|
| Project name / App nickname | Transfer Driver |
| Project ID / FIREBASE_PROJECT_ID | transfer-driver-1590d |
| Project number / FIREBASE_PROJECT_NUMBER | 502279442547 |
| Android App ID / FIREBASE_DRIVER_APP_ID | 1:502279442547:android:0cfc722af33b476bc41a06 |
| Android package | ru.transferservis.driver |

Формат проверен: номер проекта совпадает с номером в App ID, package совпадает
с applicationId Android. Источник — сообщение владельца 2026-11-12; независимая
проверка принадлежности App ID проекту и получение SDK config через Firebase API
ещё не выполнены. Это публичные identifiers, они не заменяют SDK API key,
Phone Auth, SHA fingerprints, App Check setup или доступ к Google-аккаунту.
Новый Firebase-проект или дубликат Android-приложения создавать не нужно.

## 2. Получить настоящий google-services.json на компьютере владельца

Нужен Node.js LTS с официального https://nodejs.org/ (если ещё не установлен).
В терминале выполнить последовательно:

```sh
npx -y firebase-tools@latest login
npx -y firebase-tools@latest apps:sdkconfig ANDROID "1:502279442547:android:0cfc722af33b476bc41a06" --project "transfer-driver-1590d" --out "google-services.json"
```

Первая команда открывает официальный Google login. Вход выполняется владельцем
в браузере, без передачи пароля, OAuth-кодов или refresh token в чат.
Вторая команда получает зарегистрированное Android-приложение по точному App ID,
не создаёт новые project/app и сохраняет JSON в текущую папку. Не перенаправлять
SDK config в stdout/CI logs и не заменять его самодельным файлом.

Владелец может передать полученный google-services.json файлом; содержимое
не нужно вставлять в сообщение. После проверки project_info/client package/App ID
он будет размещён в gitignored TransferDriver/app/google-services.json.
Service-account JSON и private keys для этого шага не требуются.

В облачной среде проверена Firebase CLI 15.36.0. login:list сообщил
No authorized accounts; Firebase MCP tools отсутствуют. Поэтому автоматическая
загрузка отсюда пока недоступна. Project/app в Firebase не создавались/не менялись.

Получение JSON само по себе не подтверждает Phone Auth/App Check: далее нужно
проверить разрешённый тестовый канал, fingerprints сертификата и Play Integrity.
App Check и backend verification не отключаются ради E2E.

## 3. Разрешить создание отдельного R2 bucket

Cloudflare credential, передаваемый GitHub Actions в CLOUDFLARE_API_TOKEN,
должен иметь право создания/просмотра R2 buckets в нужном конкретном аккаунте.
Требуемое permission: account-level Workers R2 Storage → Edit.
Object-only/S3 credentials для этого шага недостаточно.

Обновить credential через защищённые настройки GitHub Actions; секрет не должен
попадать в исходники/чат. Альтернатива — создать private bucket в Cloudflare
Dashboard и подтвердить точное имя:

`transfer-servis52-driver-private-staging`

Public access/custom public domain не включаются. Production bucket не используется.
Затем отдельно проверяются существование, приватность, доступ credential и
binding DRIVER_PRIVATE_FILES. По последнему ответу владельца bucket не создан.

## 4. Следующий STAGING checkpoint

Уже применённые migrations 0005–0017 не применяются повторно по догадке;
сначала сверяется remote pending set. После готовности инфраструктуры:

1. получить и сверить настоящий Firebase SDK config, проверить Phone/App Check;
2. подтвердить private R2 и нужные права;
3. сформировать staging-only Wrangler config с подтверждёнными identifiers;
4. пройти tools/d3_staging_preflight.py и выполнить ранее разрешённый staging-only deploy;
5. проверить /v1/driver/me, /photo-checks, /support-cases без авторизации: ожидается
   401, а GET /v1/driver/uploads — 405;
6. выполнить Phone Auth/App Check → staff session → photo upload → refresh → support E2E.

Последний live route probe 2026-11-11 вернул 404. Новый probe, deploy, R2 create,
remote migration apply и authenticated E2E в текущем checkpoint не выполнялись.
Production и неутверждённые D4–D7 не изменяются.
