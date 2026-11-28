// Bundled Worker and disposable local D1. All names, data, and secrets are synthetic.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { signJWT } from '../src/core/auth.js';
import { sqliteD1 } from '../tests/helpers/sqliteD1.mjs';
import { seedRuleActors, ruleSecrets, driverId } from '../tests/helpers/adminVehicleRuleScenario.mjs';
import { admissionScenario } from '../tests/helpers/vehicleAdmissionScenario.mjs';

const env = {
  ...ruleSecrets, APP_ENV: 'staging', PASSENGER_ASSIGNMENT_V2_ENABLED: 'true',
  PASSENGER_ORDER_SECRET: 'synthetic-local-order-secret-0123456789',
  PROXY_HMAC_SECRET: 'synthetic-local-proxy-secret-0123456789'
};
const result = await build({ entryPoints: [new URL('../src/index.js', import.meta.url).pathname],
  bundle: true, write: false, format: 'esm', target: 'es2022', platform: 'browser' });
const host = 'https://fixture.invalid';
const name = 'passenger-status-v2';
const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name, modules: true,
  script: result.outputFiles[0].text, bindings: env, d1Databases: ['DB'], compatibilityDate: '2026-08-20' }] }));
const sqlite = sqliteD1().sqlite;
try {
  const DB = await mf.getD1Database('DB', name);
  for (const type of ['table', 'index', 'view', 'trigger']) {
    const schema = sqlite.prepare(`SELECT sql FROM sqlite_master WHERE type = ?
      AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid`).all(type);
    for (const { sql } of schema) await DB.prepare(sql).run();
  }
  await seedRuleActors(DB);
  const send = async (method, path, data, token, key) => {
    const response = await mf.dispatchFetch(host + path, { method,
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.10',
        ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(key ? { 'Idempotency-Key': key } : {}) },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    return { status: response.status, body: await response.json() };
  };
  const fixture = await admissionScenario({ DB, ...env }, send);
  const id = 'local_d1_passenger_order';
  await fixture.order(id);
  const accessToken = await signJWT(env.PASSENGER_ORDER_SECRET,
    { sub: id, scope: 'passenger_order:read' }, 300);
  const path = '/v2/order-status';
  const getOrder = async () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = JSON.stringify({ accessToken });
    const signature = createHmac('sha256', env.PROXY_HMAC_SECRET)
      .update([timestamp, path, body].join('\n')).digest('hex');
    const response = await mf.dispatchFetch(host + path, { method: 'POST', body, headers: {
      'Content-Type': 'application/json', 'X-Proxy-Timestamp': timestamp, 'X-Proxy-Signature': signature } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    return (await response.json()).order;
  };
  assert.equal((await getOrder()).assignment, null);
  assert.equal((await send('POST', `/v1/admin/orders/${id}/assign`, { driverId,
    vehicleId: fixture.vehicle.id, expectedRevision: 1, reason: 'Synthetic' }, fixture.ownerToken,
    'passenger-status-local-native-assign')).status, 200);
  const active = await getOrder();
  assert.equal(active.revision, 2);
  assert.equal(active.assignment.vehicle.make, 'Toyota');
  assert.equal(active.assignment.driverDisplayName, null);
  await DB.prepare(`INSERT INTO vehicle_reverification_assignment_holds
    SELECT a.id, a.vehicle_id, t.id, 1 FROM order_assignments a
    JOIN vehicle_current_trusted_assessments t ON t.vehicle_id = a.vehicle_id
    WHERE a.order_id = ?1 AND a.state = 'active'`).bind(id).run();
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM vehicle_reverification_assignment_holds').first()).n, 1);
  assert.equal((await getOrder()).assignment, null);
  assert.deepEqual((await DB.prepare('PRAGMA foreign_key_check').all()).results, []);
  console.log('Local workerd/D1: pending order, assignment, hold, and foreign keys PASS');
} finally {
  sqlite.close();
  await mf.dispose();
}
