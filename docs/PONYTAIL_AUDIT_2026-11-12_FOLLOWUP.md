# Ponytail: повторный аудит всего кода — 2026-11-12

Baseline: Android `7b5cb03312bf5822eeef0d444e39fdac8f9db2fe`;
backend `50d14fc1cb2a03f8acd89421b449f6ef69c319a8`.
До изменений git tree локальных checkout точно совпал с обоими GitHub tree.
Предыдущие исправления и журнал сохранены; повторный проход охватывает Android
source/resources/manifest/API/session/UI/push, backend routes/services/SQL,
17 миграций, tests/tools/scripts, зависимости и CI. Внешние production-сервисы
не изменяются. Ponytail проверяет сложность; bugs/security рассмотрены отдельно.

## Подтверждённые замечания и исправления

1. **JWT в application logs.** JSON.parse при ошибочном JWT выдаёт exception с
   фрагментом входной строки. verifyJWT писал весь Error через console.warn.
   Ошибочный JWT теперь молча отвергается без записи входа/stack в журнал.
   Privacy regression сначала падал, после исправления PASS. [src/core/auth.js]
2. **Telegram: token/PII в logs и исключениях.** Network Error мог содержать URL
   с bot token; API description/statusText и chat ID отражались в logs; description
   также передавался в Error вызывающему коду. Оставлены фиксированные категории
   и HTTP status, исключения не отражают upstream body; success не пишет chat ID.
   createOrder тоже не логирует объект исключения. Проверены network failure,
   API failure и success с синтетическими private markers. [telegram.js; orders.js]
3. **Mapbox: произвольный Error.name в logs.** Ограничен категориями AbortError/Error
   без отражения upstream значения. Обе transport-ветки используют одинаковое
   ограничение; regression для geocode сначала FAIL, затем PASS. [geo.js]
4. **Android: stale callback удалял более поздний login.** Шесть экранов повторно
   вызывали SecureSessionStore.clear() после authenticationRequired. Это обходило
   условную инвалидацию в auth/session слое, исправленную ранее. Удалены UI clear
   и два private wrapper. Сессии инвалидируют StaffSessionRefresher/DriverSessionManager
   с проверкой текущего refresh token. Navigation не удаляет более позднюю сессию.
   Новый source guard сначала FAIL, затем PASS. Дополнен runtime test: A отправляет
   HTTP запрос, до его 401 сохраняется login B; запрос не повторяется как B и B
   остаётся в Keystore. Реальная сеть в regression не используется.
5. **CI: нет явного подтверждения выполненных testcases.** После эмулятора CI
   теперь читает настоящие JUnit XML для JVM/Android, проверяет ненулевой набор,
   отсутствие failures/errors/skips и наличие нового HTTP/session regression.
   Печатает фактические counts. Это дополняет существующие Gradle exit-code checks.

## Ponytail: применённые сокращения

- delete: повторная очистка защищённой сессии из UI и private wrappers. Замена — существующая условная инвалидация auth/session слоя. [Android ui/*Activity.java]
- delete: сериализация Error, upstream Telegram body и chat metadata в logs. Замена — фиксированные категории и numeric HTTP status. [backend auth.js; telegram.js; orders.js]
- stdlib: проверка реального выполнения тестов. Использован xml.etree.ElementTree, без нового reporter/framework. [Android .github/workflows/android-branch-tests.yml]

Production source сокращён на 78 строк. Regression tests/config guards/CI добавляют
115 строк; общий code/tests/CI diff: +37 строк. Новых dependencies нет.

## Проверки текущего прохода

- node --check — 127 JS/MJS файлов PASS; Android XML parse — 25 файлов PASS;
- 61 npm suite PASS, включая 6 privacy logging tests;
- 17 migrations smoke PASS, 12 staging preflight tests PASS;
- 7 Android security configuration/source guards PASS; git diff --check PASS;
- Android build/JVM/API 35 runtime и backend clean-install/audit/workerd/dry-run
  завершены в GitHub Actions; точные code SHA и ссылки приведены ниже и в журнале.

Это не объявление абсолютной безопасности или полноценного Firebase E2E.
Authenticated staging E2E по-прежнему требует подтверждённых Firebase identifiers
и private staging R2 bucket/permissions. CI Firebase config — compile fixture.
D4–D7, production, remote migration apply, deploy и merge не изменялись.


## Итоговые CI результаты

- [Android run 43229116512](https://github.com/lobanov0710-blip/TransferDriver/actions/runs/43229116512)
  — SUCCESS, code `9fde9e363f42dc21fb58824bfed0237535a6b5a8`.
  29 JVM tests, 10 API 35 runtime tests, 7 security guards, debug/release/AndroidTest
  сборки, endpoint/App Check policy — PASS. JUnit XML проверены: failures/errors/skips
  отсутствуют, новый HTTP/session regression действительно выполнен.
- [Backend run 43229194856](https://github.com/lobanov0710-blip/uber-v3/actions/runs/43229194856)
  — SUCCESS, code `fe8bcb60f0ca0af9138ea1ceedc9fc3cac3f8580`.
  Locked install, npm audit 0 vulnerabilities, 61 suite, 17 migrations,
  12 preflight tests, local workerd/D1 и Worker dry-run — PASS.
- Все подтверждённые замечания текущего прохода исправлены; полный Firebase/R2
  staging E2E по-прежнему не выполнялся из-за ранее зафиксированных owner blockers.

net: -78 lines, -0 deps (production source; тесты и CI учтены выше отдельно).
