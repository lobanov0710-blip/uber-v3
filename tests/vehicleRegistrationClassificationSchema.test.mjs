import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { sqliteD1 } from './helpers/sqliteD1.mjs';
import { seedModeration, driverId, moderator, fixturePassword } from './helpers/adminModerationScenario.mjs';
import router from '../src/router.js';
import { loginStaff } from '../src/core/staffAuthService.js';
import { captureCurrentVehicleClassification } from '../src/core/vehicleClassificationRepository.js';
import { getDriverVehicle, insertDriverVehicle, getDriverVehicleClassificationDetails as details } from '../src/core/driverRegistrationRepository.js';
const migration = readFileSync(new URL('../migrations/0020_vehicle_registration_classification_fields.sql', import.meta.url), 'utf8');
const vehicleId = 'vehicle_fixture001';
async function oldDatabase(t) {
  const DB = sqliteD1({ throughMigration: 19 }); t.after(() => DB.sqlite.close()); await seedModeration(DB);
  DB.sqlite.exec("UPDATE vehicles SET make='Toyota',model='Camry',status='approved' WHERE id='vehicle_fixture001'");
  DB.sqlite.exec("INSERT INTO vehicle_classification_rules VALUES('schema_rule1','Toyota','Camry',1,2020,'comfort','Synthetic',1)");
  DB.sqlite.exec("INSERT INTO vehicle_classification_current_rules VALUES('Toyota','Camry','schema_rule1')");
  assert.equal((await captureCurrentVehicleClassification({ DB }, { vehicleId, expectedVehicleRevision: 1, year: 2020,
    powertrain: 'hybrid', powertrainVerified: true, now: 1 })).ok, true);
  DB.sqlite.prepare(`INSERT INTO document_resources(id,owner_driver_id,vehicle_id,kind,private_object_key,status,created_at,updated_at)
    VALUES('document_vehicle001',?,?,'sts_front','synthetic-sts-object','verified',1,1)`).run(driverId, vehicleId);
  DB.sqlite.prepare(`INSERT INTO vehicle_photos(id,vehicle_id,kind,private_object_key,status,created_at,updated_at)
    VALUES('photo_vehicle001',?,'left','synthetic-photo-object','verified',1,1)`).run(vehicleId);
  DB.sqlite.prepare(`INSERT INTO orders(id,name,phone,route,trip_date,status,driver_id,created_at,updated_at)
    VALUES('order_schema001','Synthetic','+79990000000','Synthetic','2030-01-01','taken',?,1,1)`).run(driverId);
  DB.sqlite.prepare(`INSERT INTO order_assignments(id,order_id,driver_id,vehicle_id,state,assigned_by,reason,created_at,phase)
    VALUES('assignment_schema001','order_schema001',?,?,'active',?,'Synthetic',1,'en_route_to_pickup')`).run(driverId, vehicleId, moderator);
  DB.sqlite.prepare(`INSERT INTO vehicle_photo_checks(id,vehicle_id,kind,reason,due_at,grace_until,result,created_at,updated_at,restriction_mode)
    VALUES('photo-check_schema001',?,'manual','Synthetic',1,1,'pending',1,1,'immediate')`).run(vehicleId);
  return DB;
}
function tableContents(DB) {
  return Object.fromEntries(DB.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()
    .filter(r => r.name !== 'vehicles').map(({ name }) => [name, DB.sqlite.prepare('SELECT * FROM "' + name + '" ORDER BY rowid').all()]));
}
function migrate(DB) {
  DB.sqlite.exec('BEGIN');
  try { DB.sqlite.exec(migration); DB.sqlite.exec('COMMIT'); }
  catch (error) { DB.sqlite.exec('ROLLBACK'); throw error; }
}

