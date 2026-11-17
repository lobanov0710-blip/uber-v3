-- Version storage only. No rules seeded and no existing vehicle reclassified.
CREATE TABLE vehicle_classification_rules (
    version TEXT PRIMARY KEY NOT NULL CHECK (length(version) BETWEEN 1 AND 128),
    make TEXT NOT NULL CHECK (length(make) BETWEEN 1 AND 80),
    model TEXT NOT NULL CHECK (length(model) BETWEEN 1 AND 80),
    revision INTEGER NOT NULL CHECK (typeof(revision) = 'integer' AND revision BETWEEN 1 AND 9007199254740991),
    min_year INTEGER NOT NULL CHECK (typeof(min_year) = 'integer' AND min_year BETWEEN 1 AND 9999),
    class TEXT NOT NULL CHECK (class IN ('comfort','business','minivan')),
    notes TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL CHECK (typeof(created_at) = 'integer' AND created_at BETWEEN 1 AND 9007199254740991),
    UNIQUE (make, model, revision),
    UNIQUE (make, model, version)
);

CREATE TABLE vehicle_classification_current_rules (
    make TEXT NOT NULL,
    model TEXT NOT NULL,
    rule_version TEXT NOT NULL,
    PRIMARY KEY (make, model),
    FOREIGN KEY (make, model, rule_version)
      REFERENCES vehicle_classification_rules(make, model, version)
      ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE TABLE vehicle_classification_snapshots (
    vehicle_id TEXT NOT NULL,
    vehicle_revision INTEGER NOT NULL CHECK (typeof(vehicle_revision) = 'integer' AND vehicle_revision BETWEEN 1 AND 9007199254740991),
    make TEXT NOT NULL,
    model TEXT NOT NULL,
    model_year INTEGER NOT NULL CHECK (typeof(model_year) = 'integer' AND model_year BETWEEN 1 AND 9999),
    powertrain TEXT NOT NULL CHECK (powertrain IN ('combustion','hybrid','battery_electric')),
    powertrain_verified INTEGER NOT NULL CHECK (powertrain_verified IN (0,1)),
    rule_version TEXT DEFAULT NULL,
    outcome TEXT NOT NULL CHECK (outcome IN ('candidate','manual_review','excluded')),
    class TEXT DEFAULT NULL CHECK (class IS NULL OR class IN ('comfort','business','minivan')),
    reason TEXT DEFAULT NULL,
    created_at INTEGER NOT NULL CHECK (typeof(created_at) = 'integer' AND created_at BETWEEN 1 AND 9007199254740991),
    PRIMARY KEY (vehicle_id, vehicle_revision),
    FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    FOREIGN KEY (make, model, rule_version)
      REFERENCES vehicle_classification_rules(make, model, version)
      ON UPDATE RESTRICT ON DELETE RESTRICT,
    CHECK (
      (outcome = 'candidate' AND class IS NOT NULL AND rule_version IS NOT NULL AND reason IS NULL AND powertrain_verified = 1 AND powertrain <> 'battery_electric')
      OR (outcome = 'manual_review' AND class IS NULL AND reason IS NOT NULL AND (
        (reason = 'model_not_found' AND rule_version IS NULL)
        OR (reason = 'year_below_minimum' AND rule_version IS NOT NULL AND powertrain_verified = 1)
        OR (reason = 'powertrain_unverified' AND rule_version IS NULL AND powertrain_verified = 0)
      ))
      OR (outcome = 'excluded' AND class IS NULL AND reason IS NOT NULL AND reason = 'battery_electric' AND powertrain = 'battery_electric')
    )
);

CREATE TRIGGER vehicle_classification_rule_no_update
BEFORE UPDATE ON vehicle_classification_rules
BEGIN SELECT RAISE(ABORT, 'classification rule versions are immutable'); END;
CREATE TRIGGER vehicle_classification_rule_no_delete
BEFORE DELETE ON vehicle_classification_rules
BEGIN SELECT RAISE(ABORT, 'classification rule versions are immutable'); END;
CREATE TRIGGER vehicle_classification_snapshot_no_update
BEFORE UPDATE ON vehicle_classification_snapshots
BEGIN SELECT RAISE(ABORT, 'classification snapshots are immutable'); END;

CREATE TRIGGER vehicle_classification_candidate_matches_rule
BEFORE INSERT ON vehicle_classification_snapshots
WHEN NEW.outcome = 'candidate' AND NOT EXISTS (
    SELECT 1 FROM vehicle_classification_rules r
    WHERE r.version = NEW.rule_version AND r.make = NEW.make AND r.model = NEW.model
      AND r.class = NEW.class AND r.min_year <= NEW.model_year
)
BEGIN SELECT RAISE(ABORT, 'classification candidate does not match rule'); END;
CREATE TRIGGER vehicle_classification_snapshot_no_delete
BEFORE DELETE ON vehicle_classification_snapshots
BEGIN SELECT RAISE(ABORT, 'classification snapshots are immutable'); END;
