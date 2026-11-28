import { verifyPassengerOrderAccess } from './passengerOrderAccess.js';
import { verifyProxyRequest } from './proxyAuth.js';
import { trustedVehicleGuard } from './trustedVehicleAdmission.js';
import { json, safeJson } from './utils.js';

// The order remains visible if the assignment cannot be shown. All checks
// and passenger fields come from one read, with no internal IDs selected.
const PASSENGER_ORDER_SQL = `
  SELECT o.id, o.status, o.route, o.from_place, o.to_place, o.trip_date,
    o.tariff, o.distance_km, o.duration_minutes, o.price_rub,
    o.created_at, o.updated_at, o.revision,
    v.id IS NOT NULL AS visible_assignment,
    v.make, v.model, v.color, v.plate
  FROM orders o
  LEFT JOIN order_assignments a ON a.order_id = o.id
    AND a.driver_id = o.driver_id
    AND a.state = 'active' AND a.revoked_at IS NULL
    AND o.status IN ('taken', 'in_progress')
  LEFT JOIN vehicles v ON v.id = a.vehicle_id AND v.driver_id = a.driver_id
    AND v.status IN ('approved', 'photo_check_required')
    AND ${trustedVehicleGuard('v', '?2')}
    AND EXISTS (
      SELECT 1 FROM staff_accounts s
      JOIN driver_profiles p ON p.staff_account_id = s.id
      WHERE s.id = a.driver_id AND s.role = 'driver' AND s.status = 'active'
        AND p.registration_status = 'approved' AND p.identity_status = 'verified'
    )
    AND NOT EXISTS (
      SELECT 1 FROM vehicle_reverification_assignment_holds h
      WHERE h.assignment_id = a.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM vehicle_photo_checks pc
      WHERE pc.vehicle_id = v.id AND pc.restriction_mode = 'immediate'
        AND pc.result <> 'passed'
    )
  WHERE o.id = ?1
`;

const fail = (error, status, headers) => json({ ok: false, error }, status, headers);

function passengerOrder(row) {
  return {
    id: row.id,
    status: row.status,
    route: row.route,
    from: row.from_place ?? '',
    to: row.to_place ?? '',
    date: row.trip_date,
    tariff: row.tariff,
    distance: row.distance_km,
    duration: row.duration_minutes,
    price: row.price_rub,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    revision: row.revision,
    assignment: row.visible_assignment === 1 ? {
      // The administrative full_name is not an approved passenger display name.
      driverDisplayName: null,
      vehicle: { make: row.make, model: row.model, color: row.color, plate: row.plate }
    } : null
  };
}

export async function passengerOrderStatusV2(req, env) {
  if (env?.PASSENGER_ASSIGNMENT_V2_ENABLED !== 'true') {
    return fail('not found', 404);
  }
  if (req.method !== 'POST') {
    return fail('method not allowed', 405, { Allow: 'POST' });
  }
  const proxy = await verifyProxyRequest(req, env, '/v2/order-status');
  if (!proxy.ok) return fail(proxy.error, proxy.status);

  const body = await safeJson(req);
  if (new URL(req.url).search || !body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).length !== 1 || typeof body.accessToken !== 'string'
      || !body.accessToken.trim()) {
    return fail('invalid request', 400);
  }
  try {
    const access = await verifyPassengerOrderAccess(env, body.accessToken.trim());
    if (!access.ok) return fail('forbidden', 403);

    const row = await env.DB.prepare(PASSENGER_ORDER_SQL).bind(access.orderId, Date.now()).first();
    if (!row) return fail('order not found', 404);
    return json({ ok: true, order: passengerOrder(row) });
  } catch {
    console.error('PASSENGER ORDER STATUS V2 UNAVAILABLE');
    return fail('order read unavailable', 500);
  }
}
