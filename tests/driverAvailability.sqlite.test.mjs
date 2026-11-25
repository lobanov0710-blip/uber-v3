import assert from 'node:assert/strict';
import test from 'node:test';
import { updateDriverAvailability } from '../src/core/driverAvailabilityRepository.js';
import { putDriverAvailability } from '../src/core/driverAvailabilityService.js';

import { fixture, driver, vehicle, otherVehicle, time } from './helpers/driverPlatformFixture.mjs';

function mutation(key = 'A', claim = 'claim-first') {
  return { driverId: driver.id, requestedState: 'on_line', activeVehicleId: vehicle,
    expectedRevision: 1, updatedAt: time, requestId: 'req_test', auditId: 'audit_' + claim,
    idempotency: { operation: 'driver.availability.update', keyDigest: key.repeat(43),
      requestDigest: 'B'.repeat(43), claimId: claim } };
}
function count(DB, table) {
  return DB.sqlite.prepare('SELECT count(*) AS n FROM ' + table).get().n;
}

test('successful availability mutation commits state, audit and idempotency', async t => {
  const DB = fixture(t);
  assert.equal((await updateDriverAvailability({ DB }, mutation())).kind, 'success');
  assert.equal(count(DB, 'audit_events'), 1);
  assert.equal(DB.sqlite.prepare('SELECT state FROM mutation_idempotency').get().state, 'completed');
});

test('same-key retry returns original response after revision has advanced', async t => {
  const DB = fixture(t);
  const input = { activeVehicleId: vehicle, requestedState: 'on_line', expectedRevision: 1 };
  const options = { idempotencyKey: 'availability-replay-key', nowMs: time };
  const first = await putDriverAvailability({ DB }, driver, input, options);
  assert.equal(first.ok, true);
  const replay = await putDriverAvailability({ DB }, driver, input, options);
  assert.deepEqual(replay, first);
  assert.equal(count(DB, 'audit_events'), 1);
  const changed = await putDriverAvailability({ DB }, driver,
    { ...input, requestedState: 'off_line' }, options);
  assert.equal(changed.code, 'idempotency_key_reused');
});

test('losing claim cannot append duplicate audit or overwrite the saved result', async t => {
  const DB = fixture(t);
  await updateDriverAvailability({ DB }, mutation());
  const retry = await updateDriverAvailability({ DB }, mutation('A', 'claim-loser'));
  assert.equal(retry.kind, 'existing_idempotency');
  assert.equal(count(DB, 'audit_events'), 1);
});

test('stale competing key cannot claim another mutation as its own success', async t => {
  const DB = fixture(t);
  await updateDriverAvailability({ DB }, mutation());
  const stale = await updateDriverAvailability({ DB }, mutation('C', 'claim-stale'));
  assert.equal(stale.kind, 'conflict');
  assert.equal(count(DB, 'audit_events'), 1);
  const record = DB.sqlite.prepare('SELECT http_status FROM mutation_idempotency WHERE key_digest=?')
    .get('C'.repeat(43));
  assert.equal(record.http_status, 409);
});

test('driver can go offline after vehicle and identity approval are revoked', async t => {
  const DB = fixture(t);
  await updateDriverAvailability({ DB }, mutation());
  DB.sqlite.exec(`UPDATE vehicles SET status='suspended';
    UPDATE driver_profiles SET registration_status='changes_required', identity_status='manual_review_required'`);
  const result = await putDriverAvailability({ DB }, driver,
    { activeVehicleId: vehicle, requestedState: 'off_line', expectedRevision: 2 },
    { idempotencyKey: 'offline-after-revocation', nowMs: time + 1 });
  assert.equal(result.ok, true);
  assert.equal(result.availability.state, 'off_line');
});

test('offline driver cannot select another car or clear car during an active assignment', async t => {
  const DB = fixture(t);
  DB.sqlite.prepare(`INSERT INTO orders
    (id,name,phone,route,trip_date,status,driver_id,created_at,updated_at)
    VALUES ('order_test123','Test','+79990000000','Test route','2030-01-01','taken',?,1,1)`)
    .run(driver.id);
  DB.sqlite.prepare(`INSERT INTO order_assignments
    (id,order_id,driver_id,vehicle_id,assigned_by,reason,created_at)
    VALUES ('assignment_test123','order_test123',?,?,?,'Test',1)`)
    .run(driver.id, vehicle, driver.id);
  for (const selected of [otherVehicle, null]) {
    const result = await updateDriverAvailability({ DB },
      { ...mutation(selected === null ? 'N' : 'O', 'claim-' + selected),
        activeVehicleId: selected, requestedState: 'off_line' });
    assert.equal(result.kind, 'conflict');
  }
  assert.equal(count(DB, 'audit_events'), 0);
});

test('audit storage failure rolls back availability and idempotency claim', async t => {
  const DB = fixture(t);
  DB.sqlite.exec(`CREATE TRIGGER deny_test_audit BEFORE INSERT ON audit_events
    BEGIN SELECT RAISE(ABORT, 'test audit failure'); END;`);
  await assert.rejects(updateDriverAvailability({ DB }, mutation()), /test audit failure/);
  assert.equal(DB.sqlite.prepare('SELECT revision FROM driver_availability').get().revision, 1);
  assert.equal(count(DB, 'mutation_idempotency'), 0);
});
