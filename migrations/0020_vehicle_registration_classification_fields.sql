-- Preserve all existing classes while allowing a new, unclassified draft.
-- DROP COLUMN avoids replacing vehicles or cascading dependent records.
-- No fake class or year is assigned to existing or new vehicles.
ALTER TABLE vehicles ADD COLUMN classification_legacy_class TEXT DEFAULT NULL;
UPDATE vehicles SET classification_legacy_class = class;
ALTER TABLE vehicles DROP COLUMN class;
ALTER TABLE vehicles ADD COLUMN class TEXT DEFAULT NULL
    CHECK (class IS NULL OR class IN ('comfort','business','minivan'));
UPDATE vehicles SET class = classification_legacy_class;
ALTER TABLE vehicles DROP COLUMN classification_legacy_class;

ALTER TABLE vehicles ADD COLUMN model_year INTEGER DEFAULT NULL
    CHECK (model_year IS NULL OR (typeof(model_year) = 'integer' AND model_year BETWEEN 1 AND 9999));
ALTER TABLE vehicles ADD COLUMN powertrain TEXT DEFAULT NULL
    CHECK (powertrain IS NULL OR powertrain IN ('combustion','hybrid','battery_electric'));

CREATE TRIGGER vehicle_approved_class_required_insert
BEFORE INSERT ON vehicles WHEN NEW.status = 'approved' AND NEW.class IS NULL
BEGIN SELECT RAISE(ABORT, 'approved vehicle requires a system class'); END;
CREATE TRIGGER vehicle_approved_class_required_update
BEFORE UPDATE ON vehicles WHEN NEW.status = 'approved' AND NEW.class IS NULL
BEGIN SELECT RAISE(ABORT, 'approved vehicle requires a system class'); END;
