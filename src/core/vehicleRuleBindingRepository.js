// Internal metadata only. HTTP callers must authenticate; driver reads are owner-bound.
// A pinned version (including null/model-not-found) is not trusted classification.
export async function getCurrentVehicleRuleBinding(env, driverId, vehicleId) {
  if (!env?.DB || typeof driverId !== 'string' || !/^staff_[A-Za-z0-9_-]{8,94}$/.test(driverId)
      || typeof vehicleId !== 'string' || !/^vehicle_[A-Za-z0-9_-]{8,100}$/.test(vehicleId)) {
    throw new Error('Invalid vehicle binding identity');
  }
  const row = await env.DB.prepare(`SELECT b.* FROM vehicle_classification_bindings b
    JOIN vehicles v ON v.id=b.vehicle_id AND v.driver_id=?1
    WHERE b.vehicle_id=?2 ORDER BY b.input_revision DESC LIMIT 1`)
    .bind(driverId,vehicleId).first();
  return row ? {vehicleId:row.vehicle_id,inputRevision:row.input_revision,
    sourceVehicleRevision:row.source_vehicle_revision,make:row.make,model:row.model,
    modelYear:row.model_year,ruleVersion:row.rule_version,createdAt:row.created_at} : null;
}
