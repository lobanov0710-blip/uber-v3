# Продолжение после сбоя OWNER после PROVISION — 2026-11-15

По переданному public plan OWNER уже существует, factors=0, pending migrations=[],
оба ключа присутствуют. Существующая учётная запись и её пароль сохраняются.
Новый OWNER, смена пароля, сброс TOTP/keys, повтор schema/isolate не требуются.
Утверждение STAGING этапа уже действует; G1 остаётся на паузе.

## Причина и исправление

Wrangler 4.125.0 при remote SQL file import добавляет progress-строки даже с
--json. Ранее наш CLI разбирал весь stdout как JSON и мог завершиться ошибкой
уже после фиксации account/binding/bootstrap. Исправленный CLI проверяет exit
status импорта, затем отдельным strict-JSON запросом в D1 сверяет текущий active
OWNER, новый bootstrap digest и точный непросроченный expiry. Код выдаётся только
после этой проверки. Атомарность import/rollback и все security guards сохранены.

Не редактируйте source/manifest в старом проверенном пакете. Используйте новый
запечатанный ZIP; прошлые APK и пакеты сохранены.

## На Windows PowerShell

1. Сверьте hash нового ZIP с SHA256SUMS и распакуйте в отдельную новую папку.
2. Скопируйте **только локально** `wrangler.admin-phone.staging.json` из текущей
   проверенной папки в новую. Этот config уже успешно прошёл plan; новый CLI
   снова проверит точный target. Ничего из него не присылайте в чат. `node_modules`,
   `.owner-phone` и исходники поверх нового архива не копировать.
3. В новой папке выполняйте команды по одной, после успеха предыдущей:

```powershell
npm ci --ignore-scripts
node .\scripts\adminOwnerPhoneSetup.mjs plan
node .\scripts\adminOwnerPhoneSetup.mjs owner
```

Cloudflare browser login-сессия остаётся прежней. Если она истекла, выполните
`node .\node_modules\wrangler\bin\wrangler.js login` на своём ПК.
Если config не перенесён, создайте его через init с тем же публичным Account ID
перед plan; не запускайте init повторно при уже существующем config.

Ожидается сообщение `Existing OWNER found. It will not be replaced.`.
Вопрос N/E сейчас не ожидается: при его появлении остановитесь и пришлите public
plan для сверки. Не создавайте вторую учётную запись по догадке.

CLI попросит точную фразу PROVISION STAGING OWNER с вашим существующим ID.
Введите её в приватном терминале. Новый bootstrap заменит утраченный setup-код
по digest; пароль/аккаунт/factor не меняются. При уже подключённом TOTP выдача
останавливается: reset не входит в эту процедуру. Код виден только в private
TTY после проверки записи, TTL 15 минут по часам БД.

## На телефоне

В Admin используйте **те же login/password**, которые вводили при создании
учётной записи. Введите новый bootstrap-код из приватного терминала, подключите
аутентификатор по [основной инструкции](OWNER_PHONE_STAGING_WINDOWS.md), подтвердите
TOTP и сохраните recovery-коды до ухода в фон. Затем новый вход с паролем и новым
30-секундным TOTP. APK переустанавливать для этого CLI исправления не требуется.

После успешной настройки выполните plan ещё раз и сообщите только public report
и результат входа на телефоне. При новой ошибке после PROVISION не повторяйте
запись вслепую: сначала plan. Пароли, bootstrap, seed, recovery-коды, private
config/SQL и raw provider logs в чат не передавать.
