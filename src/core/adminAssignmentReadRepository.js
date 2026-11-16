import { ASSIGNMENT_ELIGIBILITY_COLUMNS } from './orderAssignmentRepository.js';
import { PHOTO_CONTROL_GRACE_MS } from './photoControlSchedule.js';
// Minimal operational projections. Passenger/contact/private-resource columns are never selected.
export async function listAdminOrderRows(env, { status, after, limit }) {
  const result = await env.DB.prepare(`
    SELECT o.id, o.from_place, o.to_place, o.trip_date, o.tariff, o.status, o.revision,
      a.id AS assignment_id, a.driver_id, a.vehicle_id,
      a.revision AS assignment_revision, a.phase
    FROM orders o LEFT JOIN order_assignments a ON a.order_id=o.id
      AND a.state='active' AND a.revoked_at IS NULL
    WHERE o.status IN ('new','taken','in_progress') AND (?1='' OR o.status=?1) AND o.id>?2
    ORDER BY o.id ASC LIMIT ?3
  `).bind(status, after, limit + 1).all();
  if (result?.success !== true || !Array.isArray(result.results)) throw new Error('Order read failed');
  return result.results;
}

export async function listAssignmentOptionRows(env, { driverAfter, vehicleAfter, limit }) {
  const result = await env.DB.prepare(`
    SELECT p.staff_account_id, p.full_name,
      v.id AS vehicle_id, v.make, v.model, v.plate, ${ASSIGNMENT_ELIGIBILITY_COLUMNS}
    FROM driver_profiles p JOIN staff_accounts sa ON sa.id=p.staff_account_id
      JOIN vehicles v ON v.driver_id=p.staff_account_id
      LEFT JOIN driver_availability a ON a.driver_id=p.staff_account_id
    WHERE p.staff_account_id>?1 OR (p.staff_account_id=?1 AND v.id>?2)
    ORDER BY p.staff_account_id ASC, v.id ASC LIMIT ?5
  `).bind(driverAfter, vehicleAfter, Date.now(), PHOTO_CONTROL_GRACE_MS, limit + 1).all();
  if (result?.success !== true || !Array.isArray(result.results)) throw new Error('Option read failed');
  return result.results;
}

export async function auditAssignmentRead(env, { actor, action, target, requestId, now }) {
  const result = await env.DB.prepare(`
    INSERT INTO audit_events(id,actor_account_id,action,target_type,target_id,outcome,request_id,created_at)
    VALUES(?1,?2,?3,'order',?4,'success',?5,?6)
  `).bind('audit_' + crypto.randomUUID(), actor, action, target, requestId ?? null, now).run();
  if (result?.success !== true || Number(result.meta?.changes) !== 1) throw new Error('Read audit failed');
}
