# Журнал backend-аудита — 2026-11-07

Канонический журнал проекта:
https://github.com/lobanov0710-blip/TransferDriver/blob/arch/spec-v1-security-baseline/docs/PROJECT_JOURNAL.md

По поручению владельца проведён аудит backend Phase 1 на базе
`0d764bc4ce4b60360448ec54b61d8d7f03727e8d` и Android security branch.
D1–D3 утверждены, D4–D7 не утверждены.

Исправлены SQL audit/idempotency races availability/phase, replay ordering,
смена машины при активном назначении и отказ off_line после отзыва approval.
Удалены адресные/raw exception logs, JSON API отвечает no-store/nosniff.
Scoped overrides обновляют Miniflare sharp/undici до проверенных версий.
Добавлены 19 regression scenarios, выполняющие реальные SQLite migrations/SQL
и динамические privacy-проверки. CI включает установку lock, audit и dry-run bundle.

Проверки: 57 npm test suites PASS; 14 migrations PASS; npm audit 0;
npm ci --ignore-scripts PASS; Worker dry-run PASS. Production не вызывался.
Предварительные red-тесты воспроизвели ошибки до исправлений.

Отчёт: `AUDIT_2026-11-07.md`; lock inventory: `AUDIT_DEPENDENCIES_2026-11-07.json`.
Новые изменения предназначены для существующего Draft PR #28.
Merge/deploy не выполнялись. Реальные D1/R2/Firebase E2E и release остаются
отдельной обязательной проверкой.

Следующие блокеры: terminal done/canceled mutations с revision/idempotency/audit,
полный photo-check eligibility и согласование Android с /v1 assignment flow.
