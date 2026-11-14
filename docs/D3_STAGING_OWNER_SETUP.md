# Действия владельца перед STAGING E2E

Checkpoint: 2026-11-12. Настоящий SDK-конфиг получен файлом и проверен;
локальные debug/release APK и release AAB собраны. Phone включён по ответу
владельца; App Check, подпись и канал тестирования ещё требуют настройки.
R2 permissions/bucket по последнему подтверждению владельца ещё не готовы.

## 1. Подтверждённые владельцем Firebase identifiers

| Поле | Значение |
|---|---|
| Project name / App nickname | Transfer Driver |
| Project ID / FIREBASE_PROJECT_ID | transfer-driver-1590d |
| Project number / FIREBASE_PROJECT_NUMBER | 502279442547 |
| Android App ID / FIREBASE_DRIVER_APP_ID | 1:502279442547:android:0cfc722af33b476bc41a06 |
| Android package | ru.transferservis.driver |

Формат проверен: номер проекта совпадает с номером в App ID, package совпадает
с applicationId Android. Источники — сообщение владельца и переданный им
SDK config 2026-11-12; identifiers совпали. Прямой доступ к Firebase API
из managed workspace не авторизован. Это публичные identifiers, они не заменяют SDK API key,
Phone Auth, SHA fingerprints, App Check setup или доступ к Google-аккаунту.
Новый Firebase-проект или дубликат Android-приложения создавать не нужно.

## 2. SDK получен; следующий шаг — подпись и App Check

Настоящий google-services.json получен файлом, проверен и хранится только в
локальном gitignored Android app/google-services.json с mode 0600. API key,
содержимое JSON и приватные ключи в исходники/журнал/CI не включаются.
Повторная загрузка SDK config от владельца сейчас не требуется.
Локальные JVM-тесты/debug/release сборки с реальным config прошли;
это ещё не подтверждает рабочий Phone Auth/App Check E2E.

Владелец выбрал Google Play и прямую установку APK. Release/upload-ключа пока нет;
Google Play Console и внутренний канал не подтверждены. Подробная инструкция
создания ключа НА КОМПЬЮТЕРЕ ВЛАДЕЛЬЦА, подписи staging AAB, получения signed
universal APK с той же подписью и регистрации App Check находится в
[Android signing guide](https://github.com/lobanov0710-blip/TransferDriver/blob/arch/spec-v1-security-baseline/docs/RELEASE_SIGNING_OWNER_SETUP.md).
Пароли и .p12 не передаются в чат. Публичный upload certificate не заменяет
app signing certificate, используемый Firebase/Play Integrity.
App Check и backend verification сохраняются; debug provider не добавляется.

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

1. настроить подпись/тестовый канал и App Check; сверить app signing SHA-1/SHA-256
   для Phone Auth и SHA-256 для App Check;
2. подтвердить private R2 и нужные права;
3. сформировать staging-only Wrangler config с подтверждёнными identifiers;
4. пройти tools/d3_staging_preflight.py и выполнить ранее разрешённый staging-only deploy;
5. проверить /v1/driver/me, /photo-checks, /support-cases без авторизации: ожидается
   401, а GET /v1/driver/uploads — 405;
6. выполнить Phone Auth/App Check → staff session → photo upload → refresh → support E2E.

Последний live route probe 2026-11-11 вернул 404. Новый probe, deploy, R2 create,
remote migration apply и authenticated E2E в текущем checkpoint не выполнялись.
Production и неутверждённые D4–D7 не изменяются.
