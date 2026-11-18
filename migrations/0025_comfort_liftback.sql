-- OWNER approval 2026-11-18: liftback only in comfort. No seed or admission.
-- Rebuild the complete three-table immutable history graph atomically with FK ON.
-- Copy exact values and rowids; never revalidate old evidence or reclassify cars.
-- D1 must execute this file transactionally. No foreign-key/check disabling.
DROP VIEW vehicle_current_trusted_assessments;
DROP TRIGGER assessment_vehicle_changed;
DROP TRIGGER assessment_evidence_changed;
DROP TRIGGER assessment_evidence_deleted;
DROP TRIGGER vehicle_rule_definition_validate;


CREATE TABLE vehicle_trusted_assessments_liftback_migration (
 id TEXT PRIMARY KEY NOT NULL CHECK(length(id) BETWEEN 8 AND 100),
 vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 sequence INTEGER NOT NULL CHECK(typeof(sequence)='integer' AND sequence BETWEEN 1 AND 9007199254740991),
 vehicle_revision INTEGER NOT NULL CHECK(typeof(vehicle_revision)='integer' AND vehicle_revision BETWEEN 1 AND 9007199254740991),
 input_revision INTEGER NOT NULL,
 pinned_rule_version TEXT REFERENCES vehicle_classification_rules(version) ON UPDATE RESTRICT ON DELETE RESTRICT,
 rule_version TEXT REFERENCES vehicle_classification_rules(version) ON UPDATE RESTRICT ON DELETE RESTRICT,
 make TEXT NOT NULL,
 model TEXT NOT NULL,
 model_year INTEGER NOT NULL CHECK(typeof(model_year)='integer' AND model_year BETWEEN 1 AND 9999),
 declared_powertrain TEXT,
 powertrain TEXT NOT NULL CHECK(powertrain IN ('combustion','hybrid','battery_electric')),
 body_type TEXT NOT NULL CHECK(body_type IN ('sedan','crossover','liftback','minivan','other')),
 mode TEXT NOT NULL CHECK(mode IN ('standard','exception')),
 exception_json TEXT CHECK(exception_json IS NULL OR (json_valid(exception_json) AND json_type(exception_json)='object')),
 evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json) AND json_type(evidence_json)='array' AND json_array_length(evidence_json) BETWEEN 2 AND 8),
 conditions_json TEXT NOT NULL CHECK(json_valid(conditions_json) AND json_type(conditions_json)='array' AND json_array_length(conditions_json) BETWEEN 0 AND 32),
 outcome TEXT NOT NULL CHECK(outcome IN ('candidate','manual_review','excluded')),
 class TEXT CHECK(class IS NULL OR class IN ('comfort','business','minivan')),
 reason_codes_json TEXT NOT NULL CHECK(json_valid(reason_codes_json) AND json_type(reason_codes_json)='array'),
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 1000),
 actor_account_id TEXT NOT NULL REFERENCES staff_accounts(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 audit_event_id TEXT NOT NULL UNIQUE REFERENCES audit_events(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 created_at INTEGER NOT NULL CHECK(typeof(created_at)='integer' AND created_at BETWEEN 1 AND 9007199254740991),
 UNIQUE(vehicle_id,sequence),
 FOREIGN KEY(vehicle_id,input_revision) REFERENCES vehicle_classification_bindings(vehicle_id,input_revision) ON UPDATE RESTRICT ON DELETE RESTRICT,
 CHECK((mode='standard' AND exception_json IS NULL AND rule_version IS pinned_rule_version) OR (mode='exception' AND exception_json IS NOT NULL AND rule_version IS NOT NULL)),
 CHECK((outcome='candidate' AND class IS NOT NULL AND rule_version IS NOT NULL AND powertrain<>'battery_electric' AND json_array_length(reason_codes_json)=0)
   OR (outcome<>'candidate' AND class IS NULL AND json_array_length(reason_codes_json)>0)),
 CHECK(powertrain<>'battery_electric' OR outcome='excluded')
);

CREATE TABLE vehicle_assessment_invalidations_liftback_migration (
 assessment_id TEXT PRIMARY KEY NOT NULL REFERENCES vehicle_trusted_assessments_liftback_migration(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 reason_code TEXT NOT NULL CHECK(reason_code IN ('vehicle_parameters_changed','evidence_changed','evidence_deleted')),
 created_at INTEGER NOT NULL CHECK(typeof(created_at)='integer' AND created_at>0)
);

CREATE TABLE vehicle_reverification_assignment_holds_liftback_migration (
 assignment_id TEXT PRIMARY KEY NOT NULL REFERENCES order_assignments(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 assessment_id TEXT NOT NULL REFERENCES vehicle_trusted_assessments_liftback_migration(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 created_at INTEGER NOT NULL CHECK(typeof(created_at)='integer' AND created_at>0)
);

INSERT INTO vehicle_trusted_assessments_liftback_migration(rowid,id,vehicle_id,sequence,vehicle_revision,input_revision,pinned_rule_version,rule_version,make,model,model_year,declared_powertrain,powertrain,body_type,mode,exception_json,evidence_json,conditions_json,outcome,class,reason_codes_json,reason,actor_account_id,audit_event_id,created_at) SELECT rowid,id,vehicle_id,sequence,vehicle_revision,input_revision,pinned_rule_version,rule_version,make,model,model_year,declared_powertrain,powertrain,body_type,mode,exception_json,evidence_json,conditions_json,outcome,class,reason_codes_json,reason,actor_account_id,audit_event_id,created_at FROM vehicle_trusted_assessments;

INSERT INTO vehicle_assessment_invalidations_liftback_migration(rowid,assessment_id,reason_code,created_at) SELECT rowid,assessment_id,reason_code,created_at FROM vehicle_assessment_invalidations;

INSERT INTO vehicle_reverification_assignment_holds_liftback_migration(rowid,assignment_id,vehicle_id,assessment_id,created_at) SELECT rowid,assignment_id,vehicle_id,assessment_id,created_at FROM vehicle_reverification_assignment_holds;

DROP TABLE vehicle_reverification_assignment_holds;

DROP TABLE vehicle_assessment_invalidations;

DROP TABLE vehicle_trusted_assessments;

ALTER TABLE vehicle_trusted_assessments_liftback_migration RENAME TO vehicle_trusted_assessments;

ALTER TABLE vehicle_assessment_invalidations_liftback_migration RENAME TO vehicle_assessment_invalidations;

ALTER TABLE vehicle_reverification_assignment_holds_liftback_migration RENAME TO vehicle_reverification_assignment_holds;

CREATE VIEW vehicle_current_trusted_assessments AS
SELECT a.* FROM vehicle_trusted_assessments a JOIN vehicles v ON v.id=a.vehicle_id
JOIN vehicle_classification_bindings b ON b.vehicle_id=v.id AND b.input_revision=a.input_revision
WHERE a.sequence=(SELECT MAX(sequence) FROM vehicle_trusted_assessments WHERE vehicle_id=a.vehicle_id)
AND b.input_revision=(SELECT MAX(input_revision) FROM vehicle_classification_bindings WHERE vehicle_id=v.id)
AND v.make=a.make AND v.model=a.model AND v.model_year=a.model_year AND v.powertrain IS a.declared_powertrain
AND NOT EXISTS(SELECT 1 FROM vehicle_assessment_invalidations i WHERE i.assessment_id=a.id)
AND NOT EXISTS(SELECT 1 FROM json_each(a.evidence_json) e WHERE NOT EXISTS(
 SELECT 1 FROM document_resources d WHERE d.id=json_extract(e.value,'$.documentId') AND d.revision=json_extract(e.value,'$.expectedRevision')
 AND d.vehicle_id=v.id AND d.owner_driver_id=v.driver_id AND d.status='verified' AND d.kind IN ('sts_front','sts_back')
 AND (d.expires_at IS NULL OR d.expires_at>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))));

CREATE TRIGGER vehicle_rule_definition_validate
BEFORE INSERT ON vehicle_classification_rule_definitions
WHEN EXISTS (SELECT 1 FROM json_each(NEW.conditions_json) WHERE type<>'text' OR length(value) NOT BETWEEN 1 AND 1000)
 OR (SELECT count(*) FROM json_each(NEW.conditions_json))<>(SELECT count(DISTINCT value) FROM json_each(NEW.conditions_json))
 OR EXISTS (SELECT 1 FROM json_each(NEW.allowed_body_types) WHERE type<>'text' OR value NOT IN ('sedan','crossover','liftback','minivan','other'))
 OR (SELECT count(*) FROM json_each(NEW.allowed_body_types))<>(SELECT count(DISTINCT value) FROM json_each(NEW.allowed_body_types))
 OR (NEW.allowed_body_types IS NOT NULL AND EXISTS(SELECT 1 FROM json_each(NEW.allowed_body_types) WHERE value='liftback')
   AND NOT EXISTS(SELECT 1 FROM vehicle_classification_rules WHERE version=NEW.rule_version AND class='comfort'))
 OR EXISTS (SELECT 1 FROM vehicle_classification_rules r WHERE r.version=NEW.rule_version AND (
   (r.class='comfort' AND (NEW.allowed_body_types IS NULL OR EXISTS (SELECT 1 FROM json_each(NEW.allowed_body_types) WHERE value NOT IN ('sedan','crossover','liftback'))))
   OR (r.class='business' AND (NEW.allowed_body_types IS NULL OR EXISTS (SELECT 1 FROM json_each(NEW.allowed_body_types)
     WHERE value<>CASE WHEN r.make='Li Auto' AND r.model IN ('L7','L9') THEN 'crossover' ELSE 'sedan' END)))
 ))
BEGIN SELECT RAISE(ABORT,'invalid vehicle rule definition'); END;

CREATE TRIGGER trusted_assessment_validate
BEFORE INSERT ON vehicle_trusted_assessments
WHEN NOT EXISTS (
 SELECT 1 FROM vehicles v JOIN vehicle_classification_bindings b ON b.vehicle_id=v.id
 WHERE v.id=NEW.vehicle_id AND v.revision=NEW.vehicle_revision AND v.make=NEW.make AND v.model=NEW.model
 AND v.model_year=NEW.model_year AND v.powertrain IS NEW.declared_powertrain
 AND b.input_revision=NEW.input_revision AND b.input_revision=(SELECT MAX(input_revision) FROM vehicle_classification_bindings WHERE vehicle_id=v.id)
 AND b.rule_version IS NEW.pinned_rule_version
 AND NEW.sequence=COALESCE((SELECT MAX(sequence) FROM vehicle_trusted_assessments WHERE vehicle_id=v.id),0)+1
 AND EXISTS(SELECT 1 FROM audit_events e WHERE e.id=NEW.audit_event_id AND e.actor_account_id=NEW.actor_account_id
   AND e.action='admin.vehicle_assessment_recorded' AND e.target_id=v.id AND e.outcome='success')
 AND EXISTS(SELECT 1 FROM staff_accounts sa WHERE sa.id=NEW.actor_account_id AND sa.role='admin' AND sa.status='active'
   AND (EXISTS(SELECT 1 FROM staff_owner_binding o WHERE o.account_id=sa.id AND o.singleton=1)
     OR (NEW.mode='standard' AND EXISTS(SELECT 1 FROM staff_permissions p WHERE p.account_id=sa.id AND lower(trim(p.permission))='vehicles.verify'))))
 AND NOT EXISTS(SELECT 1 FROM json_each(NEW.evidence_json) e WHERE NOT EXISTS(
   SELECT 1 FROM document_resources d WHERE d.id=json_extract(e.value,'$.documentId')
   AND d.revision=json_extract(e.value,'$.expectedRevision') AND d.owner_driver_id=v.driver_id AND d.vehicle_id=v.id
   AND d.kind IN ('sts_front','sts_back') AND d.status='verified'
   AND (d.expires_at IS NULL OR d.expires_at>NEW.created_at)))
 AND 2=(SELECT count(DISTINCT d.kind) FROM document_resources d JOIN json_each(NEW.evidence_json) e ON d.id=json_extract(e.value,'$.documentId') WHERE d.kind IN ('sts_front','sts_back'))
 AND json_array_length(NEW.evidence_json)=(SELECT count(DISTINCT json_extract(value,'$.documentId')) FROM json_each(NEW.evidence_json))
)
OR (NEW.rule_version IS NOT NULL AND NOT EXISTS(SELECT 1 FROM vehicle_classification_rules r WHERE r.version=NEW.rule_version AND r.make=NEW.make AND (NEW.mode='exception' OR r.model=NEW.model)))
OR (NEW.mode='exception' AND json_extract(NEW.exception_json,'$.basisRuleVersion') IS NOT NEW.rule_version)
OR json_array_length(NEW.conditions_json)<>(SELECT count(DISTINCT json_extract(value,'$.conditionId')) FROM json_each(NEW.conditions_json))
OR EXISTS(SELECT 1 FROM json_each(NEW.conditions_json) checked WHERE json_extract(checked.value,'$.result') NOT IN ('satisfied','unmet')
 OR NOT EXISTS(SELECT 1 FROM vehicle_classification_rules r LEFT JOIN vehicle_classification_rule_definitions d ON d.rule_version=r.version,
   json_each(COALESCE(d.conditions_json,CASE WHEN r.notes='' THEN '[]' ELSE json_array(r.notes) END)) c
   WHERE r.version=NEW.rule_version AND json_extract(checked.value,'$.conditionId')=r.version||':'||(c.key+1)))
OR (NEW.mode='exception' AND (json_type(NEW.exception_json,'$.yearBelowMinimum') NOT IN ('true','false')
 OR json_type(NEW.exception_json,'$.waivedConditionIds')<>'array'
 OR json_array_length(NEW.exception_json,'$.waivedConditionIds')<>(SELECT count(DISTINCT value) FROM json_each(NEW.exception_json,'$.waivedConditionIds'))
 OR EXISTS(SELECT 1 FROM json_each(NEW.exception_json,'$.waivedConditionIds') w WHERE NOT EXISTS(
   SELECT 1 FROM json_each(NEW.conditions_json) checked WHERE json_extract(checked.value,'$.conditionId')=w.value AND json_extract(checked.value,'$.result')='unmet'))))
OR (NEW.outcome='candidate' AND NOT EXISTS(
 SELECT 1 FROM vehicle_classification_rules r LEFT JOIN vehicle_classification_rule_definitions d ON d.rule_version=r.version
 WHERE r.version=NEW.rule_version AND r.class=NEW.class
 AND (r.min_year<=NEW.model_year OR (NEW.mode='exception' AND json_extract(NEW.exception_json,'$.yearBelowMinimum')=1))
 AND (NEW.body_type<>'liftback' OR (r.class='comfort' AND EXISTS(
   SELECT 1 FROM json_each(d.allowed_body_types) WHERE value='liftback')))
 AND (r.class<>'comfort' OR NEW.body_type IN ('sedan','crossover','liftback'))
 AND (r.class<>'business' OR NEW.body_type=CASE WHEN NEW.make='Li Auto' AND NEW.model IN ('L7','L9') THEN 'crossover' ELSE 'sedan' END)
 AND (d.allowed_body_types IS NULL OR EXISTS(SELECT 1 FROM json_each(d.allowed_body_types) WHERE value=NEW.body_type))
 AND NOT EXISTS(SELECT 1 FROM json_each(COALESCE(d.conditions_json,CASE WHEN r.notes='' THEN '[]' ELSE json_array(r.notes) END)) c
   WHERE NOT EXISTS(SELECT 1 FROM json_each(NEW.conditions_json) checked WHERE json_extract(checked.value,'$.conditionId')=r.version||':'||(c.key+1)
     AND (json_extract(checked.value,'$.result')='satisfied' OR (NEW.mode='exception' AND json_extract(checked.value,'$.result')='unmet'
       AND EXISTS(SELECT 1 FROM json_each(NEW.exception_json,'$.waivedConditionIds') w WHERE w.value=json_extract(checked.value,'$.conditionId'))))))
))
BEGIN SELECT RAISE(ABORT,'invalid trusted vehicle assessment'); END;

CREATE TRIGGER trusted_assessment_no_update BEFORE UPDATE ON vehicle_trusted_assessments
BEGIN SELECT RAISE(ABORT,'trusted assessment is immutable'); END;

CREATE TRIGGER trusted_assessment_no_delete BEFORE DELETE ON vehicle_trusted_assessments
BEGIN SELECT RAISE(ABORT,'trusted assessment is immutable'); END;

CREATE TRIGGER assessment_invalidation_no_update BEFORE UPDATE ON vehicle_assessment_invalidations
BEGIN SELECT RAISE(ABORT,'assessment invalidation is immutable'); END;

CREATE TRIGGER assessment_invalidation_no_delete BEFORE DELETE ON vehicle_assessment_invalidations
BEGIN SELECT RAISE(ABORT,'assessment invalidation is immutable'); END;

CREATE TRIGGER assessment_vehicle_changed AFTER UPDATE OF driver_id,vin,plate,make,model,model_year,powertrain ON vehicles
WHEN OLD.driver_id IS NOT NEW.driver_id OR OLD.vin IS NOT NEW.vin OR OLD.plate IS NOT NEW.plate OR OLD.make IS NOT NEW.make
 OR OLD.model IS NOT NEW.model OR OLD.model_year IS NOT NEW.model_year OR OLD.powertrain IS NOT NEW.powertrain
BEGIN
 INSERT INTO vehicle_assessment_invalidations SELECT id,'vehicle_parameters_changed',CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)
 FROM vehicle_trusted_assessments WHERE vehicle_id=NEW.id ON CONFLICT(assessment_id) DO NOTHING;
END;

CREATE TRIGGER assessment_evidence_changed AFTER UPDATE OF owner_driver_id,vehicle_id,kind,status,revision,private_object_key,expires_at ON document_resources
WHEN OLD.owner_driver_id IS NOT NEW.owner_driver_id OR OLD.vehicle_id IS NOT NEW.vehicle_id OR OLD.kind IS NOT NEW.kind
 OR OLD.status IS NOT NEW.status OR OLD.revision IS NOT NEW.revision OR OLD.private_object_key IS NOT NEW.private_object_key OR OLD.expires_at IS NOT NEW.expires_at
BEGIN
 INSERT INTO vehicle_assessment_invalidations SELECT a.id,'evidence_changed',CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)
 FROM vehicle_trusted_assessments a WHERE EXISTS(SELECT 1 FROM json_each(a.evidence_json) e WHERE json_extract(e.value,'$.documentId')=OLD.id)
 ON CONFLICT(assessment_id) DO NOTHING;
END;

CREATE TRIGGER assessment_evidence_deleted BEFORE DELETE ON document_resources
BEGIN
 INSERT INTO vehicle_assessment_invalidations SELECT a.id,'evidence_deleted',CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)
 FROM vehicle_trusted_assessments a WHERE EXISTS(SELECT 1 FROM json_each(a.evidence_json) e WHERE json_extract(e.value,'$.documentId')=OLD.id)
 ON CONFLICT(assessment_id) DO NOTHING;
