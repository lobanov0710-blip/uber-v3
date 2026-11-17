# G2: атомарные исправления и защита прежнего одобрения

Основание: утверждённый classification contract и журнал PR40; отдельная ветка arch/g2-vehicle-review-atomic. Scope — внутренний recorder corrections, прежняя публичная vehicle approval операция и блокировка старого назначения. Публичный classification/review POST пока не открыт: полные GET/history/UI и единый assessment guard для всех admission SQL paths ещё следующие части.

## Исправления параметров

recordTrustedVehicleAssessment теперь атомарно исправляет make/model/modelYear, записывает новую binding generation и immutable assessment, сбрасывает class/прежнее approved состояние, переводит выбранный автомобиль вне линии, фиксирует audit/idempotency и holds старых назначений. Действующие session/tokenVersion/grants/OWNER MFA и evidence проверяются в SQL. Класс кандидата читается только из точной серверной rule; BEV/body и same-make constraints PR40 сохраняются. Powertrain/body остаются в подтверждённых параметрах assessment, legacy vehicle.powertrain не выдаётся за verified field.

expectedRevision/expectedInputRevision описывают исходное состояние автомобиля. expectedRuleVersion — версия, применяемая к новым make/model/year: прежняя закреплённая при неизменных ключах, текущая по целевой марке/модели при фактическом исправлении. Изменение current head после чтения отменяет запись. Mode exception отдельно указывает immutable basisRuleVersion той же фактической марки; expectedRuleVersion всё ещё описывает привязку фактической модели, не подменяется basis. Класс руками не задаётся. Unknown model сохраняется фактической и даёт manual_review, не выдуманный допуск. Явная смена ключей legacy без binding может создать первую подтверждаемую generation; служебной миграции/backfill нет, legacy без изменения ключей по-прежнему требует отдельного inventory/плана.

Проверка сохраняет старые значения в binding/assessment history. При сбое audit откатываются и параметры, и новая привязка, и revision/assessment/line/hold/claim. Same-key/body replay возвращает первоначальный результат и requiresDispatcherReassignment после актуальной проверки доступа; новый driver не выбирается автоматически.

## Старое одобрение и класс

Существующая операция review/items/vehicle/{id} approved дополнительно требует current trusted candidate с подтверждённым годом/evidence. Прежние документы/семь photos/usage guards остаются. Color обязателен также для legacy approval (нет null/blank/control), согласно прямому указанию владельца. Итоговый UPDATE approved сам читает class из current trusted candidate — клиент не передаёт класс. Общая vehicle revision растёт, pinned rule не меняется. Повторная проверка evidence и прав/session/tokenVersion/OWNER MFA выполняется в том же SQL, закрывая race после service precheck. Final registration approval также требует машину с current proof и matching system class и актуальные полномочия. Наличие старого0019 candidate/class в vehicles не удовлетворяет этим guards.

Новая classification операция сама approved не выставляет: её кандидат — отдельный результат, class в vehicles появляется на отдельном итоговом approved. Прежние операционные права не выдаются заново; только существующее vehicles.verify для обычных решений, исключение только OWNER. Identity verification/provider не изменены, D4 не считается утверждённым.

## Старое назначение не оживает после reapproval

Migration0024 создаёт immutable assignment holds, без backfill существующих заказов. Новая проверка при активном назначении или потеря доверия к assessment фиксирует hold. При invalidation также атомарно очищаются прежние class/approved и line; возврат selected документа не восстанавливает доверие. Повторное одобрение машины не снимает hold старого назначения. SQL защищает on_line, phase advancement, guarded done и legacy done. Допустимые offline и ручное переназначение/отзыв сохраняются. Hold привязан к старому assignment ID; создание нового назначения выполняет существующий ручной dispatcher workflow. Автоназначения, автоматического завершения/отмены поездки или отправки настоящих уведомлений при сборке нет.

## Проверка и границы

11 новых real SQLite/auth/HTTP сценариев: старый approve без proof, положительное approved с серверным class, активная поездка и correction/reapproval/hold, current head/evidence/authority races, rollback, document loss/restore, mandatory color и populated23→24/rollback. Existing16 trusted,17 binding,10 Driver,moderation policy/repository также выполняются. Full backend CI77 scripts,13 native D1 workflows,6 protected CLI,audit и dry-run ещё pending. Native fixture cloning включает реальные views/triggers; recorder workflow22→23 затем применяет24 как текущую runtime dependency, сохраняя исходные upgrade assertions. Никаких ослаблений/skip из-за provider ограничений.

Остаются: public classification/review, trusted GET/evidence/history, единый assessment admission guard (включая legacy без подтверждённого года и истечение evidence без изменения строки) во всех line/assign/reassign/phase/done paths, Admin UI/DTO и полный powertrain121/legacy activation. Новый hold guard — дополнение, не заявление готовности всех admission paths. Passenger informing/приёмка manual handoff проверяются при интеграции соответствующего UI/E2E; здесь нет новых real push calls. G1paused,D4–D7pending. Нет seed/remote migration/real sensitive materials/merge/deploy/OWNER-phone expansion/нового APK. Новый Android CI для backend-only шага не заявляется.


При ручном анализе scope invalidation ограничен последней assessment: изменение obsolete evidence из прежней истории не снимает новое одобрение, если current proof уже опирается на другие документы. Old invalidation остаётся в истории. Регрессия11 и native obsoleteEvidenceIsolation проверяют это явно; предшествующий CI не подменяет итоговую проверку исправления.
