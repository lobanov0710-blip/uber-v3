// Generates local deployment inputs. No provider command or network call.
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { issuePassengerOrderAccess } from '../../src/core/passengerOrderAccess.js';
import { seed, transitions, orderId } from './synthetic-order.mjs';

const [folder, origin, databaseId] = process.argv.slice(2);
const protectedIds = ['c1d490e4-68f0-4f78-8f53-7d10df7c3395', '66474481-a123-47f9-81b4-12af7565ec8d'];
if (process.argv.length !== 5 || !folder
    || !/^https:\/\/uber-v3-tz02-qa\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.workers\.dev$/.test(origin ?? '')
    || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(databaseId ?? '')
    || protectedIds.includes(databaseId)) {
  throw new Error('Expected a new private directory, approved QA Worker origin and new QA D1 ID');
}
mkdirSync(folder, { mode: 0o700 });
const write = (name, content) => writeFileSync(join(folder, name), content, { flag: 'wx', mode: 0o600 });
const secret = () => randomBytes(32).toString('hex');
const hmac = secret();
const accessSecret = secret();
const fixtureDate = new Date().toISOString().slice(0, 10);
const statements = await seed(Date.now(), fixtureDate);
const token = await issuePassengerOrderAccess({ PASSENGER_ORDER_SECRET: accessSecret }, {
  id: orderId, date: fixtureDate, createdAt: Date.now()
});
const config = {
  name: 'uber-v3-tz02-qa', main: fileURLToPath(new URL('./worker.js', import.meta.url)),
  compatibility_date: '2026-06-01',
  workers_dev: true, preview_urls: false,
  vars: { APP_ENV: 'staging', PASSENGER_ASSIGNMENT_V2_ENABLED: 'true', TZ02_QA_WORKER_ORIGIN: origin },
  d1_databases: [{ binding: 'DB', database_name: 'transfer-servis52-tz02-qa', database_id: databaseId,
    migrations_dir: fileURLToPath(new URL('../../migrations', import.meta.url)) }]
};
write('wrangler.tz02-qa.json', JSON.stringify(config, null, 2) + '\n');
write('worker-secrets.private.json', JSON.stringify({ PROXY_HMAC_SECRET: hmac,
  PASSENGER_ORDER_SECRET: accessSecret }, null, 2) + '\n');
write('staging-hmac.key', hmac + '\n');
write('staging-access.key', secret() + '\n');
write('passenger-qa-upstream.txt', origin + '\n');
write('passenger-session.private.json', JSON.stringify({ orderId, ...token }, null, 2) + '\n');
write('00-seed.sql', statements.join('\n') + '\n');
for (const [step, statements] of Object.entries(transitions)) write(`${step}.sql`, statements.join('\n') + '\n');
console.log('Prepared local QA inputs. Keep credentials private.');
