import assert from 'node:assert/strict';
import test from 'node:test';
import { createHmac } from 'node:crypto';
import { json } from '../src/core/utils.js';
import worker from '../src/index.js';
import router from '../src/router.js';

async function captureLogs(t, run) {
  const logs = [];
  const error = console.error;
  const log = console.log;
  console.error = console.log = (...args) => logs.push(args.map(value => value instanceof Error ? { message: value.message, stack: value.stack } : value));
  try { await run(); } finally { console.error = error; console.log = log; }
  return JSON.stringify(logs);
}

test('JSON acknowledgements and sessions cannot be cached or MIME-sniffed', () => {
  const response = json({ accessToken: 'TEST_SESSION' }, 200, { 'Cache-Control': 'public' });
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(json({}, 200, { 'cache-control': 'public' }).headers.get('Cache-Control'), 'no-store');
});

test('unhandled exceptions do not disclose request data in logs', async t => {
  const logs = await captureLogs(t, async () => {
    const req = { get url() { throw new Error('TEST_PRIVATE_DOCUMENT'); } };
    const response = await worker.fetch(req, {}, {});
    assert.equal(response.status, 500);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  });
  assert.ok(!logs.includes('TEST_PRIVATE_DOCUMENT'));
});

test('signed calculation does not log passenger addresses', async t => {
  const secret = 'test-proxy-secret-for-privacy-regression';
  const timestamp = String(Math.floor(Date.now() / 1000));
  const body = JSON.stringify({ from: 'PRIVATEPICKUPADDRESS', to: 'PRIVATEDESTINATIONADDRESS', tariff: 'comfort' });
  const signature = createHmac('sha256', secret).update(timestamp + '\n/calculate\n' + body).digest('hex');
  const logs = await captureLogs(t, async () => {
    const response = await router(new Request('https://worker.test/calculate', {
      method: 'POST', body, headers: { 'Content-Type': 'application/json',
        'X-Proxy-Timestamp': timestamp, 'X-Proxy-Signature': signature }
    }), { PROXY_HMAC_SECRET: secret });
    assert.notEqual(response.status, 403); // Ensure the address-processing path was reached.
  });
  assert.ok(!logs.toLowerCase().includes('privatepickupaddress'));
  assert.ok(!logs.toLowerCase().includes('privatedestinationaddress'));
});
