// Real local D1 storage, including immutable-history triggers; synthetic data only.
import assert from 'node:assert/strict';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { sqliteD1 } from '../tests/helpers/sqliteD1.mjs';
import { seedModeration } from '../tests/helpers/adminModerationScenario.mjs';
import { captureCurrentVehicleClassification as capture, getVehicleClassificationSnapshot as snapshot } from '../src/core/vehicleClassificationRepository.js';

const local = sqliteD1();
const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: 'classifier-store-audit',
  modules: true, script: 'export default {fetch(){return new Response("synthetic")}}',
  d1Databases: ['DB'], compatibilityDate: '2026-08-20' }] }));
try {
  const DB = await mf.getD1Database('DB', 'classifier-store-audit');
  for (const type of ['table', 'index', 'trigger']) {
    for (const row of local.sqlite.prepare("SELECT sql FROM sqlite_master WHERE type=? AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all(type)) {
      await DB.prepare(row.sql).run();
    }
  }
  await seedModeration(DB);
  await DB.prepare("UPDATE vehicles SET make='Toyota', model='Camry' WHERE id='vehicle_fixture001'").run();
  await DB.prepare("INSERT INTO vehicle_classification_rules VALUES('native_v1','Toyota','Camry',1,2020,'comfort','Synthetic',1)").run();
  await DB.prepare("INSERT INTO vehicle_classification_current_rules VALUES('Toyota','Camry','native_v1')").run();
  const env = { DB }, input = { vehicleId: 'vehicle_fixture001', expectedVehicleRevision: 1, year: 2020,
    powertrain: 'hybrid', powertrainVerified: true, now: 10 };
  assert.equal((await capture(env, input)).ruleVersion, 'native_v1');
  await DB.prepare("INSERT INTO vehicle_classification_rules VALUES('native_v2','Toyota','Camry',2,2022,'business','Synthetic',2)").run();
  await DB.prepare("UPDATE vehicle_classification_current_rules SET rule_version='native_v2'").run();
  assert.equal((await snapshot(env, input.vehicleId, 1)).ruleVersion, 'native_v1');
  assert.equal((await capture(env, input)).code, 'classification_snapshot_conflict');
  await DB.prepare("UPDATE vehicles SET revision=2 WHERE id='vehicle_fixture001'").run();
  assert.equal((await capture(env, { ...input, expectedVehicleRevision: 2, year: 2023 })).ruleVersion, 'native_v2');
  await DB.prepare("UPDATE vehicles SET revision=3 WHERE id='vehicle_fixture001'").run();
  assert.equal((await capture(env, { ...input, expectedVehicleRevision: 3, powertrain: 'battery_electric' })).outcome, 'excluded');
  for (const sql of ["UPDATE vehicle_classification_rules SET class='minivan'", "DELETE FROM vehicle_classification_snapshots"]) {
    await assert.rejects(DB.prepare(sql).run());
  }
  const racingDB = { prepare(sql) {
    const statement = DB.prepare(sql);
    if (!sql.startsWith('INSERT INTO vehicle_classification_snapshots')) return statement;
    return { bind(...args) {
      const bound = statement.bind(...args);
      return { async run() {
        await DB.prepare("UPDATE vehicles SET revision=5 WHERE id='vehicle_fixture001'").run();
        return bound.run();
      } };
    } };
  } };
  await DB.prepare("UPDATE vehicles SET revision=4 WHERE id='vehicle_fixture001'").run();
  assert.equal((await capture({ DB: racingDB }, { ...input, expectedVehicleRevision: 4, year: 2023 })).code, 'classification_snapshot_conflict');
  assert.equal(await snapshot(env, input.vehicleId, 4), null);
  console.log(JSON.stringify({ engine: 'native local workerd/D1', classificationStore: 'PASS',
    historyImmutable: true, explicitEditUsesCurrentRule: true, batteryElectricExcluded: true, staleRevisionBlocked: true }));
} finally {
  local.sqlite.close();
  await mf.dispose();
}
