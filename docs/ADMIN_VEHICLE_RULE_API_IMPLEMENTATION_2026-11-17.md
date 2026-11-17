# Admin: неизменяемые правила автомобилей — этап реализации

Основание: утверждённый контракт `ADMIN_VEHICLE_CLASSIFICATION_CONTRACT_PROPOSAL_2026-11-17.md`, поправка владельца о запрете новых прав диспетчерам и обязательный цвет кузова. Ветка `arch/g2-admin-vehicle-rules` от проверенного `fix/vehicle-color-required` (PR38). Это отдельный подготовительный этап G2.

Реализованы четыре операции:

- GET /v1/admin/vehicle-rules: vehicles.read, точные make/model, limit1..50, UTF-8 keyset cursor с hash поиска и immutable generation; публикация версии делает старый cursor конфликтным.
- GET /v1/admin/vehicle-rules/versions/{version}: vehicles.read, историческая неизменяемая версия и condition IDs. Старое notes сохраняется одной неделимой строкой условия, без автоматического толкования.
- POST /v1/admin/vehicle-rules: только действующий OWNER с серверным MFA; восемь полей утверждённого RuleWrite, обязательные reason, expectedCurrentVersion и Idempotency-Key. Создание версии, определений, CAS head, минимального аудита и компактного replay receipt атомарны. Повтор возвращает первоначальную версию только после новой проверки доступа. Чужие автомобили не меняются.
- GET /v1/admin/vehicles/{vehicleId}/classification: vehicles.verify, заявленные make/model/year/color и закреплённая версия/условия. Пока verifiedParameters и classification равны null, evidence/history пусты; это честная проекция до появления trusted assessment writer. Legacy color null разрешён для чтения/исправления. History cursor ещё не поддерживается и отклоняется.

Полномочия повторно проверяются по фактическим staff/session/tokenVersion/OWNER binding/MFA family и factor revision в SQL batch. Клиентские role/permission/MFA/yearVerified не принимаются. На чтении проверяется итоговый доступ и top-level SQL changes() аудита; при его подавлении или отзыве доступа данные не выдаются. Ошибки не раскрывают SQL/provider/raw body; ответы no-store. Для legacy version длиной121..128 audit target использует rule_ref_ + SHA256, чтобы сохранить существующий лимит target_id120 без потери идентичности.

Migration0022 добавляет только immutable definitions с body types, массивом условий и защищённым основанием/автором. SQL независимо запрещает дубли/неверные типы и кузова: Comfort sedan/crossover, Business sedan кроме Li Auto L7/L9 crossover; для Minivan новое ограничение не вводится. Новые версии не переписываются и не удаляются. Миграция не содержит seed, backfill или смены существующего допуска. Состав марок — утверждённые142 названия плюс уже утверждённые написания EXEED/Skoda из CSV, без новых марок/выдуманных aliases. Это словарь ввода, не whitelist моделей и не разрешение BEV.

Проверки выбираются по риску во время разработки. Вопрос владельца о необходимых проверках не отменяет установленные gates: для этого auth/DB этапа добавлены20 actual HTTP/SQLite сценариев, populated21→22/rollback, native Worker/D1; весь существующий backend CI сохраняется. Локально проверены также binding17, Driver contract10, MFA transport4, migrations22, preflight12 и reference6. Native D1, protected CLI, dependency audit и полный npm выполняются в штатном GitHub CI; локальное ограничение subprocess/socket не обходится. Android runtime не изменён: новый APK, native Android/build/lint этой записью не заявляются.

До завершения CI результат всего этапа не PASS. Итоговые source/tree SHA, run/job и hashes файлов фиксируются отдельным verification receipt после выполнения.

Остаются следующие части утверждённого плана: POST classification/review, trusted assessment/evidence и история, атомарные approval/line/assignment guards, Admin UI/DTO; полный обзор силовых исполнений121 строк и план legacy. Пока этот этап не доказывает полную классификацию/допуск. Старый candidate helper не становится доверенным решением. OWNER-only phone STAGING allowlist не расширен, review POST закрыт. G1paused; D4–D7pending. Remote migration, seed, реальные документы, merge и deploy не выполнялись.


## Проверка завершена

CI44109843561/job134132126272 SUCCESS на source2a5e7b487e9b2a06923586de8230b6b7e63f5f17, tree0aca51165beb7557721a5988aa97132fa8834539:75 npm scripts,22 migrations,12 preflight,6 reference,11 native D1,6 protected CLI,audit0 и bundle PASS. Все26 шагов job успешны. Два первых run остановились на ошибках нового harness: чтение служебной provider metadata и неподдерживаемый integrity_check. В исправленном варианте сравниваются все application tables, native D1 требует quick_check и FK; populated SQLite требует полный integrity_check. Gates не отключены. Точные hashes и история в ADMIN_VEHICLE_RULE_API_VERIFICATION_2026-11-17.json. Поздний docs-only checkpoint не меняет проверенный code source.
