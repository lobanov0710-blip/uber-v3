import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import router from '../src/router.js';
import { sqliteD1 } from './helpers/sqliteD1.mjs';
import { seedModeration,driverId,moderator,fixturePassword } from './helpers/adminModerationScenario.mjs';
import { loginStaff } from '../src/core/staffAuthService.js';
import { adminCan,resolveAdminAccess } from '../src/core/adminAuthorization.js';
import { getCurrentVehicleRuleBinding as binding } from '../src/core/vehicleRuleBindingRepository.js';

const migration=readFileSync(new URL('../migrations/0021_vehicle_rule_bindings.sql',import.meta.url),'utf8');
const vehicleBody={vin:'XW8ZZZ61ZFG000001',plate:'SYNTHETIC',make:'Toyota',model:'Camry',modelYear:2020,
  color:null,capacity:4,baggageCapacity:'standard',usageBasis:'owner'};
async function setup(t,throughMigration=Infinity){
  const DB=sqliteD1({throughMigration});t.after(()=>DB.sqlite.close());await seedModeration(DB);
  const env={DB,JWT_SECRET:'synthetic-rule-binding-jwt-01234567890123456789'};
  const login=await loginStaff(env,{login:driverId,password:fixturePassword});assert.equal(login.ok,true);
  const send=async(method,path,body)=>{
    const response=await router(new Request('https://fixture.invalid'+path,{method,
      headers:{Authorization:'Bearer '+login.accessToken,'Content-Type':'application/json'},
      ...(body?{body:JSON.stringify(body)}:{})}),env,{});
    return {status:response.status,body:await response.json()};
  };
  const create=async()=>{const r=await send('POST','/v1/driver/vehicles',vehicleBody);assert.equal(r.status,201);return r.body.vehicle;};
  return {DB,env,send,create};
}
function rule(DB,version,minYear=2020){
  DB.sqlite.prepare("INSERT INTO vehicle_classification_rules VALUES(?,'Toyota','Camry',?,?,'comfort','Synthetic condition',1)")
    .run(version,Number(version.at(-1)),minYear);
  DB.sqlite.prepare("INSERT INTO vehicle_classification_current_rules VALUES('Toyota','Camry',?) ON CONFLICT(make,model) DO UPDATE SET rule_version=excluded.rule_version").run(version);
}
function oldRows(DB){return Object.fromEntries(DB.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
  .map(({name})=>[name,DB.sqlite.prepare('SELECT * FROM "'+name+'"').all().map(r=>({...r}))]));}

