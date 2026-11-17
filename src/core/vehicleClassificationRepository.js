// Internal storage API; not an HTTP or driver-input boundary.
// The caller supplies year and powertrain verification from server moderation.
import { evaluateVehicleClassification } from './vehicleClassification.js';

function dbFor(env) {
  if (!env?.DB) throw new Error('Classification database unavailable');
  return env.DB;
}
function id(value) { return typeof value === 'string' && /^vehicle_[A-Za-z0-9_-]{8,100}$/.test(value); }
function positive(value) { return Number.isSafeInteger(value) && value > 0; }
function ruleFor(row) {
  if (row.rule_version === null) return null;
  return { make: row.make, model: row.model, version: row.rule_version,
    minYear: row.min_year, vehicleClass: row.rule_class };
}

/** Load vehicle data and its current rule in one database read. */
async function currentRule(DB, vehicleId) {
  return DB.prepare(`SELECT v.make, v.model, v.revision, h.rule_version,
      r.min_year, r.class AS rule_class
    FROM vehicles v
    LEFT JOIN vehicle_classification_current_rules h ON h.make = v.make AND h.model = v.model
    LEFT JOIN vehicle_classification_rules r ON r.version = h.rule_version AND r.make = v.make AND r.model = v.model
    WHERE v.id = ?1`).bind(vehicleId).first();
}

/**
 * Capture an immutable candidate for the current vehicle revision and CURRENT
 * rule. Existing snapshots never follow a later rule-head update. An explicit
 * vehicle-data change must create another vehicle revision before capture.
 * This operation does not approve a vehicle or grant line access.
 */
export async function captureCurrentVehicleClassification(env, input) {
  if (!input || !id(input.vehicleId) || !positive(input.expectedVehicleRevision) || !positive(input.now)) {
    return { ok: false, code: 'invalid_classification_input' };
  }
  const DB = dbFor(env);
  const row = await currentRule(DB, input.vehicleId);
  if (!row) return { ok: false, code: 'vehicle_not_found' };
  if (!positive(row.revision) || row.revision !== input.expectedVehicleRevision) {
    return { ok: false, code: 'vehicle_revision_conflict' };
  }
  const result = evaluateVehicleClassification({ make: row.make, model: row.model,
    year: input.year, powertrain: input.powertrain, powertrainVerified: input.powertrainVerified }, ruleFor(row));
  if (!result.ok) return { ok: false, code: result.error };
  const snapshotVersion = result.ruleVersion ?? null;
  const insert = DB.prepare(`INSERT INTO vehicle_classification_snapshots
    (vehicle_id, vehicle_revision, make, model, model_year, powertrain, powertrain_verified,
     rule_version, outcome, class, reason, created_at)
    SELECT v.id, v.revision, v.make, v.model, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12
    FROM vehicles v
    LEFT JOIN vehicle_classification_current_rules h ON h.make = v.make AND h.model = v.model
    WHERE v.id = ?1 AND v.revision = ?2 AND v.make = ?3 AND v.model = ?4
      AND h.rule_version IS ?13
    ON CONFLICT (vehicle_id, vehicle_revision) DO NOTHING`).bind(
    input.vehicleId, input.expectedVehicleRevision, row.make, row.model, input.year,
    input.powertrain, input.powertrainVerified === true ? 1 : 0, snapshotVersion,
    result.outcome, result.vehicleClass ?? null, result.reason ?? null, input.now, row.rule_version);
  const saved = await insert.run();
  if (saved?.success !== true || !Number.isSafeInteger(saved?.meta?.changes) || saved.meta.changes < 0 || saved.meta.changes > 1) {
    throw new Error('Classification write failed');
  }
  if (saved.meta.changes !== 1) return { ok: false, code: 'classification_snapshot_conflict' };
  return { ...result, vehicleRevision: row.revision };
}

/** Internal historical read; permission and ownership belong to the caller. */
export async function getVehicleClassificationSnapshot(env, vehicleId, revision) {
  if (!id(vehicleId) || !positive(revision)) throw new Error('Invalid classification identity');
  const row = await dbFor(env).prepare(`SELECT vehicle_id, vehicle_revision, model_year,
    powertrain, powertrain_verified, rule_version, outcome, class, reason, created_at
    FROM vehicle_classification_snapshots WHERE vehicle_id = ?1 AND vehicle_revision = ?2`)
    .bind(vehicleId, revision).first();
  if (!row) return null;
  return { vehicleId: row.vehicle_id, vehicleRevision: row.vehicle_revision, year: row.model_year,
    powertrain: row.powertrain, powertrainVerified: row.powertrain_verified === 1,
    ruleVersion: row.rule_version, outcome: row.outcome, vehicleClass: row.class,
    reason: row.reason, createdAt: row.created_at };
}
