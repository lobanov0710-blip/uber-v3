-- Pin only the rule identity, never a class, approval or trusted evidence.
-- Existing vehicles are deliberately not backfilled with invented history.
CREATE TABLE vehicle_classification_bindings (
    vehicle_id TEXT NOT NULL,
    input_revision INTEGER NOT NULL CHECK (typeof(input_revision)='integer' AND input_revision BETWEEN 1 AND 9007199254740991),
    source_vehicle_revision INTEGER NOT NULL CHECK (typeof(source_vehicle_revision)='integer' AND source_vehicle_revision BETWEEN 1 AND 9007199254740991),
    make TEXT NOT NULL CHECK (length(make) BETWEEN 1 AND 80),
    model TEXT NOT NULL CHECK (length(model) BETWEEN 1 AND 80),
    model_year INTEGER CHECK (model_year IS NULL OR (typeof(model_year)='integer' AND model_year BETWEEN 1 AND 9999)),
    rule_version TEXT,
    created_at INTEGER NOT NULL CHECK (typeof(created_at)='integer' AND created_at BETWEEN 1 AND 9007199254740991),
    PRIMARY KEY (vehicle_id,input_revision),
    FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    FOREIGN KEY (make,model,rule_version) REFERENCES vehicle_classification_rules(make,model,version) ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE TRIGGER vehicle_rule_binding_on_create
AFTER INSERT ON vehicles
BEGIN
    INSERT INTO vehicle_classification_bindings
      (vehicle_id,input_revision,source_vehicle_revision,make,model,model_year,rule_version,created_at)
    SELECT NEW.id,1,NEW.revision,NEW.make,NEW.model,NEW.model_year,h.rule_version,NEW.updated_at
    FROM (SELECT 1) AS seed
    LEFT JOIN vehicle_classification_current_rules h ON h.make=NEW.make AND h.model=NEW.model;
END;

CREATE TRIGGER vehicle_rule_binding_on_input_change
AFTER UPDATE OF make,model,model_year ON vehicles
WHEN OLD.make IS NOT NEW.make OR OLD.model IS NOT NEW.model OR OLD.model_year IS NOT NEW.model_year
BEGIN
    INSERT INTO vehicle_classification_bindings
      (vehicle_id,input_revision,source_vehicle_revision,make,model,model_year,rule_version,created_at)
    SELECT NEW.id,
      COALESCE((SELECT MAX(input_revision) FROM vehicle_classification_bindings WHERE vehicle_id=NEW.id),0)+1,
      NEW.revision,NEW.make,NEW.model,NEW.model_year,h.rule_version,NEW.updated_at
    FROM (SELECT 1) AS seed
    LEFT JOIN vehicle_classification_current_rules h ON h.make=NEW.make AND h.model=NEW.model;
END;

CREATE TRIGGER vehicle_rule_binding_no_update
BEFORE UPDATE ON vehicle_classification_bindings
BEGIN SELECT RAISE(ABORT,'vehicle rule binding is immutable'); END;
CREATE TRIGGER vehicle_rule_binding_no_delete
BEFORE DELETE ON vehicle_classification_bindings
BEGIN SELECT RAISE(ABORT,'vehicle rule binding is immutable'); END;

-- No dispatcher grant, even with whitespace/case variants of the permission.
-- Existing erroneous rows are retained as history but ignored by authorization.
CREATE TRIGGER classifier_permissions_owner_only_insert
BEFORE INSERT ON staff_permissions
WHEN lower(trim(NEW.permission,char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279))) IN ('vehicle_rules.manage','vehicles.approve_exception')
 AND NOT EXISTS (SELECT 1 FROM staff_owner_binding o JOIN staff_accounts a ON a.id=o.account_id
   WHERE o.singleton=1 AND o.account_id=NEW.account_id AND a.role='admin' AND a.status='active')
BEGIN SELECT RAISE(ABORT,'classifier permission requires owner'); END;

CREATE TRIGGER classifier_permissions_owner_only_update
BEFORE UPDATE ON staff_permissions
WHEN lower(trim(NEW.permission,char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279))) IN ('vehicle_rules.manage','vehicles.approve_exception')
 AND NOT EXISTS (SELECT 1 FROM staff_owner_binding o JOIN staff_accounts a ON a.id=o.account_id
   WHERE o.singleton=1 AND o.account_id=NEW.account_id AND a.role='admin' AND a.status='active')
BEGIN SELECT RAISE(ABORT,'classifier permission requires owner'); END;
