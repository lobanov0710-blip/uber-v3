-- New reviews invalidate admission; the dispatcher must replace an old assignment.
-- No existing vehicle, assignment or assessment is backfilled or reclassified.
CREATE TABLE vehicle_reverification_assignment_holds (
 assignment_id TEXT PRIMARY KEY NOT NULL REFERENCES order_assignments(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 assessment_id TEXT NOT NULL REFERENCES vehicle_trusted_assessments(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 created_at INTEGER NOT NULL CHECK(typeof(created_at)='integer' AND created_at>0)
);
CREATE TRIGGER vehicle_reverification_hold_no_update BEFORE UPDATE ON vehicle_reverification_assignment_holds
BEGIN SELECT RAISE(ABORT,'vehicle reverification hold is immutable'); END;
CREATE TRIGGER vehicle_reverification_hold_no_delete BEFORE DELETE ON vehicle_reverification_assignment_holds
BEGIN SELECT RAISE(ABORT,'vehicle reverification hold is immutable'); END;
CREATE TRIGGER vehicle_assessment_lost_trust AFTER INSERT ON vehicle_assessment_invalidations
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
