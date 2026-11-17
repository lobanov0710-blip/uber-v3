// Native D1 upgrade of a populated v19 schema, not a recreation of the final tables.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { sqliteD1 } from '../tests/helpers/sqliteD1.mjs';
import { seedModeration, driverId } from '../tests/helpers/adminModerationScenario.mjs';
import { insertDriverVehicle, getDriverVehicleClassificationDetails } from '../src/core/driverRegistrationRepository.js';
import { captureCurrentVehicleClassification, getVehicleClassificationSnapshot } from '../src/core/vehicleClassificationRepository.js';

const local = sqliteD1({ throughMigration: 19 });
const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: 'registration-schema-audit', modules: true,
  script: 'export default {fetch(){return new Response("synthetic")}}', d1Databases: ['DB'], compatibilityDate: '2026-08-20' }] }));
try {
  const DB = await mf.getD1Database('DB', 'registration-schema-audit');
  for (const type of ['table', 'index', 'trigger']) {
    for (const row of local.sqlite.prepare("SELECT sql FROM sqlite_master WHERE type=? AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all(type)) {
      await DB.prepare(row.sql).run();
    }
  }
  await seedModeration(DB);
  await DB.prepare("UPDATE vehicles SET make='Toyota',model='Camry',status='approved' WHERE id='vehicle_fixture001'").run();
  await DB.prepare("INSERT INTO vehicle_classification_rules VALUES('native_upgrade_rule','Toyota','Camry',1,2020,'comfort','Synthetic',1)").run();
  await DB.prepare("INSERT INTO vehicle_classification_current_rules VALUES('Toyota','Camry','native_upgrade_rule')").run();
  assert.equal((await captureCurrentVehicleClassification({ DB }, { vehicleId: 'vehicle_fixture001', expectedVehicleRevision: 1,
    year: 2020, powertrain: 'hybrid', powertrainVerified: true, now: 1 })).ok, true);
  await DB.prepare(`INSERT INTO document_resources(id,owner_driver_id,vehicle_id,kind,private_object_key,status,created_at,updated_at)
    VALUES('document_upgrade001',?1,'vehicle_fixture001','sts_front','synthetic-upgrade-object','verified',1,1)`).bind(driverId).run();
  const original = await DB.prepare("SELECT id,driver_id,vin,plate,make,model,class,capacity,status,revision FROM vehicles WHERE id='vehicle_fixture001'").first();
  const documents = (await DB.prepare('SELECT * FROM document_resources ORDER BY id').all()).results;
  const history = await getVehicleClassificationSnapshot({ DB }, 'vehicle_fixture001', 1);
  const sql = readFileSync(new URL('../migrations/0020_vehicle_registration_classification_fields.sql', import.meta.url), 'utf8');
  // This fixture handles only this migration: its two triggers are last, and
  // all preceding statements are simple ALTER/UPDATE with no string semicolons.
  const triggers = [...sql.matchAll(/^CREATE TRIGGER[\s\S]*?END;/gm)].map(m => m[0]);
  assert.equal(triggers.length, 2);
  const ordinary = sql.replace(/^CREATE TRIGGER[\s\S]*?END;/gm, '').replace(/--[^\n]*/g, '').split(';').map(s => s.trim()).filter(Boolean);
  await DB.batch([...ordinary, ...triggers].map(statement => DB.prepare(statement)));
  assert.deepEqual(await DB.prepare("SELECT id,driver_id,vin,plate,make,model,class,capacity,status,revision FROM vehicles WHERE id='vehicle_fixture001'").first(), original);
  assert.deepEqual((await DB.prepare('SELECT * FROM document_resources ORDER BY id').all()).results, documents);
  assert.deepEqual(await getVehicleClassificationSnapshot({ DB }, 'vehicle_fixture001', 1), history);
  assert.deepEqual((await DB.prepare('PRAGMA foreign_key_check').all()).results, []);
  const draft = await insertDriverVehicle({ DB }, driverId, { id: 'vehicle_upgrade_draft001', vin: 'TESTVIN0000000002',
    plate: 'SYNTHETIC', make: 'Toyota', model: 'Camry', modelYear: 2020, powertrain: 'hybrid',
    capacity: 4, baggageCapacity: 'standard', usageBasis: 'owner', createdAt: 2 });
  assert.equal(draft.vehicleClass, null); assert.equal(draft.modelYear, 2020);
  assert.equal(await getDriverVehicleClassificationDetails({ DB }, 'staff_otherdriver001', draft.id), null);
  await assert.rejects(DB.prepare("UPDATE vehicles SET status='approved' WHERE id=?1").bind(draft.id).run());
  await assert.rejects(DB.prepare('UPDATE vehicle_classification_snapshots SET class=class').run());
  console.log(JSON.stringify({ engine: 'native local workerd/D1', registrationSchemaUpgrade: 'PASS',
    populatedUpgradePreserved: true, unclassifiedDraftSupported: true, ownerBoundRead: true, approvalWithoutClassBlocked: true }));
} finally { local.sqlite.close(); await mf.dispose(); }
