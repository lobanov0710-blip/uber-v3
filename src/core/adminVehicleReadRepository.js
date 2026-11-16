// Operational metadata only. No VIN, contact, free text, photos or storage keys.
export async function listAdminVehicleRows(env, { status, after, limit }) {
  const result = await env.DB.prepare(`
    SELECT id,driver_id,make,model,plate,status,revision,
      last_photo_check_passed_at,next_photo_check_due_at FROM vehicles
    WHERE (?1='' OR status=?1) AND id>?2 ORDER BY id ASC LIMIT ?3
  `).bind(status,after,limit+1).all();
  if (result?.success !== true || !Array.isArray(result.results)) throw new Error('Vehicle read failed');
  return result.results;
}

export async function listAdminPhotoCheckRows(env, { vehicleId, after, limit }) {
  // One read transaction binds the vehicle revision to its check-page snapshot.
  const results = await env.DB.batch([
    env.DB.prepare('SELECT id,revision FROM vehicles WHERE id=?1').bind(vehicleId),
    env.DB.prepare(`SELECT id,vehicle_id,kind,restriction_mode,result,revision,
      due_at,grace_until,created_at,updated_at FROM vehicle_photo_checks
      WHERE vehicle_id=?1 AND id>?2 ORDER BY id ASC LIMIT ?3`).bind(vehicleId,after,limit+1)
  ]);
  if (!Array.isArray(results) || results.length!==2 || results.some(r=>r?.success!==true || !Array.isArray(r.results))) throw new Error('Photo-check read failed');
  return { vehicle:results[0].results[0] ?? null, rows:results[1].results };
}

export async function auditVehicleRead(env, { actor, action, target, requestId }) {
  const result=await env.DB.prepare(`INSERT INTO audit_events
    (id,actor_account_id,action,target_type,target_id,outcome,request_id,created_at)
    VALUES(?1,?2,?3,'vehicle',?4,'success',?5,?6)`)
    .bind('audit_'+crypto.randomUUID(),actor,action,target,requestId ?? null,Date.now()).run();
  if(result?.success!==true || Number(result.meta?.changes)!==1) throw new Error('Vehicle read audit failed');
}
