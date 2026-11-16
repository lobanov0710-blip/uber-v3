import { assignmentCandidateBlockers } from './orderAssignmentService.js';
import { adminCan, resolveAdminAccess } from './adminAuthorization.js';
import { assignmentCandidateFromRow, getOrderAssignmentState } from './orderAssignmentRepository.js';
import { listAdminOrderRows, listAssignmentOptionRows, auditAssignmentRead } from './adminAssignmentReadRepository.js';

const orderIdPattern = /^[A-Za-z0-9_-]{8,120}$/;
const driverIdPattern = /^staff_[A-Za-z0-9_-]{8,94}$/;
const vehicleIdPattern = /^vehicle_[A-Za-z0-9_-]{8,100}$/;
const failure = (status, code) => ({ ok: false, status, error: status === 403 ? 'forbidden' : status === 404 ? 'not found' : 'invalid request', code });
const encode = value => btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function query(params, scope, optionsRead) {
  if (!(params instanceof URLSearchParams)) return null;
  for (const key of params.keys()) if (!(optionsRead ? ['limit','cursor'] : ['status','limit','cursor']).includes(key) || params.getAll(key).length !== 1) return null;
  const status = params.get('status') ?? '';
  if (!(params.has('status') ? ['new','taken','in_progress'] : ['']).includes(status)) return null;
  const limitText = params.get('limit');
  if (limitText !== null && !/^(?:[1-9]|[1-4][0-9]|50)$/.test(limitText)) return null;
  const limit = limitText === null ? 20 : Number(limitText);
  const token = params.get('cursor');
  let keys = optionsRead ? ['', ''] : [''];
  if (token !== null) {
    if (token.length > 512 || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
    try {
      const value = JSON.parse(atob(token.replace(/-/g, '+').replace(/_/g, '/')));
      if (!Array.isArray(value) || encode(value) !== token || value.length !== (optionsRead ? 4 : 3)
          || value[0] !== scope || value[1] !== (optionsRead ? optionsRead : status)) return null;
      keys = value.slice(2);
      if (keys.some(key => typeof key !== 'string')) return null;
      if (optionsRead ? !driverIdPattern.test(keys[0]) || !vehicleIdPattern.test(keys[1]) : !orderIdPattern.test(keys[0])) return null;
    } catch { return null; }
  }
  return { status, limit, keys };
}

async function authorization(env, user, options, required) {
  const access = await resolveAdminAccess(env, user);
  if (!access.ok || required.some(permission => !adminCan(access, permission))) return { error: failure(403, 'permission_required') };
  // This evidence is supplied only by authenticateStaffRequest, never by query/body/JWT claims.
  if (access.isOwner && (options.mfa?.required !== true || options.mfa?.verified !== true)) return { error: failure(403, 'owner_mfa_required') };
  return { access };
}

async function audit(env, access, action, target, options) {
  await auditAssignmentRead(env, { actor: access.accountId, action, target, requestId: options.requestId, now: Date.now() });
}

export async function getAdminOrders(env, user, params = new URLSearchParams(), options = {}) {
  const auth = await authorization(env, user, options, ['orders.read']);
  if (auth.error) return auth.error;
  const page = query(params, 'admin.orders.v1', false);
  if (!page) return failure(400, 'invalid_query');
  const rows = await listAdminOrderRows(env, { status: page.status, after: page.keys[0], limit: page.limit });
  const selected = rows.slice(0, page.limit);
  const orders = selected.map(row => ({ id: row.id, from: row.from_place, to: row.to_place,
    date: row.trip_date, tariff: row.tariff, status: row.status, revision: Number(row.revision),
    assignment: row.assignment_id === null ? null : { id: row.assignment_id, driverId: row.driver_id,
      vehicleId: row.vehicle_id, revision: Number(row.assignment_revision), phase: row.phase } }));
  const last = selected.at(-1);
  const nextCursor = rows.length > page.limit ? encode(['admin.orders.v1', page.status, last.id]) : null;
  await audit(env, auth.access, 'admin.orders_read', 'orders', options);
  return { ok: true, orders, nextCursor };
}

export async function getAdminAssignmentOptions(env, user, orderId, params = new URLSearchParams(), options = {}) {
  const auth = await authorization(env, user, options, ['orders.read','drivers.read','vehicles.read']);
  if (auth.error) return auth.error;
  if (!adminCan(auth.access, 'orders.assign') && !adminCan(auth.access, 'orders.reassign')) return failure(403, 'permission_required');
  if (typeof orderId !== 'string' || !orderIdPattern.test(orderId)) return failure(400, 'invalid_order_id');
  const page = query(params, 'admin.assignment-options.v1', orderId);
  if (!page) return failure(400, 'invalid_query');
  const order = await getOrderAssignmentState(env, orderId);
  if (!order) return failure(404, 'order_not_found');
  const reassign = order.orderStatus !== 'new' || order.assignment !== null;
  if (!adminCan(auth.access, reassign ? 'orders.reassign' : 'orders.assign')) return failure(403, 'permission_required');
  const rows = await listAssignmentOptionRows(env, { driverAfter: page.keys[0], vehicleAfter: page.keys[1], limit: page.limit });
  const selected = rows.slice(0, page.limit), candidates = [];
  for (const row of selected) {
    // Reuse actual mutation eligibility (including photo-control grace); never rank or infer offline exclusion.
    const candidate = assignmentCandidateFromRow(row);
    const blockers = [];
    if (reassign) {
      if (order.orderStatus !== 'taken' || order.assignment === null) blockers.push('order_not_reassignable');
      else if (order.assignment.driverId === row.staff_account_id && order.assignment.vehicleId === row.vehicle_id) blockers.push('assignment_unchanged');
    } else if (order.orderDriverId !== null) blockers.push('order_not_assignable');
    blockers.push(...assignmentCandidateBlockers(candidate, row.vehicle_id));
    candidates.push({ driverId: row.staff_account_id, fullName: row.full_name, vehicleId: row.vehicle_id,
      make: row.make, model: row.model, plate: row.plate, status: candidate?.vehicleStatus ?? null,
      availability: { state: candidate?.availabilityState ?? 'off_line', activeVehicleId: candidate?.activeVehicleId ?? null },
      eligible: blockers.length === 0, blockers });
  }
  const last = selected.at(-1);
  const nextCursor = rows.length > page.limit ? encode(['admin.assignment-options.v1', orderId, last.staff_account_id, last.vehicle_id]) : null;
  await audit(env, auth.access, 'admin.assignment_options_read', orderId, options);
  return { ok: true, orderId, orderRevision: order.orderRevision, options: candidates, nextCursor };
}