test('populated upgrade preserves every old table and leaves legacy bindings absent',async t=>{
  const {DB,env}=await setup(t,20);rule(DB,'rule_v1');const before=oldRows(DB);
  DB.sqlite.exec(migration);
  for(const [table,rows] of Object.entries(before))assert.deepEqual(DB.sqlite.prepare('SELECT * FROM "'+table+'"').all().map(r=>({...r})),rows);
  assert.equal(await binding(env,driverId,'vehicle_fixture001'),null);
  assert.deepEqual(DB.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.equal(DB.sqlite.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
});
test('failed upgrade transaction restores schema and populated data',async t=>{
  const {DB}=await setup(t,20);const before=oldRows(DB);DB.sqlite.exec('BEGIN IMMEDIATE');
  assert.throws(()=>DB.sqlite.exec(migration+'\nINSERT INTO missing_synthetic_table VALUES(1);'));DB.sqlite.exec('ROLLBACK');
  assert.deepEqual(oldRows(DB),before);assert.equal(DB.sqlite.prepare("SELECT name FROM sqlite_master WHERE name='vehicle_classification_bindings'").get(),undefined);
});
test('first actual HTTP save pins current version without assigning class or approval',async t=>{
  const {DB,env,create}=await setup(t);rule(DB,'rule_v1');const car=await create();
  const b=await binding(env,driverId,car.id);assert.equal(b.ruleVersion,'rule_v1');assert.equal(b.inputRevision,1);
  assert.equal(b.sourceVehicleRevision,1);assert.equal(b.modelYear,2020);assert.equal(car.vehicleClass,null);assert.equal(car.status,'draft');
  assert.ok(!JSON.stringify(b).includes(vehicleBody.vin));assert.ok(!JSON.stringify(b).includes(vehicleBody.plate));
});
test('rule update alone does not change old pin; a new registration gets new version',async t=>{
  const {DB,env,create}=await setup(t);rule(DB,'rule_v1');const first=await create();rule(DB,'rule_v2',2023);
  const second=await create();assert.equal((await binding(env,driverId,first.id)).ruleVersion,'rule_v1');
  assert.equal((await binding(env,driverId,second.id)).ruleVersion,'rule_v2');
});
test('color, status, photos metadata and no-op inputs retain original binding',async t=>{
  const {DB,env,send,create}=await setup(t);rule(DB,'rule_v1');const car=await create();rule(DB,'rule_v2');
  assert.equal((await send('PATCH','/v1/driver/vehicles/'+car.id,{color:'Blue',make:'Toyota',modelYear:2020,expectedRevision:1})).status,200);
  DB.sqlite.prepare("UPDATE vehicles SET status='pending_review',last_photo_check_passed_at=2,revision=revision+1 WHERE id=?").run(car.id);
  const b=await binding(env,driverId,car.id);assert.equal(b.inputRevision,1);assert.equal(b.ruleVersion,'rule_v1');
});
test('explicit year edit uses current version and preserves old binding history',async t=>{
  const {DB,env,send,create}=await setup(t);rule(DB,'rule_v1');const car=await create();rule(DB,'rule_v2');
  const changed=await send('PATCH','/v1/driver/vehicles/'+car.id,{modelYear:2021,expectedRevision:1});assert.equal(changed.status,200);
  const b=await binding(env,driverId,car.id);assert.equal(b.ruleVersion,'rule_v2');assert.equal(b.inputRevision,2);assert.equal(b.sourceVehicleRevision,2);
  assert.equal(DB.sqlite.prepare('SELECT rule_version FROM vehicle_classification_bindings WHERE vehicle_id=? AND input_revision=1').get(car.id).rule_version,'rule_v1');
});
test('explicit make and model edits each capture their matching current rule',async t=>{
  const {DB,env,send,create}=await setup(t);rule(DB,'rule_v1');const a=await create(),b=await create();
  for(const [make,model,version] of [['Other','Camry','rule_other'],['Toyota','Corolla','rule_corolla']]){
    DB.sqlite.prepare("INSERT INTO vehicle_classification_rules VALUES(?,?,?,1,2020,'comfort','',1)").run(version,make,model);
    DB.sqlite.prepare('INSERT INTO vehicle_classification_current_rules VALUES(?,?,?)').run(make,model,version);
  }
  assert.equal((await send('PATCH','/v1/driver/vehicles/'+a.id,{make:'Other',expectedRevision:1})).status,200);
  assert.equal((await binding(env,driverId,a.id)).ruleVersion,'rule_other');
  assert.equal((await send('PATCH','/v1/driver/vehicles/'+b.id,{model:'Corolla',expectedRevision:1})).status,200);
  assert.equal((await binding(env,driverId,b.id)).ruleVersion,'rule_corolla');
});
test('unknown model stays pinned to missing rule until an explicit key-data edit',async t=>{
  const {DB,env,send,create}=await setup(t);const car=await create();assert.equal((await binding(env,driverId,car.id)).ruleVersion,null);
  rule(DB,'rule_v1');assert.equal((await binding(env,driverId,car.id)).ruleVersion,null);
  assert.equal((await send('PATCH','/v1/driver/vehicles/'+car.id,{modelYear:2021,expectedRevision:1})).status,200);
  assert.equal((await binding(env,driverId,car.id)).ruleVersion,'rule_v1');
});
test('legacy color edit does not invent history; explicit year edit creates first current binding',async t=>{
  const {DB,env,send,create}=await setup(t,20);const car=await create();
  DB.sqlite.prepare('UPDATE vehicles SET model_year=NULL WHERE id=?').run(car.id);
  DB.sqlite.exec(migration);
  assert.equal((await send('PATCH','/v1/driver/vehicles/'+car.id,{color:'Blue',expectedRevision:1})).status,200);
  assert.equal(await binding(env,driverId,car.id),null);
  assert.equal((await send('PATCH','/v1/driver/vehicles/'+car.id,{modelYear:2020,expectedRevision:2})).status,200);
  assert.equal((await binding(env,driverId,car.id)).inputRevision,1);
});
test('audit failure rolls back both changed vehicle and trigger-created binding',async t=>{
  const {DB,env,send,create}=await setup(t);rule(DB,'rule_v1');const car=await create();rule(DB,'rule_v2');
  DB.sqlite.exec("CREATE TRIGGER fail_binding_audit BEFORE INSERT ON audit_events WHEN NEW.action='driver.vehicle_reverification_required' BEGIN SELECT RAISE(ABORT,'PRIVATE_SYNTHETIC_SQL'); END");
  const r=await send('PATCH','/v1/driver/vehicles/'+car.id,{modelYear:2021,expectedRevision:1});assert.equal(r.status,500);
  assert.ok(!JSON.stringify(r.body).includes('PRIVATE_SYNTHETIC_SQL'));
  assert.equal((await binding(env,driverId,car.id)).inputRevision,1);assert.equal((await binding(env,driverId,car.id)).ruleVersion,'rule_v1');
  assert.equal(DB.sqlite.prepare('SELECT model_year FROM vehicles WHERE id=?').get(car.id).model_year,2020);
});
test('binding insert failure prevents vehicle creation; no partial vehicle row',async t=>{
  const {DB,send}=await setup(t);const before=DB.sqlite.prepare('SELECT count(*) n FROM vehicles').get().n;
  DB.sqlite.exec("CREATE TRIGGER fail_binding BEFORE INSERT ON vehicle_classification_bindings BEGIN SELECT RAISE(ABORT,'PRIVATE_BINDING_FAILURE'); END");
  const r=await send('POST','/v1/driver/vehicles',vehicleBody);assert.equal(r.status,409);assert.ok(!JSON.stringify(r.body).includes('PRIVATE_BINDING_FAILURE'));
  assert.equal(DB.sqlite.prepare('SELECT count(*) n FROM vehicles').get().n,before);
});
test('history cannot be changed or rebound to another model; foreign driver has no read',async t=>{
  const {DB,env,create}=await setup(t);rule(DB,'rule_v1');const car=await create();
  assert.equal(await binding(env,'staff_foreign123',car.id),null);
  assert.throws(()=>DB.sqlite.prepare("UPDATE vehicle_classification_bindings SET rule_version=NULL WHERE vehicle_id=?").run(car.id));
  assert.throws(()=>DB.sqlite.prepare('DELETE FROM vehicle_classification_bindings WHERE vehicle_id=?').run(car.id));
  assert.throws(()=>DB.sqlite.prepare("INSERT INTO vehicle_classification_bindings VALUES(?,2,2,'Other','Model',2020,'rule_v1',1)").run(car.id));
});
test('stale write does not append binding history',async t=>{
  const {DB,env,send,create}=await setup(t);const car=await create();
  assert.equal((await send('PATCH','/v1/driver/vehicles/'+car.id,{modelYear:2021,expectedRevision:99})).status,409);
  assert.equal((await binding(env,driverId,car.id)).inputRevision,1);
});
test('D1 trigger-inclusive meta changes cannot turn a committed single vehicle write into a false error',async t=>{
  const {DB,send,create}=await setup(t);const batch=DB.batch.bind(DB);
  DB.batch=async statements=>{
    const results=await batch(statements);
    for(let i=0;i<statements.length;i++)if(/(?:INSERT INTO|UPDATE) vehicles/.test(statements[i].sql))results[i].meta.changes+=10;
    return results;
  };
  const car=await create();
  const patched=await send('PATCH','/v1/driver/vehicles/'+car.id,{modelYear:2021,expectedRevision:1});
  assert.equal(patched.status,200);assert.equal(patched.body.vehicle.revision,2);
});
test('SQL denies new dispatcher permission grants and updates, including case/space forms',async t=>{
  const {DB}=await setup(t);
  for(const permission of ['vehicle_rules.manage','vehicles.approve_exception',' VEHICLE_RULES.MANAGE ','\tVEHICLE_RULES.MANAGE\n','\u00a0vehicles.approve_exception\ufeff']){
    assert.throws(()=>DB.sqlite.prepare('INSERT INTO staff_permissions VALUES(?,?,?,1)').run(moderator,permission,moderator));
    assert.throws(()=>DB.sqlite.prepare("UPDATE staff_permissions SET permission=? WHERE account_id=? AND permission='vehicles.verify'").run(permission,moderator));
  }
  assert.equal(DB.sqlite.prepare("SELECT count(*) n FROM staff_permissions WHERE account_id=? AND permission='vehicles.verify'").get(moderator).n,1);
});
test('legacy erroneous dispatcher grants are filtered and cannot authorize even a forged access object',async t=>{
  const {DB,env}=await setup(t,20);
  DB.sqlite.prepare('INSERT INTO staff_permissions VALUES(?,?,?,1)').run(moderator,' VEHICLES.APPROVE_EXCEPTION ',moderator);
  DB.sqlite.exec(migration);const access=await resolveAdminAccess(env,{id:moderator,role:'admin'});
  assert.equal(access.isOwner,false);assert.ok(!access.permissions.includes('vehicles.approve_exception'));
  assert.equal(adminCan(access,'vehicles.verify'),true);
  for(const permission of ['vehicle_rules.manage','vehicles.approve_exception'])assert.equal(adminCan({ok:true,isOwner:false,permissions:[permission]},permission),false);
});
test('actual OWNER retains protected permissions; transferring owner cannot empower old grant holder',async t=>{
  const {DB,env}=await setup(t);DB.sqlite.prepare('INSERT INTO staff_owner_binding(singleton,account_id,created_at) VALUES(1,?,1)').run(moderator);
  DB.sqlite.prepare('INSERT INTO staff_permissions VALUES(?,?,?,1)').run(moderator,'vehicle_rules.manage',moderator);
  const owner=await resolveAdminAccess(env,{id:moderator,role:'admin'});assert.equal(owner.isOwner,true);assert.equal(adminCan(owner,'vehicle_rules.manage'),true);
  DB.sqlite.exec('DELETE FROM staff_owner_binding');const previous=await resolveAdminAccess(env,{id:moderator,role:'admin'});
  assert.equal(adminCan(previous,'vehicle_rules.manage'),false);assert.ok(!previous.permissions.includes('vehicle_rules.manage'));
});
