import assert from 'node:assert/strict';
import test from 'node:test';
import { createHmac } from 'node:crypto';
import { json } from '../src/core/utils.js';
import worker from '../src/index.js';
import router from '../src/router.js';
import { verifyJWT } from '../src/core/auth.js';
import { tgSend } from '../src/core/telegram.js';
import { geoCalculate } from '../src/core/geo.js';

async function captureLogs(t, run) {
  const logs = [];
  const methods = ['error', 'warn', 'log'];
  const original = Object.fromEntries(methods.map(name => [name, console[name]]));
  for (const name of methods) console[name] = (...args) => logs.push(args.map(value =>
    value instanceof Error ? { message: value.message, stack: value.stack } : value));
  try { await run(); } finally { Object.assign(console, original); }
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


test('malformed JWT JSON never appears in warning logs', async t => {
  const marker = 'PRIVATE_JWT_HEADER';
  const header = Buffer.from(marker).toString('base64url');
  const logs = await captureLogs(t, async () => {
    assert.equal(await verifyJWT('test-secret-long-enough-for-hmac-verification',
      header + '.e30.invalid'), null);
  });
  assert.ok(!logs.includes(marker));
});

test('Telegram transport errors and upstream replies disclose no token, chat or message', async t => {
  const marker = 'PRIVATE_TELEGRAM_DATA';
  const env = { APP_ENV: 'production', TG_BOT_TOKEN: marker, TG_CHAT_ID: marker };
  for (const mode of ['network', 'api', 'success']) {
    const mocked = t.mock.method(globalThis, 'fetch', async url => {
      if (mode === 'network') throw new Error(url + ' ' + marker);
      return new Response(JSON.stringify(mode === 'success'
        ? { ok: true, result: { message_id: 123, chat: { id: marker } } }
        : { ok: false, description: marker, error_code: marker }),
        { status: mode === 'success' ? 200 : 400, statusText: marker });
    });
    try {
      const logs = await captureLogs(t, async () => {
        if (mode === 'success') assert.equal((await tgSend(env, marker)).ok, true);
        else await assert.rejects(tgSend(env, marker), error => !error.message.includes(marker));
      });
      assert.ok(!logs.includes(marker), mode);
    } finally { mocked.mock.restore(); }
  }
});

test('geocoding transport error names cannot leak upstream request data', async t => {
  const marker = 'PRIVATE_MAPBOX_DATA';
  const mocked = t.mock.method(globalThis, 'fetch', async () => {
    const error = new Error(marker); error.name = marker; throw error;
  });
  try {
    const logs = await captureLogs(t, async () => {
      const response = await geoCalculate({ from: 'Москва', to: 'Тула' },
        { MAPBOX_ACCESS_TOKEN: marker });
      assert.equal(response.ok, false);
      assert.ok(mocked.mock.callCount() > 0);
    });
    assert.ok(!logs.includes(marker));
  } finally { mocked.mock.restore(); }
});
