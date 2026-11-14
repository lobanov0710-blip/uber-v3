# OWNER TOTP MFA — API и локальные проверки

Основание: владелец 2026-11-14 явно утвердил параметры и API из
[утверждённого документа Admin](https://github.com/lobanov0710-blip/TransferDriver/blob/arch/g2-transfer-admin/docs/ADMIN_MFA_TOTP_PROPOSAL.md).
Реализация разрабатывается в arch/g2-owner-totp-mfa. G1 приостановлен;
этот документ не разрешает deployment, merge или remote migration apply.

## Серверная настройка

Новая добавочная миграция: 0018_owner_totp_mfa.sql. Она пока применяется только
к локальному SQLite/эфемерной workerd D1 в тестах. Remote state не проверялся и
миграция удалённо не применялась; 0005–0017 ранее применены к STAGING отдельно.

ADMIN_MFA_ENCRYPTION_KEY — отдельные 32 случайных bytes в base64/base64url,
предоставляемые backend через защищённое secret storage. Значение не помещается
в vars/config/Git/Android. Реальный ключ в этой рабочей среде не создавался.
Без ключа OWNER не получает новую login challenge/session; Dispatcher/Driver
сохраняют прежнюю staff-auth. AES-GCM envelope имеет version=1 и account-bound AAD.
Смена ключа требует отдельной контролируемой процедуры; plaintext fallback нет.

## Вход

POST /staff/login с прежними login/password. Для текущего активного OWNER после
проверки пароля возвращается:

    {"ok":true,"mfaRequired":true,"challengeId":"mfa_<opaque>","expiresAt":<unix-ms>}

При отсутствии подключённого фактора добавляется enrollmentRequired=true.
Access/refresh token не выдаются. Challenge хранится только как SHA-256 digest,
живёт 5 минут и допускает не более 5 неудачных проверок. Привязаны account,
password tokenVersion и factor revision. Роль OWNER берётся из staff_owner_binding.

POST /v1/admin/mfa/totp/verify: challengeId + code (строка из 6 ASCII digits).
POST /v1/admin/mfa/recovery/verify: challengeId + recoveryCode (128-bit hex,
регистр не важен, допустимы разделители-дефисы). Успех — прежний staff login response.
Counter/recovery и challenge потребляются вместе с session/family/evidence/audit
в одной D1 batch-транзакции. В конкурентной проверке один победитель.

MFA evidence связано со staff_sessions через серверный family_id и отдельную
admin_mfa_session_families: account, tokenVersion, factor revision, verified/expires,
method. Refresh наследует ту же family и не продлевает 12-часовое подтверждение.
Центральный authenticateStaffRequest проверяет evidence из D1 для каждого OWNER
request, включая legacy /orders, /staff/accounts и прочие staff admin endpoints.
Старый password-only OWNER token не даёт operational access.

GET /v1/admin/me после полной проверки возвращает admin.mfa:
required=true, verified=true, expiresAt, method=totp/recovery. Клиент не открывает
OWNER разделы без текущего typed server evidence. Header/JSON client flag его не заменяет.

## Первичное подключение

1. Владелец в приватном интерактивном терминале работает с существующей локальной
   SQLite DB и уже определённым активным OWNER:

       node scripts/adminMfaBootstrap.mjs --local-db /private/owner.sqlite --owner-id <account-id>

   CLI не создаёт аккаунт, не выбирает OWNER, не обращается к сети/remote D1.
   Он проверяет owner binding, сохраняет только digest кода и выводит raw code
   только в TTY; перенаправление stdout/CI запрещено. Код в чат/Git не передаётся.
2. После password challenge: POST /v1/admin/mfa/enrollment/start с challengeId и
   bootstrapCode. Bootstrap живёт до 15 минут, не более 3 неудачных попыток;
   enrollment ограничен сроком password challenge и однократно резервирует bootstrap.
   Ответ: ok, enrollmentId, secret (32 Base32 chars), expiresAt, requestId.
3. Seed показывается только на защищённом экране Admin; ручное добавление в
   authenticator, без внешнего QR-сервиса, clipboard и persisted state.
4. POST /v1/admin/mfa/enrollment/confirm: enrollmentId + текущий code.
   Атомарно активируется фактор, расходуются challenge/bootstrap, отзываются прежние
   OWNER sessions и создаются 10 recovery digests. Ответ содержит recoveryCodes
   ОДИН РАЗ, без staff tokens. Затем нужен новый password/TOTP login; код,
   использованный при enrollment, нельзя применить повторно в том же counter.
5. При прерывании/истечении незавершённой настройки владелец создаёт новый bootstrap
   через тот же защищённый control plane; старый seed повторно API не выдаётся.

## Сброс

Только отдельное явное действие владельца в control plane:

    node scripts/adminMfaBootstrap.mjs --local-db /private/owner.sqlite --owner-id <id> --reset --confirm-owner-id <id>

CLI требует совпадающее подтверждение, отзывает все OWNER sessions, меняет tokenVersion,
удаляет прежний фактор/recovery, инвалидирует challenges и выдаёт новый bootstrap.
Сброса по одному паролю/SMS, dispatcher grant или public HTTP reset endpoint нет.
Это локальный инструмент, не способ автоматически обойти запрет remote изменений.

## Лимиты и чувствительные данные

- Неудачные проверки: 10 за скользящие 15 минут на account digest, 20 за скользящую
  минуту на IP digest; успешные проверки не тратят failure quota. Проверка лимита
  повторяется в атомарном claim/enrollment. Переход календарной границы не сбрасывает лимит.
- Trusted edge IP берётся только из CF-Connecting-IP; отсутствие/ошибка IP для MFA
  приводит к отказу. Client-supplied account/role/mfa flags не принимаются.
- Auth JSON ограничен 4096 bytes в том числе chunked; sensitive responses no-store.
- Audit хранит actor/action/outcome/requestId, без seed/code/password/raw tokens/IP.
- Hourly cleanup удаляет expired challenge/enrollment/bootstrap/rate/evidence metadata;
  access/replay/expiry проверки не зависят от запуска cleanup.
- Seed/recovery видимы лишь в volatile защищённом UI, очищаются при уходе в фон;
  не сериализуются в Bundle, preferences, Keystore, clipboard, logs или FCM.

Проверки: RFC 6238 vectors, реальные SQLite транзакции/rollback/replay/rate/expiry,
public HTTP contracts и local workerd с реальным bundled router, Android JVM/runtime
и полный lint. Точные выполненные результаты записываются в PROJECT_JOURNAL.md;
наличие команд не является заявлением об их выполнении.
