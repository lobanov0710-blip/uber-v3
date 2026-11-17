import test from 'node:test';
import assert from 'node:assert/strict';
import { sqliteD1 } from './helpers/sqliteD1.mjs';
import { seedModeration, driverId } from './helpers/adminModerationScenario.mjs';
import { captureCurrentVehicleClassification as capture, getVehicleClassificationSnapshot as snapshot } from '../src/core/vehicleClassificationRepository.js';

const vehicleId = 'vehicle_fixture001';
const input = { vehicleId, expectedVehicleRevision: 1, year: 2020, powertrain: 'hybrid', powertrainVerified: true, now: 10 };
async function setup(t) {
  const DB = sqliteD1(); t.after(() => DB.sqlite.close()); await seedModeration(DB);
  DB.sqlite.prepare("UPDATE vehicles SET make='Toyota', model='Camry', status='approved' WHERE id=?").run(vehicleId);
  DB.sqlite.exec("INSERT INTO vehicle_classification_rules VALUES('rule_v1','Toyota','Camry',1,2020,'comfort','Synthetic condition',1)");
  DB.sqlite.exec("INSERT INTO vehicle_classification_current_rules VALUES('Toyota','Camry','rule_v1')");
  return { DB };
}
function publish2(DB) {
  DB.sqlite.exec("INSERT INTO vehicle_classification_rules VALUES('rule_v2','Toyota','Camry',2,2022,'business','Synthetic updated condition',2)");
  DB.sqlite.exec("UPDATE vehicle_classification_current_rules SET rule_version='rule_v2' WHERE make='Toyota' AND model='Camry'");
}
function addVehicle(DB) {
  DB.sqlite.prepare(`INSERT INTO vehicles(id,driver_id,vin,plate,make,model,class,capacity,status,created_at,updated_at)
    VALUES('vehicle_fixture002',?,'TESTVIN0000000002','TEST','Toyota','Camry','comfort',4,'draft',1,1)`).run(driverId);
}

test('new migration adds no rule or snapshot and does not reclassify an existing approved vehicle', async t => {
  const env = await setup(t); const { DB } = env;
  assert.equal(DB.sqlite.prepare('SELECT count(*) n FROM vehicle_classification_snapshots').get().n, 0);
  assert.deepEqual({ ...DB.sqlite.prepare('SELECT class,status,revision FROM vehicles WHERE id=?').get(vehicleId) },
    { class: 'comfort', status: 'approved', revision: 1 });
});

test('new registrations use current rule while earlier snapshots and vehicle status remain unchanged', async t => {
  const env = await setup(t); const { DB } = env;
  assert.equal((await capture(env, input)).ruleVersion, 'rule_v1');
  publish2(DB); addVehicle(DB);
  assert.equal((await capture(env, { ...input, vehicleId: 'vehicle_fixture002', year: 2023 })).ruleVersion, 'rule_v2');
  assert.equal((await snapshot(env, vehicleId, 1)).vehicleClass, 'comfort');
  assert.equal((await snapshot(env, 'vehicle_fixture002', 1)).vehicleClass, 'business');
  assert.equal((await capture(env, input)).code, 'classification_snapshot_conflict');
  assert.deepEqual({ ...DB.sqlite.prepare('SELECT class,status,revision FROM vehicles WHERE id=?').get(vehicleId) },
    { class: 'comfort', status: 'approved', revision: 1 });
});

test('explicit changes to an existing vehicle use the current version and preserve its old snapshot', async t => {
  const env = await setup(t); await capture(env, input); publish2(env.DB);
  env.DB.sqlite.exec("UPDATE vehicles SET revision=2 WHERE id='vehicle_fixture001'");
  const result = await capture(env, { ...input, expectedVehicleRevision: 2, year: 2023 });
  assert.equal(result.ruleVersion, 'rule_v2'); assert.equal(result.vehicleClass, 'business');
  assert.equal((await snapshot(env, vehicleId, 1)).ruleVersion, 'rule_v1');
  assert.equal((await snapshot(env, vehicleId, 2)).ruleVersion, 'rule_v2');
});

test('manual review and BEV exclusion are stored without a fabricated class', async t => {
  const env = await setup(t);
  for (const [revision, patch, outcome, reason] of [
    [1, { year: 2019 }, 'manual_review', 'year_below_minimum'],
    [2, { powertrainVerified: false }, 'manual_review', 'powertrain_unverified'],
    [3, { powertrain: 'battery_electric' }, 'excluded', 'battery_electric']
  ]) {
    env.DB.sqlite.prepare('UPDATE vehicles SET revision=? WHERE id=?').run(revision, vehicleId);
    assert.equal((await capture(env, { ...input, ...patch, expectedVehicleRevision: revision })).outcome, outcome);
    const saved = await snapshot(env, vehicleId, revision);
    assert.equal(saved.vehicleClass, null); assert.equal(saved.reason, reason);
  }
});

