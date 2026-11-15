# Утверждённый OWNER-only STAGING этап — 2026-11-15

Владелец явно утвердил этап после разбора public plan. Дополнительное согласование
этой последовательности в чате не требуется. Приватные действия выполняются
на его Windows PowerShell. G1 остаётся на паузе.

## Проверенный пакет

Используйте обновлённый `owner-phone-setup.zip` в отдельной папке. Старый пакет
не содержит isolate/jwt-key. SHA256:
`27a6469315a5a9d841dd0269d1154648f5be6453be5842008a2f6fb649962ff7`.
Source `01bbcc8acf5228ba7735969a8fbbf0cb4e8671ba`, backend CI 43719538291 SUCCESS.
Admin APK/source прежний: 8a948591, Android CI 43714614881 SUCCESS.

В папке со скачанным архивом:

```powershell
(Get-FileHash .\owner-phone-setup.zip -Algorithm SHA256).Hash
Expand-Archive .\owner-phone-setup.zip -DestinationPath .\owner-phone-approved
Set-Location .\owner-phone-approved
npm ci --ignore-scripts
node .\scripts\adminOwnerPhoneSetup.mjs init
node .\scripts\adminOwnerPhoneSetup.mjs plan
```

Сначала сверить hash. Не перезаписывайте ранее распакованную/private папку.
Node 24 LTS, npm 11.9.0. `init` спрашивает публичный Cloudflare Account ID.
Используйте действующую приватную Cloudflare browser login-сессию с предыдущего
шага. Если она истекла: `node .\node_modules\wrangler\bin\wrangler.js login`.

## Выполнение утверждённого этапа

Каждую команду запускайте отдельно после успешного завершения предыдущей:

```powershell
node .\scripts\adminOwnerPhoneSetup.mjs schema
node .\scripts\adminOwnerPhoneSetup.mjs isolate
node .\scripts\adminOwnerPhoneSetup.mjs jwt-key
node .\scripts\adminOwnerPhoneSetup.mjs mfa-key
node .\scripts\adminOwnerPhoneSetup.mjs plan
node .\scripts\adminOwnerPhoneSetup.mjs owner
```

Точные фразы для защиты target:

| Action | Фраза в приватном терминале |
| --- | --- |
| schema | `APPLY 0018 TO transfer-servis52-staging` |
| isolate | `ISOLATE uber-v3-staging OWNER ONLY` |
| jwt-key | `SET JWT KEY ON uber-v3-staging` |
| mfa-key | `SET MFA KEY ON uber-v3-staging` |
| owner | `PROVISION STAGING OWNER <ID, который покажет CLI>` |

`isolate` публикует OWNER-only Worker до создания ключей и проверяет закрытие
Driver маршрутов. До настроенных ключей/OWNER/MFA рабочий вход недоступен.
Новый secret put не выполняется без подтверждённой route isolation.
Существующие ключи не меняются. В `owner` самостоятельно выберите N для новой
учётной записи или E для привязки конкретного existing active admin. Login/пароль
вводятся только на вашем ПК. TOTP/seed/backup — по разделу «На телефоне»
[основной инструкции](OWNER_PHONE_STAGING_WINDOWS.md). Bootstrap выдаётся
в private TTY только после проверки записи и действует 15 минут.

## Проверка и журнал

После успешной настройки сообщите результаты шагов и факт входа на телефоне,
приложите только `.owner-phone\admin-phone-plan.public.json`. Повторите `plan`
после создания OWNER, чтобы безопасный отчёт отражал актуальное состояние.
При любой ошибке остановитесь: сообщите action name и безопасный plan, если он
сформировался. Нельзя повторять неоднозначную запись вслепую или обходить guards.
Пароль, seed, bootstrap, recovery-коды, токены, SQL и raw provider output в чат
не отправлять. Production/merge/G1/R2/Firebase вне этого утверждения.
