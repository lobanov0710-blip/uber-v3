// Populated 20 -> 21 upgrade, actual Worker HTTP and native D1; no remote bindings.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { Miniflare,convertV4MiniflareOptions } from 'miniflare';
import { sqliteD1 } from '../tests/helpers/sqliteD1.mjs';
import { seedModeration,driverId,moderator,fixturePassword } from '../tests/helpers/adminModerationScenario.mjs';
import { getCurrentVehicleRuleBinding as binding } from '../src/core/vehicleRuleBindingRepository.js';
import { resolveAdminAccess,adminCan } from '../src/core/adminAuthorization.js';
const bundle=await build({entryPoints:[new URL('../src/index.js',import.meta.url).pathname],bundle:true,
  write:false,format:'esm',target:'es2022',platform:'browser'});
const local=sqliteD1({throughMigration:20});
const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'rule-binding',modules:true,
  script:bundle.outputFiles[0].text,bindings:{JWT_SECRET:'synthetic-binding-jwt-01234567890123456789'},
  d1Databases:['DB'],compatibilityDate:'2026-08-20'}]}));
try {
  const DB=await mf.getD1Database('DB','rule-binding');
  for(const type of ['table','index','trigger'])for(const row of local.sqlite.prepare("SELECT sql FROM sqlite_master WHERE type=? AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all(type))await DB.prepare(row.sql).run();
  await seedModeration(DB);
  await DB.prepare("INSERT INTO staff_permissions VALUES(?1,' VEHICLES.APPROVE_EXCEPTION ',?1,1)").bind(moderator).run();
  const send=async(method,path,body,token)=>{
    const response=await mf.dispatchFetch('https://fixture.invalid'+path,{method,
      headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},
      ...(body?{body:JSON.stringify(body)}:{})});
    return {status:response.status,body:await response.json()};
  };
  const login=await send('POST','/staff/login',{login:driverId,password:fixturePassword});assert.equal(login.status,200);
  const token=login.body.accessToken,body={vin:'XW8ZZZ61ZFG000001',plate:'SYNTHETIC',make:'Toyota',model:'Camry',modelYear:2020,
    color:'Белый',capacity:4,baggageCapacity:'standard',usageBasis:'owner'};
  const legacy=await send('POST','/v1/driver/vehicles',body,token);assert.equal(legacy.status,201);
  const vehicles=(await DB.prepare('SELECT * FROM vehicles ORDER BY id').all()).results;
  const documents=(await DB.prepare('SELECT * FROM document_resources ORDER BY id').all()).results;
  await DB.prepare("INSERT INTO vehicle_classification_rules VALUES('native_bind_v1','Toyota','Camry',1,2020,'comfort','Synthetic',1)").run();
  await DB.prepare("INSERT INTO vehicle_classification_current_rules VALUES('Toyota','Camry','native_bind_v1')").run();
  const sql=readFileSync(new URL('../migrations/0021_vehicle_rule_bindings.sql',import.meta.url),'utf8');
  const triggers=[...sql.matchAll(/^CREATE TRIGGER[\s\S]*?END;/gm)].map(m=>m[0]);assert.equal(triggers.length,6);
  const ordinary=sql.replace(/^CREATE TRIGGER[\s\S]*?END;/gm,'').replace(/--[^\n]*/g,'').split(';').map(s=>s.trim()).filter(Boolean);
  const statements=[...ordinary,...triggers];
  await assert.rejects(DB.batch([...statements.map(s=>DB.prepare(s)),DB.prepare('SELECT * FROM intentionally_missing_binding_fixture')]));
  assert.equal((await DB.prepare("SELECT name FROM sqlite_master WHERE name='vehicle_classification_bindings'").all()).results.length,0);
  assert.deepEqual((await DB.prepare('SELECT * FROM vehicles ORDER BY id').all()).results,vehicles);
  await DB.batch(statements.map(s=>DB.prepare(s)));
  assert.deepEqual((await DB.prepare('SELECT * FROM vehicles ORDER BY id').all()).results,vehicles);
  assert.deepEqual((await DB.prepare('SELECT * FROM document_resources ORDER BY id').all()).results,documents);
  assert.deepEqual((await DB.prepare('PRAGMA foreign_key_check').all()).results,[]);
  assert.equal(await binding({DB},driverId,legacy.body.vehicle.id),null);
  const first=await send('POST','/v1/driver/vehicles',body,token);assert.equal(first.status,201);const id=first.body.vehicle.id;
  assert.equal(first.body.vehicle.vehicleClass,null);assert.equal((await binding({DB},driverId,id)).ruleVersion,'native_bind_v1');
  await DB.prepare("INSERT INTO vehicle_classification_rules VALUES('native_bind_v2','Toyota','Camry',2,2023,'comfort','Synthetic',2)").run();
  await DB.prepare("UPDATE vehicle_classification_current_rules SET rule_version='native_bind_v2' WHERE make='Toyota' AND model='Camry'").run();
  assert.equal((await send('PATCH','/v1/driver/vehicles/'+id,{color:'Blue',expectedRevision:1},token)).status,200);
  assert.equal((await binding({DB},driverId,id)).ruleVersion,'native_bind_v1');
  const second=await send('POST','/v1/driver/vehicles',body,token);assert.equal(second.status,201);
  assert.equal((await binding({DB},driverId,second.body.vehicle.id)).ruleVersion,'native_bind_v2');
  assert.equal((await send('PATCH','/v1/driver/vehicles/'+id,{modelYear:2021,expectedRevision:2},token)).status,200);
  const changed=await binding({DB},driverId,id);assert.equal(changed.ruleVersion,'native_bind_v2');assert.equal(changed.inputRevision,2);
  await DB.prepare("CREATE TRIGGER fail_binding_audit BEFORE INSERT ON audit_events WHEN NEW.action='driver.vehicle_reverification_required' BEGIN SELECT RAISE(ABORT,'PRIVATE_BINDING_SQL'); END").run();
  const failed=await send('PATCH','/v1/driver/vehicles/'+id,{modelYear:2022,expectedRevision:3},token);
  assert.equal(failed.status,500);assert.ok(!JSON.stringify(failed.body).includes('PRIVATE_BINDING_SQL'));
  assert.deepEqual(await binding({DB},driverId,id),changed);
  for(const permission of ['vehicle_rules.manage','\u00a0VEHICLES.APPROVE_EXCEPTION\ufeff'])await assert.rejects(DB.prepare('INSERT INTO staff_permissions VALUES(?1,?2,?1,1)').bind(moderator,permission).run());
  const access=await resolveAdminAccess({DB},{id:moderator,role:'admin'});
  assert.equal(adminCan(access,'vehicles.approve_exception'),false);assert.ok(!access.permissions.includes('vehicles.approve_exception'));
  assert.equal(adminCan(access,'vehicles.verify'),true);
  await assert.rejects(DB.prepare('DELETE FROM vehicle_classification_bindings WHERE vehicle_id=?1').bind(id).run());
  console.log(JSON.stringify({engine:'native local workerd HTTP/D1',ruleBinding:'PASS',populatedUpgradePreserved:true,
    failedUpgradeRolledBack:true,pinAtFirstSave:true,unrelatedEditKeepsVersion:true,explicitYearUsesCurrent:true,
    bindingAuditRollback:true,dispatcherPowersDenied:true,legacyErroneousGrantsIgnored:true}));
} finally {local.sqlite.close();await mf.dispose();}