test('migration preserves all existing vehicles, dependent records and immutable history on a populated database', async t => {
  const DB = await oldDatabase(t), before = tableContents(DB);
  const vehicle = { ...DB.sqlite.prepare('SELECT * FROM vehicles WHERE id=?').get(vehicleId) };
  migrate(DB);
  assert.deepEqual(tableContents(DB), before);
  const migrated = { ...DB.sqlite.prepare('SELECT * FROM vehicles WHERE id=?').get(vehicleId) };
  delete migrated.model_year; delete migrated.powertrain;
  assert.deepEqual(migrated, vehicle);
  assert.equal((await getDriverVehicle({ DB }, driverId, vehicleId)).vehicleClass, 'comfort');
  assert.equal(DB.sqlite.prepare('SELECT model_year FROM vehicles WHERE id=?').get(vehicleId).model_year, null);
  assert.deepEqual(DB.sqlite.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal(DB.sqlite.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.equal(DB.sqlite.prepare("SELECT count(*) n FROM pragma_table_info('vehicles') WHERE name='classification_legacy_class'").get().n, 0);
  assert.throws(() => DB.sqlite.exec('DELETE FROM vehicle_classification_snapshots'));
});

test('repository can create and read a draft without inventing a class', async t => {
  const DB = await oldDatabase(t); migrate(DB);
  const vehicle = await insertDriverVehicle({ DB }, driverId, { id: 'vehicle_unclassified001', vin: 'TESTVIN0000000002',
    plate: 'SYNTHETIC', make: 'Unknown', model: 'Unknown', color: null, capacity: 4,
    baggageCapacity: 'standard', usageBasis: 'owner', createdAt: 2 });
  assert.equal(vehicle.status, 'draft'); assert.equal(vehicle.vehicleClass, null);
  assert.equal((await details({ DB }, driverId, vehicle.id)).modelYear, null);
});

test('trusted repository writes declarations and driver reads return the same values without verification claims', async t => {
  const DB = await oldDatabase(t); migrate(DB);
  const vehicle = await insertDriverVehicle({ DB }, driverId, { id: 'vehicle_declared001', vin: 'TESTVIN0000000004',
    plate: 'SYNTHETIC', make: 'Toyota', model: 'Camry', modelYear: 2020, powertrain: 'hybrid',
    capacity: 4, baggageCapacity: 'standard', usageBasis: 'owner', createdAt: 2 });
  assert.equal(vehicle.modelYear, 2020); assert.equal(vehicle.powertrain, 'hybrid');
  assert.equal(vehicle.vehicleClass, null); assert.equal(vehicle.status, 'draft');
  assert.equal(Object.hasOwn(vehicle, 'powertrainVerified'), false);
  assert.equal(Object.hasOwn(vehicle, 'yearVerified'), false);
});

test('authenticated driver me exposes declared year and nullable system class through the existing read route', async t => {
  const DB = await oldDatabase(t); migrate(DB);
  const env = { DB, JWT_SECRET: 'synthetic-registration-schema-jwt-01234567890123456789' };
  await insertDriverVehicle(env, driverId, { id: 'vehicle_http_draft001', vin: 'TESTVIN0000000005',
    plate: 'SYNTHETIC', make: 'Toyota', model: 'Camry', modelYear: 2020, powertrain: 'hybrid',
    capacity: 4, baggageCapacity: 'standard', usageBasis: 'owner', createdAt: 2 });
  const loggedIn = await loginStaff(env, { login: driverId, password: fixturePassword });
  assert.equal(loggedIn.ok, true);
  const response = await router(new Request('https://fixture.invalid/v1/driver/me',
    { headers: { Authorization: 'Bearer ' + loggedIn.accessToken } }), env, {});
  assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const data = await response.json(), draft = data.vehicles.find(v => v.id === 'vehicle_http_draft001');
  assert.equal(draft.vehicleClass, null); assert.equal(draft.modelYear, 2020); assert.equal(draft.powertrain, 'hybrid');
  const denied = await router(new Request('https://fixture.invalid/v1/driver/me'), env, {});
  assert.equal(denied.status, 401);
});

test('unclassified drafts cannot be approved by direct SQL or an older moderation path', async t => {
  const DB = await oldDatabase(t); migrate(DB);
  DB.sqlite.exec("UPDATE vehicles SET status='pending_review',class=NULL WHERE id='vehicle_fixture001'");
  assert.throws(() => DB.sqlite.exec("UPDATE vehicles SET status='approved' WHERE id='vehicle_fixture001'"));
  assert.throws(() => DB.sqlite.prepare(`INSERT INTO vehicles(id,driver_id,vin,plate,make,model,capacity,status,created_at,updated_at)
    VALUES('vehicle_no_class001',?,'TESTVIN0000000003','TEST','Unknown','Unknown',4,'approved',1,1)`).run(driverId));
});

test('metadata reads are bound to the owning driver and contain no VIN or document metadata', async t => {
  const DB = await oldDatabase(t); migrate(DB);
  DB.sqlite.exec("UPDATE vehicles SET model_year=2020,powertrain='hybrid' WHERE id='vehicle_fixture001'");
  const result = await details({ DB }, driverId, vehicleId);
  assert.equal(result.modelYear, 2020); assert.equal(result.powertrain, 'hybrid');
  assert.equal(await details({ DB }, 'staff_otherdriver001', vehicleId), null);
  assert.deepEqual(Object.keys(result).sort(), ['vehicleId','make','model','modelYear','powertrain','vehicleClass','revision'].sort());
});

test('declaration fields reject fractional year and unknown powertrain without changing documents', async t => {
  const DB = await oldDatabase(t); migrate(DB); const before = tableContents(DB);
  for (const sql of ["UPDATE vehicles SET model_year=2020.5", "UPDATE vehicles SET model_year=0",
    "UPDATE vehicles SET powertrain='unknown'", "UPDATE vehicles SET class='economy'"]) {
    assert.throws(() => DB.sqlite.exec(sql));
  }
  assert.deepEqual(tableContents(DB), before);
});

test('failed migration transaction restores the old schema and every linked row', async t => {
  const DB = await oldDatabase(t), before = tableContents(DB);
  const oldVehicle = { ...DB.sqlite.prepare('SELECT * FROM vehicles WHERE id=?').get(vehicleId) };
  DB.sqlite.exec('BEGIN');
  assert.throws(() => DB.sqlite.exec(migration + '\nSELECT * FROM intentionally_missing_schema_fixture;'));
  DB.sqlite.exec('ROLLBACK');
  assert.deepEqual(tableContents(DB), before);
  assert.deepEqual({ ...DB.sqlite.prepare('SELECT * FROM vehicles WHERE id=?').get(vehicleId) }, oldVehicle);
  assert.equal(DB.sqlite.prepare("SELECT count(*) n FROM pragma_table_info('vehicles') WHERE name='model_year'").get().n, 0);
});