test('unknown model cannot acquire a class supplied by the caller', async t => {
  const env = await setup(t);
  env.DB.sqlite.exec("UPDATE vehicles SET model='Unknown' WHERE id='vehicle_fixture001'");
  assert.equal((await capture(env, { ...input, model: 'Camry', vehicleClass: 'business' })).reason, 'model_not_found');
  assert.equal((await snapshot(env, vehicleId, 1)).vehicleClass, null);
});

function raceOnInsert(DB, race) {
  const prepare = DB.prepare.bind(DB);
  DB.prepare = sql => {
    const statement = prepare(sql);
    if (sql.startsWith('INSERT INTO vehicle_classification_snapshots')) {
      const run = statement.run;
      statement.run = async function () { race(); return run.call(this); };
    }
    return statement;
  };
}
test('rule changed between read and insert cannot persist a stale classification', async t => {
  const env = await setup(t); raceOnInsert(env.DB, () => publish2(env.DB));
  assert.equal((await capture(env, input)).code, 'classification_snapshot_conflict');
  assert.equal(await snapshot(env, vehicleId, 1), null);
});
test('a newly added model between lookup and insert cannot persist model_not_found', async t => {
  const env = await setup(t);
  env.DB.sqlite.exec("DELETE FROM vehicle_classification_current_rules");
  raceOnInsert(env.DB, () => env.DB.sqlite.exec("INSERT INTO vehicle_classification_current_rules VALUES('Toyota','Camry','rule_v1')"));
  assert.equal((await capture(env, input)).code, 'classification_snapshot_conflict');
  assert.equal(await snapshot(env, vehicleId, 1), null);
});
test('vehicle revision changed between read and insert cannot save a stale result', async t => {
  const env = await setup(t);
  raceOnInsert(env.DB, () => env.DB.sqlite.exec("UPDATE vehicles SET revision=2 WHERE id='vehicle_fixture001'"));
  assert.equal((await capture(env, input)).code, 'classification_snapshot_conflict');
  assert.equal(await snapshot(env, vehicleId, 1), null);
});
test('stale revision, malformed IDs and invalid years do not create records', async t => {
  const env = await setup(t);
  for (const [patch, code] of [[{ expectedVehicleRevision: 2 }, 'vehicle_revision_conflict'],
    [{ vehicleId: 'bad' }, 'invalid_classification_input'], [{ year: '2020' }, 'invalid_input'],
    [{ expectedVehicleRevision: Number.MAX_SAFE_INTEGER + 1 }, 'invalid_classification_input']]) {
    assert.equal((await capture(env, { ...input, ...patch })).code, code);
  }
  assert.equal(env.DB.sqlite.prepare('SELECT count(*) n FROM vehicle_classification_snapshots').get().n, 0);
});
test('rule and snapshot history cannot be edited, deleted or rebound to another model', async t => {
  const env = await setup(t); await capture(env, input);
  for (const sql of ["UPDATE vehicle_classification_rules SET class='business'",
    "DELETE FROM vehicle_classification_rules", "UPDATE vehicle_classification_snapshots SET class='business'",
    "DELETE FROM vehicle_classification_snapshots", "UPDATE vehicle_classification_current_rules SET model='Other'"]) {
    assert.throws(() => env.DB.sqlite.exec(sql));
  }
  assert.equal((await snapshot(env, vehicleId, 1)).vehicleClass, 'comfort');
});
test('SQL constraints reject null manual-review reasons and BEV class candidates', async t => {
  const env = await setup(t);
  const sql = `INSERT INTO vehicle_classification_snapshots
    (vehicle_id,vehicle_revision,make,model,model_year,powertrain,powertrain_verified,rule_version,outcome,class,reason,created_at)
    VALUES(?1,1,'Toyota','Camry',2020,?2,1,'rule_v1',?3,?4,NULL,10)`;
  assert.throws(() => env.DB.sqlite.prepare(sql).run(vehicleId, 'hybrid', 'manual_review', null));
  assert.throws(() => env.DB.sqlite.prepare(sql).run(vehicleId, 'battery_electric', 'candidate', 'comfort'));
});

test('SQL constraints reject fractional years, revisions and candidate classes inconsistent with the rule', async t => {
  const env = await setup(t);
  assert.throws(() => env.DB.sqlite.exec("INSERT INTO vehicle_classification_rules VALUES('bad','Toyota','Camry',2,2020.5,'comfort','',1)"));
  assert.throws(() => env.DB.sqlite.exec("INSERT INTO vehicle_classification_rules VALUES('bad','Toyota','Camry',1.5,2020,'comfort','',1)"));
  for (const [modelYear, vehicleClass] of [[2020, 'business'], [2019, 'comfort'], [2020.5, 'comfort']]) {
    assert.throws(() => env.DB.sqlite.prepare(`INSERT INTO vehicle_classification_snapshots
      (vehicle_id,vehicle_revision,make,model,model_year,powertrain,powertrain_verified,rule_version,outcome,class,created_at)
      VALUES(?1,1,'Toyota','Camry',?2,'hybrid',1,'rule_v1','candidate',?3,10)`).run(vehicleId, modelYear, vehicleClass));
  }
});
