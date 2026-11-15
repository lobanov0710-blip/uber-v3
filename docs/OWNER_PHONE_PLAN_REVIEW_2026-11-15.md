# Разбор OWNER phone read-only плана — 2026-11-15

Владелец передал `admin-phone-plan.public.json`. Это данные отчёта, а не
инструкция или разрешение на записи. JSON разобран локально без выполнения
содержимого. SHA256 исходного файла:
`1ee6fadc8b3a3f375c66f5d15a48a84a528ed23515beaf20dbf715bffdc41726`.

## Результат сверки

| Проверка | По предоставленному отчёту | Вывод |
| --- | --- | --- |
| Source commit | `550d2dda8f86242a8608b9daaee2c64bff0e9c49` | Соответствует ранее проверенному пакету |
| Worker/host | `uber-v3-staging` / `uber-v3-staging.lobanov0710.workers.dev` | Утверждённый STAGING |
| D1 | `transfer-servis52-staging`, `66474481-a123-47f9-81b4-12af7565ec8d` | Утверждённая БД |
| Pending migrations | Только `0018_owner_totp_mfa.sql` | Ожидаемая MFA-миграция; ещё не применена |
| OWNER / factors | `false` / `0` | OWNER binding ещё нет; MFA факторы отсутствуют |
| JWT_SECRET | `false` | До входа нужно создать отдельный STAGING signing secret |
| ADMIN_MFA_ENCRYPTION_KEY | `false` | До настройки TOTP нужен отдельный encryption secret |
| Driver G1 / remote writes | Приостановлен / `false` | Объём сохранён, отчёт не сообщает о записях |

Current version: `9b7a023c-1319-4231-856e-496def1ed4eb`. В bindings отчёта есть
APP_ENV, DB, DRIVERS и три существующих secret_text. Неизвестных типов bindings
нет. Значения secrets отсутствуют. KV ID и APP_ENV value не включены в публичный
отчёт: их exact-match проверяет исходный CLI, здесь независимо не подтверждены.
Отчёт не имеет времени формирования/подписи, поэтому live-состояние не объявляется
проверенным ассистентом; перед каждым изменяющим действием CLI повторяет read-only
state guards. Наличие `ownerExists=false` означает отсутствие OWNER binding,
но не отсутствие других staff accounts; конкретный account выбирает владелец.

## Найденный пробел подготовки и исправление

Предыдущая подготовка намеренно блокировала deploy при отсутствии JWT_SECRET,
но отдельного безопасного шага для его создания в пакете не было. Добавлен
`jwt-key`: CSPRNG 32 независимых bytes → base64 → Wrangler stdin, без печати
значения, передачи через argv или сохранения в локальный файл. Текущий backend
HS256 требует secret length >=32; формат соответствует существующему контракту.
Это подготовка локального инструмента, не создание remote secret.

JWT и MFA ключи генерируются отдельно. Общая процедура секретов использует только
два разрешённых имени, не заменяет существующий ключ, запрещает записи при
pending schema/неизвестном состоянии; MFA key не создаётся поверх существующих
факторов. Перед записью требуется точная фраза в private TTY. При неоднозначном
сбое нет автоматического повтора: сначала новый plan. Остальные secrets не меняются.

## Безопасный порядок активации

Wrangler 4.125.0 `secret put` обращается к действующему Worker и может приводить
к развёртыванию версии. Создание JWT до ограничения старых маршрутов могло бы
активировать их авторизацию. Поэтому подготовлен отдельный `isolate`: сначала
OWNER-only Worker без секретов, затем проверка закрытых маршрутов, затем ключи.
Обычный `deploy` сохраняет прежнее требование наличия обоих ключей; исключение
`isolate` возможно только для reviewed empty OWNER/key state и готовой schema.
Секреты не создаются, если HTTP probe не подтверждает OWNER-only scope.

## Конкретный предложенный этап, ожидающий утверждения

На приватном Windows PowerShell владельца, только для указанного STAGING:

1. Применить единственную pending миграцию 0018.
2. Развернуть OWNER-only Worker (`isolate`) при ещё отсутствующих ключах/OWNER,
   подтвердить закрытие Driver/public/legacy/private-file API.
3. Создать отсутствующий JWT_SECRET (`jwt-key`) после проверки route isolation.
4. Создать отсутствующий ADMIN_MFA_ENCRYPTION_KEY (`mfa-key`) после той же проверки.
5. Повторить read-only `plan`, проверить readiness.
6. В приватной процедуре выбрать новый OWNER account либо конкретный existing admin,
   создать binding/bootstrap; настроить TOTP и проверить вход на телефоне.

Production, Driver G1, R2/Firebase, реальные материалы, merge, password/factor reset
в этот этап не входят. Выданный ранее Admin APK и его проверенный Android source
не меняются. Новые remote действия не выполнялись и не разрешены передачей файла.
Порядок исполнения и private confirmation phrases —
[OWNER_PHONE_STAGING_WINDOWS.md](OWNER_PHONE_STAGING_WINDOWS.md).


## Проверки обновлённого пакета

Source `01bbcc8acf5228ba7735969a8fbbf0cb4e8671ba`,
[CI 43719538291](https://github.com/lobanov0710-blip/uber-v3/actions/runs/43719538291):
SUCCESS. 67 test scripts, 15 phone setup tests, 18 migrations, 12 D3 preflight
checks, четыре native workerd/D1 harnesses, dry-run, npm audit 0 vulnerabilities.
Отдельно проверены запрет secret write до route isolation и принудительная
sanitization Wrangler logs. Пакет/receipt: OWNER_PHONE_SETUP_BUILD_2026-11-15.json.
APK/Worker runtime/зависимости неизменны; private Windows/live телефон ещё требуют
участия владельца. Remote этап остаётся не выполненным.