END;

CREATE TRIGGER vehicle_reverification_hold_no_update BEFORE UPDATE ON vehicle_reverification_assignment_holds
BEGIN SELECT RAISE(ABORT,'vehicle reverification hold is immutable'); END;

CREATE TRIGGER vehicle_reverification_hold_no_delete BEFORE DELETE ON vehicle_reverification_assignment_holds
BEGIN SELECT RAISE(ABORT,'vehicle reverification hold is immutable'); END;

CREATE TRIGGER vehicle_assessment_lost_trust AFTER INSERT ON vehicle_assessment_invalidations
WHEN EXISTS(SELECT 1 FROM vehicle_trusted_assessments t WHERE t.id=NEW.assessment_id
 AND t.sequence=(SELECT MAX(sequence) FROM vehicle_trusted_assessments WHERE vehicle_id=t.vehicle_id))
BEGIN
 INSERT INTO vehicle_reverification_assignment_holds(assignment_id,vehicle_id,assessment_id,created_at)
 SELECT a.id,a.vehicle_id,NEW.assessment_id,NEW.created_at FROM order_assignments a
 JOIN vehicle_trusted_assessments t ON t.vehicle_id=a.vehicle_id AND t.id=NEW.assessment_id
 WHERE a.state='active' AND a.revoked_at IS NULL ON CONFLICT(assignment_id) DO NOTHING;
 UPDATE vehicles SET class=NULL,status=CASE WHEN status IN ('approved','photo_check_required') THEN 'pending_review' ELSE status END,
   revision=revision+1,updated_at=MAX(updated_at,NEW.created_at)
 WHERE id=(SELECT vehicle_id FROM vehicle_trusted_assessments WHERE id=NEW.assessment_id)
   AND (class IS NOT NULL OR status IN ('approved','photo_check_required'));
 UPDATE driver_availability SET state='off_line',revision=revision+1,updated_at=MAX(updated_at,NEW.created_at)
 WHERE active_vehicle_id=(SELECT vehicle_id FROM vehicle_trusted_assessments WHERE id=NEW.assessment_id) AND state<>'off_line';
END;
