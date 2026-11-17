-- Immutable definitions for newly authored versions. No catalog/model rules seeded.
CREATE TABLE vehicle_classification_rule_definitions (
    rule_version TEXT PRIMARY KEY NOT NULL REFERENCES vehicle_classification_rules(version) ON UPDATE RESTRICT ON DELETE RESTRICT,
    allowed_body_types TEXT CHECK (allowed_body_types IS NULL OR (json_valid(allowed_body_types) AND json_type(allowed_body_types)='array' AND json_array_length(allowed_body_types) BETWEEN 1 AND 4)),
    conditions_json TEXT NOT NULL CHECK (json_valid(conditions_json) AND json_type(conditions_json)='array' AND json_array_length(conditions_json) BETWEEN 0 AND 32),
    created_by TEXT NOT NULL REFERENCES staff_accounts(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 1000),
    created_at INTEGER NOT NULL CHECK (typeof(created_at)='integer' AND created_at BETWEEN 1 AND 9007199254740991)
);
CREATE TRIGGER vehicle_rule_definition_validate
BEFORE INSERT ON vehicle_classification_rule_definitions
WHEN EXISTS (SELECT 1 FROM json_each(NEW.conditions_json) WHERE type<>'text' OR length(value) NOT BETWEEN 1 AND 1000)
 OR (SELECT count(*) FROM json_each(NEW.conditions_json))<>(SELECT count(DISTINCT value) FROM json_each(NEW.conditions_json))
 OR EXISTS (SELECT 1 FROM json_each(NEW.allowed_body_types) WHERE type<>'text' OR value NOT IN ('sedan','crossover','minivan','other'))
 OR (SELECT count(*) FROM json_each(NEW.allowed_body_types))<>(SELECT count(DISTINCT value) FROM json_each(NEW.allowed_body_types))
 OR EXISTS (SELECT 1 FROM vehicle_classification_rules r WHERE r.version=NEW.rule_version AND (
   (r.class='comfort' AND (NEW.allowed_body_types IS NULL OR EXISTS (SELECT 1 FROM json_each(NEW.allowed_body_types) WHERE value NOT IN ('sedan','crossover'))))
   OR (r.class='business' AND (NEW.allowed_body_types IS NULL OR EXISTS (SELECT 1 FROM json_each(NEW.allowed_body_types)
     WHERE value<>CASE WHEN r.make='Li Auto' AND r.model IN ('L7','L9') THEN 'crossover' ELSE 'sedan' END)))
 ))
BEGIN SELECT RAISE(ABORT,'invalid vehicle rule definition'); END;
CREATE TRIGGER vehicle_rule_definition_no_update
BEFORE UPDATE ON vehicle_classification_rule_definitions
BEGIN SELECT RAISE(ABORT,'vehicle rule definition is immutable'); END;
CREATE TRIGGER vehicle_rule_definition_no_delete
BEFORE DELETE ON vehicle_classification_rule_definitions
BEGIN SELECT RAISE(ABORT,'vehicle rule definition is immutable'); END;
