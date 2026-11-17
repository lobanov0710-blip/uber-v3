# Фиксация версии и запрет новых прав диспетчера

Основание — контракт утверждён владельцем 2026-11-17 с поправкой
«права диспетчерам не давать». Новые vehicle_rules.manage и
vehicles.approve_exception — только OWNER, не grant для DISPATCHER.
Существующие операционные права диспетчера не отзываются. Серверное MFA OWNER
сохраняется; новые внешние операции управления этим срезом не открываются.

## Реализованный prerequisite

Добавочная миграция0021 создаёт immutable историю vehicle_classification_bindings.
AFTER INSERT vehicles фиксирует текущую версию правила в той же SQL операции,
что создаёт автомобиль. Если правила нет, фиксируется null; последующее
добавление правила само по себе эту запись не меняет. Смена make/model/model_year
создаёт следующую input_revision с текущей версией. Цвет, фото, статус, обычная
revision и запись прежних значений не создают новую привязку. Выбор версии не
зависит от отдельного предварительного SELECT в приложении.

История хранит исходные make/model/year и source_vehicle_revision, а не VIN,
номер, телефон или документы. Текущий internal read ограничен driver_id.
Старые записи при миграции остаются без выдуманной истории. Нейтральное изменение
legacy автомобиля не создаёт привязку; явная смена ключевых данных создаёт её.
FK сохраняет модель/версию, triggers запрещают перезапись/удаление истории.
Ошибка binding insert откатывает создание автомобиля; ошибка аудита PATCH
откатывает автомобиль/off_line и новую trigger-created привязку вместе.

Новые OWNER-only права фильтруются из permissions DISPATCHER и отклоняются
adminCan даже при ошибочно сконструированном permission list. SQL triggers
запрещают их INSERT/UPDATE не-владельцу, включая регистр и все крайние пробельные
символы ECMAScript trim. Старые ошибочные строки не удаляются миграцией, но не
дают доступа. Снятие owner binding лишает старого владельца этих прав.

## Границы

Привязка версии не является classification assessment, подтверждением года,
класса или допуском. vehicles.class/status и старые данные миграция не меняет.
Legacy helper captureCurrentVehicleClassification по-прежнему является
неподключённым компонентом candidate/current-head из PR33: он не читает новый
binding и не может использоваться как trusted review/допуск. Будущий trusted
service должен читать закреплённую версию и создавать проверенный assessment;
не подключать прежний helper напрямую к маршруту или approval.

Впереди: trusted параметры/evidence/условия/исключения, административные API
правил и assessment, guards approval/line/assign/reassign/phase/done, Admin UI.
Полный BEV обзор/legacy plan/in_progress handoff также не завершены.
История immutable не утверждает срок хранения реальных данных: D5 остаётся
отдельным решением. Никаких seed, remote migration, merge/deploy, реальных
материалов или расширения OWNER-only STAGING. G1paused,D4–D7pending.

## Проверки

16 actual SQLite/HTTP cases: populated20→21 и rollback, сохранность всех старых
таблиц/FK/integrity, first save/unknown rule/new registration, no-op/unrelated
edits, отдельные make/model/year edits, audit/binding failure rollback,
immutable history/owner-bound read/stale revision, запрет грантов и old erroneous
rows/потеря owner binding. Native Worker HTTP/D1 fixture проверяет actual upgrade,
его rollback, trigger pinning и запрет полномочий; полный CI обязателен.
Итоговый source/run/results фиксируются отдельно после окончания проверки.
