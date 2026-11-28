import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import worker from '../src/index.js';
import { signJWT } from '../src/core/auth.js';
import { sqliteD1 } from './helpers/sqliteD1.mjs';
import { seedRuleActors, ruleSecrets, driverId } from './helpers/adminVehicleRuleScenario.mjs';
import { admissionScenario } from './helpers/vehicleAdmissionScenario.mjs';

const path = '/v2/order-status';
const secrets = {
  PROXY_HMAC_SECRET: 'synthetic-passenger-proxy-fixture-0123456789',
  PASSENGER_ORDER_SECRET: 'synthetic-passenger-access-fixture-0123456789'
};
const orderId = 'order_passenger_v2_fixture';

async function capability(id = orderId, ttl = 300, scope = 'passenger_order:read') {
  return signJWT(secrets.PASSENGER_ORDER_SECRET, { sub: id, scope }, ttl);
}

function signedRequest(body, options = {}) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const data = JSON.stringify(body);
  const url = new URL(options.url ?? `https://fixture.invalid${path}`);
  const signature = createHmac('sha256', secrets.PROXY_HMAC_SECRET)
    .update([timestamp, options.signedPath ?? url.pathname, data].join('\n')).digest('hex');
  return new Request(url, {
    method: 'POST', body: data,
    headers: { 'Content-Type': 'application/json', 'X-Proxy-Timestamp': timestamp,
      'X-Proxy-Signature': signature }
  });
}

async function read(req, env, status) {
  const response = await worker.fetch(req, env, {});
  assert.equal(response.status, status);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  return response.json();
}

const enabled = { ...secrets, PASSENGER_ASSIGNMENT_V2_ENABLED: 'true' };

test('v2 is opt-in, method-limited and outside the OWNER-only allowlist', async () => {
  const body = { accessToken: await capability() };
  await read(signedRequest(body), secrets, 404);
  await read(new Request(`https://fixture.invalid${path}`), enabled, 405);
  const result = await read(signedRequest(body, {
    url: `https://uber-v3-staging.lobanov0710.workers.dev${path}`
  }), { ...enabled, APP_ENV: 'staging', ADMIN_PHONE_TEST_ONLY: 'true' }, 404);
  assert.equal(result.code, 'admin_phone_route_unavailable');
});

test('invalid request, wrong HMAC path and invalid capability reach no D1 query', async () => {
  let reads = 0;
  const DB = { prepare() { reads++; throw new Error('fixture must not read D1'); } };
  const env = { ...enabled, DB };
  const body = { accessToken: await capability() };
  await read(signedRequest(body, { signedPath: '/order-status' }), env, 403);
  await read(signedRequest({ ...body, orderId: 'another_order' }), env, 400);
  await read(signedRequest({ accessToken: 7 }), env, 400);
  await read(signedRequest(body, { url: `https://fixture.invalid${path}?orderId=another_order` }), env, 400);
  await read(signedRequest({ accessToken: 'invalid' }), env, 403);
  await read(signedRequest({ accessToken: await capability(orderId, 0.1) }), env, 403);
  await read(signedRequest({ accessToken: await capability(orderId, 300, 'other:scope') }), env, 403);
  assert.equal(reads, 0);
});

