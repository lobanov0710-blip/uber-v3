WITH vehicle_source AS (SELECT id,make,model,color,class,status,model_year,powertrain FROM vehicles), latest_bindings AS (SELECT NULL AS vehicle_id,NULL AS rule_version,NULL AS make,NULL AS model,NULL AS model_year WHERE 0),
assessment_history AS (SELECT NULL AS vehicle_id WHERE 0), current_trusted AS (SELECT NULL AS vehicle_id,NULL AS outcome,NULL AS class WHERE 0), holds AS (SELECT NULL AS assignment_id WHERE 0), facts AS (
 SELECT v.id,v.model_year,v.powertrain,v.color,v.class,v.status,
 b.vehicle_id AS bound_id, b.rule_version,
 b.make IS v.make AND b.model IS v.model AND b.model_year IS v.model_year AS binding_matches,
 t.outcome AS trusted_outcome, t.class AS trusted_class
 FROM vehicle_source v LEFT JOIN latest_bindings b ON b.vehicle_id=v.id
 LEFT JOIN current_trusted t ON t.vehicle_id=v.id
), active_assignments AS (
 SELECT a.id,a.vehicle_id,h.assignment_id AS hold_id
 FROM order_assignments a LEFT JOIN holds h ON h.assignment_id=a.id
 WHERE a.state='active' AND a.revoked_at IS NULL
)
SELECT COUNT(*) AS vehicles,
 COUNT(CASE WHEN model_year IS NULL THEN 1 END) AS missing_year,
 COUNT(CASE WHEN color IS NULL OR trim(color,char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279))='' THEN 1 END) AS missing_color,
 COUNT(CASE WHEN bound_id IS NULL THEN 1 END) AS missing_binding,
 COUNT(CASE WHEN bound_id IS NOT NULL AND NOT binding_matches THEN 1 END) AS binding_input_mismatch,
 COUNT(CASE WHEN bound_id IS NOT NULL AND rule_version IS NULL THEN 1 END) AS binding_without_rule,
 COUNT(CASE WHEN NOT EXISTS(SELECT 1 FROM assessment_history a WHERE a.vehicle_id=facts.id) THEN 1 END) AS never_assessed,
 COUNT(CASE WHEN trusted_outcome IS NULL THEN 1 END) AS without_current_trusted_assessment,
 COUNT(CASE WHEN trusted_outcome='candidate' THEN 1 END) AS current_candidate,
 COUNT(CASE WHEN trusted_outcome='manual_review' THEN 1 END) AS current_manual_review,
 COUNT(CASE WHEN trusted_outcome='excluded' THEN 1 END) AS current_excluded,
 COUNT(CASE WHEN powertrain='battery_electric' THEN 1 END) AS declared_battery_electric,
 COUNT(CASE WHEN status='approved' AND (trusted_outcome IS NOT 'candidate' OR class IS NOT trusted_class) THEN 1 END) AS approved_without_matching_candidate,
 (SELECT COUNT(*) FROM driver_availability WHERE state='on_line') AS online_drivers,
 (SELECT COUNT(*) FROM driver_availability d LEFT JOIN facts f ON f.id=d.active_vehicle_id
  WHERE d.state='on_line' AND (f.trusted_outcome IS NOT 'candidate' OR f.class IS NOT f.trusted_class)) AS online_without_matching_candidate,
 (SELECT COUNT(*) FROM active_assignments) AS active_assignments,
 (SELECT COUNT(*) FROM active_assignments WHERE hold_id IS NOT NULL) AS active_assignments_with_hold,
 (SELECT COUNT(*) FROM active_assignments a LEFT JOIN facts f ON f.id=a.vehicle_id
  WHERE f.trusted_outcome IS NOT 'candidate' OR f.class IS NOT f.trusted_class) AS active_assignments_without_matching_candidate
FROM facts;
