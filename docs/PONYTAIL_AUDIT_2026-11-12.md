# Ponytail audit — 2026-11-11–12

Исходные ветки: TransferDriver `arch/spec-v1-security-baseline`,
`7a8fe6c8faa33b458a79569a80faaacdb4847503`; uber-v3
`arch/spec-v1-backend-phase1`, `868e940cb4ac7e6ad96c28c42c7aecc695620f1a`.
Проверены tracked source/config/tests/tools, Android resources/manifest,
backend routes/SQL/migrations/dependencies/CI и связи с утверждённым ТЗ v1.0.
Ponytail применён к сложности; ошибки корректности/безопасности рассмотрены
отдельным проходом. Пользователь явно поручил сразу применять исправления.

## Ponytail: исправленные замечания, по размеру сокращения

- delete: старый недостижимый неидемпотентный путь начала модерации. Оставлен router → adminItemModerationService → idempotent repository. [uber-v3/src/core/adminRegistrationService.js; adminRegistrationRepository.js]
- native: большой SQL fake старого пути модерации. Заменён проверками очереди/прав на SQLite с настоящими миграциями и существующим fixture. [uber-v3/tests/adminRegistrationService.test.mjs]
- delete: неиспользуемый массовый notifyNewOrders. Замена отсутствует; события назначений адресные. [TransferDriver/app/src/main/java/ru/transferservis/driver/notifications/DriverNotificationManager.java]
- delete: неиспользуемый HTTP wrapper и тест только его логирования. Тесты действующих API на отсутствие утечек сохранены. [uber-v3/src/core/http.js; tests/privacyLogging.test.mjs]
- delete: недостижимый MainActivity/layout и тест 2+2. Замена отсутствует; рабочий launcher — LoginActivity. [TransferDriver/app/src/main/java/ru/transferservis/driver/MainActivity.java; res/layout/activity_main.xml; test/ExampleUnitTest.java]
- delete: устаревший ручной JVM runner, не учитывавший BuildConfig/PhoneNormalizer. Используется полный Gradle testDebugUnitTest из CI, без фиктивных Java классов. [TransferDriver/tools/run_jvm_security_tests.sh]
- stdlib: ручная сборка канонического объекта. Object.fromEntries сохраняет own-key __proto__ и порядок сортировки. [uber-v3/src/core/mutationIdempotency.js]
- delete: пустая ветвь чтения statement.sql, существовавшая только для fakes. Валидация ограниченного idempotency-result сохранена. [uber-v3/src/core/adminItemModerationRepository.js]
- native: hashCode как идентификатор уведомления/PendingIntent. Используются точный string tag NotificationManager и Intent.data; разные заказы не объединяются из-за коллизии int. [TransferDriver/app/src/main/java/ru/transferservis/driver/notifications/DriverNotificationManager.java]

## Исправления корректности и безопасности

1. JSON own-key __proto__ давал digest как у пустого объекта, в том числе вложенного.
   Воспроизведён падающий тест; оба случая теперь дают разные digest.
2. Backend FCM отправляет order_assigned/order_assignment_revoked, Android принимал
   только new_order. Добавлены строгий разбор ограниченных identifiers/revision,
   адресное уведомление/отмена; legacy broadcast отвергается. Push не авторизует
   доступ: экран получает данные из backend. Токены/данные пассажиров не логируются.
3. SecureSessionStore: разные экземпляры могли читать IV/ciphertext из разных
   обновлений, а запоздавшая rotation сохраняла старую сессию после clear/new login.
   Чтение/запись/удаление разделяют один process lock. Rotation и stale clear
   сравнивают driver ID + refresh token атомарно. Network выполняется вне store lock.
4. Повтор после HTTP 401 мог использовать последующий login другого водителя.
   Recovery сверяет ID исходного водителя и не повторяет такой запрос как другой.
5. Успешная item/final moderation повторно проверяла уже изменённые status/revision
   до idempotency replay. Replay перенесён после актуальной авторизации/валидации,
   до mutable state guards. Отозванные права по-прежнему дают 403.
6. Начало/завершение moderation сравнивали driver_profile с review type
   driver_registration: audit не записывался и транзакция объявлялась неполной.
   Для audit явно связывается правильный review type; audit target driver_profile
   сохранён. SQLite проверяет начало, завершение, replay и rollback при ошибке audit.
7. JPEG sanitizer терял четыре зеркальных EXIF-ориентации при удалении metadata.
   Matrix обрабатывает все восемь ориентаций; pixel-тест проверяет видимые углы.
8. Отсутствие camera Activity приводило к необработанному ActivityNotFoundException.
   Ошибка обрабатывается существующим cleanup и сообщением пользователю.
9. Android source guards искали удалённый password field/старую push validation.
   Теперь проверяют saveEnabled=false для phone/SMS и текущий parser; включены в CI.

## Проверки

- До исправления воспроизведены digest collision, moderation replay failures,
  неполная start/final audit transaction, устаревшие Android guard/JVM runner.
- Локально: 61 npm suite PASS; 17 migration smoke PASS; 12 staging-preflight tests
  PASS; npm audit — 0 vulnerabilities; Android security configuration — 6 PASS.
- Расширенные mutationReplay SQLite tests — 14 PASS, включая отказ после отзыва
  OWNER и rollback всей moderation при сбое audit. Policy tests — PASS.
- git diff --check — PASS.
- Для новых Android regression tests (Keystore, delayed rotation/logout/new login,
  account switch recovery, EXIF corners) добавлен API 35 emulator в canonical CI.
  Итоговые CI build/runtime результаты — PASS, ссылки приведены ниже.
- Полный Firebase/Phone Auth/App Check/R2 E2E остаётся BLOCKED: владелец ещё не
  подтвердил Firebase identifiers и R2 create/list права/bucket. CI compile fixture
  не доказывает реальный вход. Безопасность и App Check не отключались.

Новые зависимости не добавлены. Сохранены server permissions, revision/claim guards,
аудит, private upload validation, TLS/host locks, Android Keystore/backup policy.
D4–D7 и границы production не изменены. Merge/deploy не выполняются этим аудитом.


## Итоговая проверка CI — 2026-11-12

- Android code `3273bfc25316e790f26286ba5477c7037f710014`:
  [run 43224019792](https://github.com/lobanov0710-blip/TransferDriver/actions/runs/43224019792)
  — SUCCESS. testDebugUnitTest, assembleDebug, assembleRelease,
  assembleDebugAndroidTest, 6 source guards, variant endpoint locks и
  Play Integrity policy — PASS. connectedDebugAndroidTest на API 35 — PASS.
- Backend final code/CI `ea1109107b479e33b914aec047aeaa8f3daae76f`:
  [run 43224400939](https://github.com/lobanov0710-blip/uber-v3/actions/runs/43224400939)
  — SUCCESS. Locked install, npm audit (0 vulnerabilities), 17 migrations,
  12 preflight checks, 61 npm suites, local workerd/D1 и Worker dry-run — PASS.
- Первый backend run 43224042256 также PASS. Предупреждение Node20 runtime
  checkout/setup-node устранено обновлением до SHA с Node24 runtime;
  повторный run больше его не содержит. Node приложения 22, npm 11.9.0,
  disabled lifecycle scripts и pinned actions сохранены.
- Реального authenticated D3 STAGING E2E не было: Firebase identifiers и
  private staging R2 ещё не предоставлены. Deploy/merge не выполнялись.

net: -936 lines, -0 deps (code/tests/CI после исправлений, без этого отчёта и журнала).