test('Worker and migrated SQLite return one scoped snapshot and retire a changed or blocked assignment', async t => {
  const DB = sqliteD1();
  t.after(() => DB.sqlite.close());
  await seedRuleActors(DB);
  const env = { DB, ...ruleSecrets, ...enabled, APP_ENV: 'staging' };
  const send = async (method, url, body, token, key) => {
    const response = await worker.fetch(new Request('https://fixture.invalid' + url, {
      method, headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.10',
        ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(key ? { 'Idempotency-Key': key } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    }), env, {});
    return { status: response.status, body: await response.json() };
  };
  const scenario = await admissionScenario(env, send);
  await scenario.order(orderId);
  await scenario.order('synthetic_other_order', 'taken');
  const privateName = 'Synthetic administrative identity';
  DB.sqlite.prepare('UPDATE driver_profiles SET full_name = ? WHERE staff_account_id = ?').run(privateName, driverId);

  let reads = 0;
  const passengerEnv = { ...env, DB: { prepare(sql) { reads++; return DB.prepare(sql); } } };
  const requestBody = { accessToken: await capability() };
  const getOrder = async () => {
    const before = reads;
    const { order } = await read(signedRequest(requestBody), passengerEnv, 200);
    assert.equal(reads, before + 1);
    return order;
  };
  assert.equal((await getOrder()).assignment, null);
  const legacy = await read(signedRequest({ accessToken: await capability('synthetic_other_order') }), passengerEnv, 200);
  assert.equal(legacy.order.id, 'synthetic_other_order');
  assert.equal(legacy.order.assignment, null);
  await read(signedRequest({ accessToken: await capability('synthetic_missing_order') }), passengerEnv, 404);

  const assignment = { driverId, vehicleId: scenario.vehicle.id, expectedRevision: 1, reason: 'Synthetic' };
  assert.equal((await send('POST', `/v1/admin/orders/${orderId}/assign`, assignment,
    scenario.ownerToken, 'synthetic-passenger-test-assign')).status, 200);
  const first = await getOrder();
  assert.equal(first.id, orderId);
  assert.equal(first.status, 'taken');
  assert.equal(first.revision, 2);
  assert.equal(first.assignment.driverDisplayName, null);
  assert.deepEqual(Object.keys(first.assignment.vehicle), ['make', 'model', 'color', 'plate']);
  assert.deepEqual(Object.keys(first), ['id', 'status', 'route', 'from', 'to', 'date', 'tariff',
    'distance', 'duration', 'price', 'createdAt', 'updatedAt', 'revision', 'assignment']);
  assert.ok(!JSON.stringify(first).includes(privateName));
  assert.ok(!JSON.stringify(first).includes(driverId));
  const v1 = await read(signedRequest(requestBody, { url: 'https://fixture.invalid/order-status' }), env, 200);
  const { assignment: _card, revision: _revision, ...expectedV1 } = first;
  assert.deepEqual(v1.order, expectedV1);

  const nextAssignment = { ...assignment, expectedRevision: 2, vehicleId: scenario.second };
  assert.equal((await send('POST', `/v1/admin/orders/${orderId}/reassign`, nextAssignment,
    scenario.ownerToken, 'synthetic-passenger-test-reassign')).status, 200);
  const next = await getOrder();
  assert.equal(next.revision, 3);
  assert.equal(next.assignment.vehicle.plate, 'SYNTHETIC2');
  assert.notEqual(next.assignment.vehicle.plate, first.assignment.vehicle.plate);
  DB.sqlite.prepare('UPDATE orders SET status = ? WHERE id = ?').run('in_progress', orderId);
  assert.equal((await getOrder()).assignment.vehicle.plate, 'SYNTHETIC2');

  for (const status of ['done', 'canceled']) {
    DB.sqlite.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, orderId);
    assert.equal((await getOrder()).assignment, null);
  }
  DB.sqlite.prepare('UPDATE orders SET status = ? WHERE id = ?').run('taken', orderId);
  DB.sqlite.prepare('UPDATE staff_accounts SET status = ? WHERE id = ?').run('disabled', driverId);
  assert.equal((await getOrder()).assignment, null);
  DB.sqlite.prepare('UPDATE staff_accounts SET status = ? WHERE id = ?').run('active', driverId);
  DB.sqlite.prepare('UPDATE document_resources SET status = ? WHERE id = ?')
    .run('rejected', 'document_admission_second_front');
  assert.equal(DB.sqlite.prepare('SELECT count(*) AS n FROM vehicle_reverification_assignment_holds').get().n, 1);
  assert.equal((await getOrder()).assignment, null);
});
