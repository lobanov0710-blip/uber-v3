import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { signJWT } from '../../src/core/auth.js';
import { sqliteD1 } from '../../tests/helpers/sqliteD1.mjs';
import { orderId, seed, transitions } from './synthetic-order.mjs';

const origin = 'https://uber-v3-tz02-qa.fixture.workers.dev';
const env = { APP_ENV: 'staging', PASSENGER_ASSIGNMENT_V2_ENABLED: 'true', TZ02_QA_WORKER_ORIGIN: origin,
  PROXY_HMAC_SECRET: 'synthetic-isolated-qa-gateway-secret-1234',
  PASSENGER_ORDER_SECRET: 'synthetic-isolated-qa-session-secret-1234' };
const name = 'tz02-qa-acceptance';
const bundle = await build({ entryPoints: [new URL('./worker.js', import.meta.url).pathname],
  bundle: true, write: false, format: 'esm', target: 'es2022', platform: 'browser' });
const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name, modules: true,
  script: bundle.outputFiles[0].text, bindings: env, d1Databases: ['DB'], compatibilityDate: '2026-06-01' }] }));
const { sqlite } = sqliteD1();
try {
  const DB = await mf.getD1Database('DB', name);
  for (const type of ['table', 'index', 'view', 'trigger']) {
    const schema = sqlite.prepare(`SELECT sql FROM sqlite_master WHERE type=? AND sql IS NOT NULL
      AND name NOT LIKE 'sqlite_%' ORDER BY rowid`).all(type);
    for (const { sql } of schema) await DB.prepare(sql).run();
  }
  const apply = statements => DB.batch(statements.map(sql => DB.prepare(sql)));
  await apply(await seed(Date.now(), '2026-11-28'));
  for (const path of ['/', '/staff/login', '/orders', '/order-status', '/calculate', '/v1/admin/orders']) {
    const r = await mf.dispatchFetch(origin + path, { method: 'POST', body: '{}' });
    assert.equal(r.status, 404, path);
  }
  assert.equal((await mf.dispatchFetch('https://other.invalid/v2/order-status', { method: 'POST', body: '{}' })).status, 404);
  const url = origin + '/v2/order-status';
  assert.equal((await mf.dispatchFetch(url, { method: 'POST', body: '{}' })).status, 403);
  const token = await signJWT(env.PASSENGER_ORDER_SECRET, { sub: orderId, scope: 'passenger_order:read' }, 300);
  const body = JSON.stringify({ accessToken: token });
  async function verify(status, revision, plate) {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac('sha256', env.PROXY_HMAC_SECRET)
      .update([timestamp, '/v2/order-status', body].join('\n')).digest('hex');
    const r = await mf.dispatchFetch(url, { method: 'POST', body, headers: {
      'X-Proxy-Timestamp': timestamp, 'X-Proxy-Signature': signature } });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('Cache-Control'), 'no-store');
    const { order } = await r.json();
    assert.equal(order.status, status);
    assert.equal(order.revision, revision);
    if (plate) assert.equal(order.assignment.vehicle.plate, plate);
    else assert.equal(order.assignment, null);
  }
  await verify('new', 1, null);
  await apply(transitions['01-assign']);
  await verify('taken', 2, 'QA-TZ02-01');
  await apply(transitions['02-reassign']);
  await apply(transitions['02-reassign']);
  await verify('taken', 3, 'QA-TZ02-02');
  await apply(transitions['03-finish']);
  await verify('canceled', 4, null);
  assert.deepEqual((await DB.prepare('PRAGMA foreign_key_check').all()).results, []);
  console.log('TZ-02 isolated Worker/D1: route isolation, HMAC and all four synthetic order states PASS');
} finally {
  sqlite.close();
  await mf.dispose();
}
