# Liftback только в Комфорте — реализация 2026-11-18

Владелец ответил «Только в комфорте» на прямой вопрос по кузову. Это разрешает
отдельный `liftback` только для comfort. Бизнес остаётся sedan, кроме прежних
L7/L9 crossover; Минивэн не получает liftback даже при nullable body policy.
Хэтчбек/универсал и aliases не вводятся. BEV по-прежнему исключён.

## Контракт и независимые ограничения

`parameters.bodyType` принимает sedan/crossover/liftback/minivan/other.
`allowedBodyTypes` может содержать liftback только для comfort. Backend API,
trusted decision и SQL проверяют это независимо. OWNER exception/год/условия
не обходят тарифное ограничение кузова. Неподходящий известный кузов сохраняется
в excluded assessment, чтобы не переписывать факты ради допуска. Система
определяет класс; Driver и форма Admin не выбирают класс конкретному автомобилю.

Liftback требует явной разрешающей rule definition. Старые правила без definitions
сохраняют прежний fallback sedan/crossover; существующие JSON definitions и pins
не расширяются. Новая версия, выбор допустимого основания OWNER и новая проверка
явные. New head не меняет существующие автомобили. Assessment candidate не
означает approved/online и не освобождает старый assignment hold.

## Миграция0025

Расширение CHECK в SQLite выполнено атомарной заменой полного трёхтабличного
графа: trusted assessments, invalidations, assignment holds. Все колонки/значения,
rowid, PK/UNIQUE/FK/NOT NULL сохраняются. Триггеры и current view восстановлены,
старые evidence не проверяются заново при копировании. FK/check constraints
не отключаются. Промежуточные таблицы живут только внутри транзакции; ошибка
должна откатить данные, схемы и immutable guards целиком. Никаких fake years,
liftback→other/sedan кодирований, seed, backfill или массовых допусков.

Первая in-memory попытка заменить только parent с RESTRICT FK не прошла;
полный граф выбран после этого эксперимента. Populated24→25 тест охватывает
актуальный assessment, invalidation, hold, audit/idempotency и все остальные
проектные таблицы; проверяет failure rollback, точное равенство строк/rowid,
FK/quick_check, неизменность старого pin/offline/blocked trip и запрет DELETE/UPDATE.

## Admin

DTO распознают liftback и сохраняют его как реальный кузов, не как sedan.
В форме проверки параметров можно явно выбрать/увидеть лифтбек. В OWNER
редакторе checkbox «Лифтбек — только Комфорт» доступен лишь для comfort;
смена класса очищает и выключает его. Подтверждение показывает исходный кузов.
Разбор rule metadata и формирование action также отклоняют liftback вне comfort.
Privacy/MFA/CAS/original same-key retry/очистка в фоне сохраняются. Старый Admin
может отказать при новом enum, поэтому выпуск требует согласованной сборки;
неизвестное значение не трактуется как sedan или автоматическое одобрение.

## Проверка и границы

Добавлены2 backend tests с HTTP/SQL/upgrade matrix,3 JVM и2 Android UI cases;
Native D1 повторяет полный populated upgrade и реальные auth/review endpoints.
Тестируются comfort standard/exception, запреты business/minivan-null/forged SQL,
старый implicit rule, явный новый basis без смены pin, BEV/year guards, строгий
enum, replay без повторного mutation и отсутствие automatic admission/hold release.
Native screenshots в прежних Light/Dark/large-font сценариях используют liftback.

До полного CI и проверки artifacts результат не объявляется проверенной сборкой.
Remote migration/merge/deploy/активация не выполнены. CSV121/архив116 и каталог
полей/годов/условий сохранены; body approval не закрывает полный powertrain range
review, actual legacy inventory и live acceptance. G1paused,D4–D7pending.


Проверка завершена 2026-11-19: backend CI44359299631 и Android
CI44488353051 SUCCESS. Exact source/artifacts/прежние failures и
границы в [receipt](COMFORT_LIFTBACK_VERIFICATION_2026-11-19.json). Активация не выполнена.
