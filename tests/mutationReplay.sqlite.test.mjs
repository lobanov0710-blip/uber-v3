import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture, driver, vehicle, otherVehicle, time } from './helpers/driverPlatformFixture.mjs';
import { assignOrderByAdmin, reassignOrderByAdmin } from '../src/core/orderAssignmentService.js';
import { changeDriverAssignmentPhase, createDriverTripVerificationChallenge } from '../src/core/driverTripOperationalService.js';
import { advanceDriverAssignmentPhase } from '../src/core/driverTripOperationalRepository.js';

const admin = { id: 'staff_admin123', role: 'admin' };
const order = 'order_12345678';
function setup(t) {
  const DB = fixture(t);
  DB.sqlite.prepare(`INSERT INTO staff_accounts
    (id,login,display_name,role,status,password_algorithm,password_iterations,
     password_salt,password_hash,password_changed_at,created_at,updated_at)
    VALUES (?,'admin-test','Test Admin','admin','active','pbkdf2-sha256',100000,?,?,1,1,1)`)
    .run(admin.id, 'A'.repeat(32), 'B'.repeat(43));
  DB.sqlite.prepare('INSERT INTO staff_owner_binding(singleton,account_id,created_at) VALUES (1,?,1)')
    .run(admin.id);
  DB.sqlite.prepare(`INSERT INTO orders
    (id,name,phone,route,trip_date,status,created_at,updated_at)
    VALUES (?,'Test','+79990000000','Test route','2030-01-01','new',1,1)`).run(order);
  return DB;
}
async function assign(DB) {
  return assignOrderByAdmin({ DB }, admin, order,
    { driverId: driver.id, vehicleId: vehicle, reason: 'Test', expectedRevision: 1 },
    { idempotencyKey: 'assign-test-key', nowMs: time });
}
function auditCount(DB) { return DB.sqlite.prepare('SELECT count(*) AS n FROM audit_events').get().n; }

test('assign retries return the original acknowledgement without another audit', async t => {
  const DB = setup(t);
  const original = await assign(DB);
  assert.equal(original.ok, true);
  const count = auditCount(DB);
  assert.deepEqual(await assign(DB), original);
  assert.equal(auditCount(DB), count);
});

test('reassign retries return the original result after revision and car changed', async t => {
  const DB = setup(t);
  assert.equal((await assign(DB)).ok, true);
  const input = { driverId: driver.id, vehicleId: otherVehicle, reason: 'Test change', expectedRevision: 2 };
  const options = { idempotencyKey: 'reassign-test-key', nowMs: time + 1 };
  const original = await reassignOrderByAdmin({ DB }, admin, order, input, options);
  assert.equal(original.ok, true);
  const count = auditCount(DB);
  assert.deepEqual(await reassignOrderByAdmin({ DB }, admin, order, input, options), original);
  assert.equal(auditCount(DB), count);
});

for (const [from, to] of [['en_route_to_pickup', 'arrived'], ['arrived', 'in_trip']]) {
test('phase replay for ' + to + ' succeeds after revision advanced', async t => {
  const DB = setup(t);
  const assignment = (await assign(DB)).assignment;
  // Fixture only: no production endpoint may forge a verification or bypass liveness.
  DB.sqlite.prepare('UPDATE order_assignments SET phase=? WHERE id=?').run(from, assignment.id);
  const input = { phase: to, expectedRevision: 1 };
  const options = { idempotencyKey: 'phase-test-key', nowMs: time + 1 };
  const original = await changeDriverAssignmentPhase({ DB }, driver, assignment.id, input, options);
  assert.equal(original.ok, true);
  const count = auditCount(DB);
  assert.deepEqual(await changeDriverAssignmentPhase({ DB }, driver, assignment.id, input, options), original);
  assert.equal(auditCount(DB), count);
});
}

test('challenge retry returns the original expiring challenge without issuing another', async t => {
  const DB = setup(t);
  const assignment = (await assign(DB)).assignment;
  const env = { DB, TRIP_VERIFICATION_CHALLENGE_TTL_SECONDS: '300' }; // Test value, not a production choice.
  const options = { idempotencyKey: 'challenge-test-key', nowMs: time + 1 };
  const original = await createDriverTripVerificationChallenge(env, driver, assignment.id,
    { expectedRevision: 1 }, options);
  assert.equal(original.ok, true);
  const count = auditCount(DB);
  DB.sqlite.prepare("UPDATE order_assignments SET phase='arrived',revision=revision+1 WHERE id=?").run(assignment.id);
  assert.deepEqual(await createDriverTripVerificationChallenge(env, driver, assignment.id,
    { expectedRevision: 1 }, options), original);
  assert.equal(auditCount(DB), count);
  assert.equal(DB.sqlite.prepare('SELECT count(*) AS n FROM identity_verifications').get().n, 1);
});

for (const [from, to] of [['en_route_to_pickup', 'arrived'], ['arrived', 'in_trip']]) {
test('a losing claim for ' + to + ' cannot append audit or claim success', async t => {
  const DB = setup(t);
  const assignment = (await assign(DB)).assignment;
  DB.sqlite.prepare('UPDATE order_assignments SET phase=? WHERE id=?').run(from, assignment.id);
  const args = { driverId: driver.id, assignmentId: assignment.id, expectedRevision: 1,
    expectedPhase: from, targetPhase: to, changedAt: time + 1,
    auditId: 'audit_phase_first', requestId: 'req_test', idempotency: {
      operation: 'driver.assignment.phase', keyDigest: 'P'.repeat(43),
      requestDigest: 'Q'.repeat(43), claimId: 'claim_phase_first' } };
  assert.equal((await advanceDriverAssignmentPhase({ DB }, args)).kind, 'success');
  const count = auditCount(DB);
  const loser = await advanceDriverAssignmentPhase({ DB }, { ...args,
    auditId: 'audit_phase_loser', idempotency: { ...args.idempotency, claimId: 'claim_phase_loser' } });
  assert.equal(loser.kind, 'existing_idempotency');
  assert.equal(auditCount(DB), count);
  const stale = await advanceDriverAssignmentPhase({ DB }, { ...args,
    auditId: 'audit_phase_stale', idempotency: { ...args.idempotency,
      keyDigest: 'S'.repeat(43), claimId: 'claim_phase_stale' } });
  assert.equal(stale.kind, 'conflict');
  assert.equal(auditCount(DB), count);
});
}

test('a cached assignment result never bypasses current admin permissions', async t => {
  const DB = setup(t);
  assert.equal((await assign(DB)).ok, true);
  // Removing the OWNER binding makes this account a dispatcher with no permissions.
  DB.sqlite.exec('DELETE FROM staff_owner_binding');
  assert.equal((await assign(DB)).status, 403);
});
