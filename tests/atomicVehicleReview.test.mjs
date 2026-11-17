import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import router from '../src/router.js';
import { sqliteD1 } from './helpers/sqliteD1.mjs';
import { seedRuleActors,ruleSecrets,ruleBody,driverId } from './helpers/adminVehicleRuleScenario.mjs';
import { trustedScenario } from './helpers/trustedAssessmentScenario.mjs';
import { atomicVehicleReviewWorkflow,prepareVehicleApproval } from './helpers/atomicVehicleReviewScenario.mjs';
async function setup(t){
 const DB=sqliteD1();t.after(()=>DB.sqlite.close());await seedRuleActors(DB);const env={DB,...ruleSecrets};
 const send=async(method,path,body,token,key)=>{const r=await router(new Request('https://fixture.invalid'+path,{method,
  headers:{'Content-Type':'application/json','CF-Connecting-IP':'203.0.113.10',...(token?{Authorization:'Bearer '+token}:{}),...(key?{'Idempotency-Key':key}:{})},
  ...(body===undefined?{}:{body:JSON.stringify(body)})}),env,{});return {status:r.status,body:await r.json()};};
 return {DB,env,send};
}
test('old Admin approval requires proof; atomic correction stops and permanently holds an old trip across reapproval',async t=>{
 const {env,send}=await setup(t);await atomicVehicleReviewWorkflow(env,send);
});
test('explicit make/model/year corrections use the current target version and preserve actual data for exceptions',async t=>{
 const {DB,env,send}=await setup(t),s=await trustedScenario(env,send);
 const request={...s.body,expectedRuleVersion:null,parameters:{...s.body.parameters,make:'Haval',model:'Unknown model',modelYear:2024},conditions:[]};
 const r=await s.capture(request,'atomic-unknown-model');assert.equal(r.ok,true);assert.equal(r.inputRevision,2);assert.equal(r.classification.outcome,'manual_review');
 assert.equal(DB.sqlite.prepare('SELECT make FROM vehicles WHERE id=?').get(s.vehicle.id).make,'Haval');
 assert.equal(DB.sqlite.prepare('SELECT rule_version FROM vehicle_classification_bindings WHERE vehicle_id=? ORDER BY input_revision DESC').get(s.vehicle.id).rule_version,null);
});
test('new head or evidence changes between read and mutation reject every correction and preserve original inputs',async t=>{
 for(const cause of ['rule','evidence']){
  const {DB,env,send}=await setup(t),s=await trustedScenario(env,send),batch=DB.batch.bind(DB);let calls=0;
  DB.batch=async statements=>{if(++calls===2){if(cause==='rule'){
   DB.sqlite.exec("INSERT INTO vehicle_classification_rules VALUES('rule_atomic_race','Toyota','Camry',2,2022,'comfort','Synthetic',1)");
   DB.sqlite.exec("UPDATE vehicle_classification_current_rules SET rule_version='rule_atomic_race' WHERE make='Toyota'");
  }else DB.sqlite.exec("UPDATE document_resources SET revision=revision+1 WHERE kind='sts_front'");}return batch(statements);};
  const r=await s.capture({...s.body,parameters:{...s.body.parameters,modelYear:2024}},'atomic-race-'+cause);assert.equal(r.status,409);
  assert.equal(DB.sqlite.prepare('SELECT model_year,revision FROM vehicles WHERE id=?').get(s.vehicle.id).model_year,2023);
  assert.equal(DB.sqlite.prepare('SELECT count(*) n FROM vehicle_trusted_assessments').get().n,0);
 }
});
test('audit failure rolls back corrected vehicle, binding generation and idempotency together',async t=>{
 const {DB,env,send}=await setup(t),s=await trustedScenario(env,send);
 DB.sqlite.exec("CREATE TRIGGER atomic_fail_audit BEFORE INSERT ON audit_events WHEN NEW.action='admin.vehicle_assessment_recorded' BEGIN SELECT RAISE(ABORT,'PRIVATE_ATOMIC_FAILURE'); END");
 await assert.rejects(s.capture({...s.body,parameters:{...s.body.parameters,modelYear:2024}},'atomic-rollback'));
 assert.equal(DB.sqlite.prepare('SELECT model_year,revision FROM vehicles WHERE id=?').get(s.vehicle.id).model_year,2023);
 assert.equal(DB.sqlite.prepare('SELECT count(*) n FROM vehicle_classification_bindings WHERE vehicle_id=?').get(s.vehicle.id).n,1);
 assert.equal(DB.sqlite.prepare("SELECT count(*) n FROM mutation_idempotency WHERE operation='admin.vehicle_assessment.record'").get().n,0);
});
test('selected document changes remove approval and class atomically; restoring material cannot revive proof',async t=>{
 const {DB,env,send}=await setup(t),s=await trustedScenario(env,send);await prepareVehicleApproval(env,s.vehicle.id);await s.capture();
 const path='/v1/admin/registrations/'+driverId+'/review/items/vehicle/'+s.vehicle.id;
 assert.equal((await send('POST',path,{decision:'approved',expectedRevision:2},s.token,'atomic-evidence-approve')).status,200);
 DB.sqlite.exec("UPDATE document_resources SET private_object_key='ChangedSynthetic' WHERE id='document_trusted_front'");
 const row=DB.sqlite.prepare('SELECT class,status FROM vehicles WHERE id=?').get(s.vehicle.id);assert.equal(row.class,null);assert.equal(row.status,'pending_review');
 DB.sqlite.exec("UPDATE document_resources SET private_object_key=id WHERE id='document_trusted_front'");
 assert.equal(DB.sqlite.prepare('SELECT count(*) n FROM vehicle_current_trusted_assessments').get().n,0);
 const rev=DB.sqlite.prepare('SELECT revision FROM vehicles WHERE id=?').get(s.vehicle.id).revision;
 assert.equal((await send('POST',path,{decision:'approved',expectedRevision:rev},s.token,'atomic-evidence-restore-no-bypass')).status,409);
});
test('approval checks current evidence in SQL after the service precheck',async t=>{
 const {DB,env,send}=await setup(t),s=await trustedScenario(env,send);await prepareVehicleApproval(env,s.vehicle.id);await s.capture();
 const batch=DB.batch.bind(DB);DB.batch=async statements=>{DB.sqlite.exec("UPDATE document_resources SET status='rejected' WHERE kind='sts_front'");return batch(statements);};
 const r=await send('POST','/v1/admin/registrations/'+driverId+'/review/items/vehicle/'+s.vehicle.id,{decision:'approved',expectedRevision:2},s.token,'atomic-approve-evidence-race');
 assert.equal(r.status,409);assert.equal(DB.sqlite.prepare('SELECT status FROM vehicles WHERE id=?').get(s.vehicle.id).status,'pending_review');
});
test('populated23 ->24 preserves legacy data and adds no speculative assignment holds; failed upgrade rolls back',async t=>{
 const DB=sqliteD1({throughMigration:23});t.after(()=>DB.sqlite.close());await seedRuleActors(DB);
 const names=DB.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>r.name);
 const before=names.map(n=>JSON.stringify(DB.sqlite.prepare('SELECT * FROM "'+n+'"').all()));
 const sql=readFileSync(new URL('../migrations/0024_vehicle_reverification_holds.sql',import.meta.url),'utf8');
 DB.sqlite.exec('BEGIN IMMEDIATE');assert.throws(()=>DB.sqlite.exec(sql+'\nSELECT * FROM missing_atomic_fixture;'));DB.sqlite.exec('ROLLBACK');
 assert.equal(DB.sqlite.prepare("SELECT name FROM sqlite_master WHERE name='vehicle_reverification_assignment_holds'").get(),undefined);
 DB.sqlite.exec(sql);assert.deepEqual(names.map(n=>JSON.stringify(DB.sqlite.prepare('SELECT * FROM "'+n+'"').all())),before);
 assert.equal(DB.sqlite.prepare('SELECT count(*) n FROM vehicle_reverification_assignment_holds').get().n,0);
 assert.equal(DB.sqlite.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.deepEqual(DB.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
});
test('legacy approval rechecks current permission, session/token version and actual OWNER MFA inside the SQL transaction',async t=>{
 for(const mode of ['grant','token','session','mfa']){
  const {DB,env,send}=await setup(t),s=await trustedScenario(env,send);await prepareVehicleApproval(env,s.vehicle.id);await s.capture();
  const batch=DB.batch.bind(DB);let changed=false;DB.batch=async statements=>{if(!changed){changed=true;
   DB.sqlite.exec(mode==='grant'?"DELETE FROM staff_permissions WHERE permission='vehicles.verify'":mode==='token'?"UPDATE staff_accounts SET token_version=token_version+1":mode==='session'?"UPDATE staff_sessions SET revoked_at=created_at":"DELETE FROM admin_mfa_session_families");
  }return batch(statements);};
  const r=await send('POST','/v1/admin/registrations/'+driverId+'/review/items/vehicle/'+s.vehicle.id,{decision:'approved',expectedRevision:2},mode==='mfa'?s.ownerToken:s.token,'atomic-auth-race-'+mode);
  assert.equal(r.status,409);assert.equal(DB.sqlite.prepare('SELECT status FROM vehicles WHERE id=?').get(s.vehicle.id).status,'pending_review');
  assert.equal(DB.sqlite.prepare("SELECT count(*) n FROM audit_events WHERE action='admin.vehicle_reviewed'").get().n,0);
 }
});
test('failed document mutation transaction restores approval, trust and invalidation ledger together',async t=>{
 const {DB,env,send}=await setup(t),s=await trustedScenario(env,send);await prepareVehicleApproval(env,s.vehicle.id);await s.capture();
 assert.equal((await send('POST','/v1/admin/registrations/'+driverId+'/review/items/vehicle/'+s.vehicle.id,{decision:'approved',expectedRevision:2},s.token,'atomic-document-rollback-approve')).status,200);
 await assert.rejects(DB.batch([DB.prepare("UPDATE document_resources SET revision=revision+1 WHERE id='document_trusted_front'"),DB.prepare('INSERT INTO missing_atomic_audit_fixture VALUES(1)')]));
 assert.equal(DB.sqlite.prepare('SELECT status FROM vehicles WHERE id=?').get(s.vehicle.id).status,'approved');
 assert.equal(DB.sqlite.prepare('SELECT count(*) n FROM vehicle_current_trusted_assessments').get().n,1);
 assert.equal(DB.sqlite.prepare('SELECT count(*) n FROM vehicle_assessment_invalidations').get().n,0);
});
test('legacy approval also enforces the owner-required body color',async t=>{
 const {DB,env,send}=await setup(t),s=await trustedScenario(env,send);await prepareVehicleApproval(env,s.vehicle.id);await s.capture();
 const path='/v1/admin/registrations/'+driverId+'/review/items/vehicle/'+s.vehicle.id;
 for(const [i,color]of [null,' ','\u00a0\ufeff','Белый\nСерый','Белый\0Серый'].entries()){
  DB.sqlite.prepare('UPDATE vehicles SET color=? WHERE id=?').run(color,s.vehicle.id);
  assert.equal((await send('POST',path,{decision:'approved',expectedRevision:2},s.token,'atomic-missing-color-'+i)).status,409);
 }
 DB.sqlite.prepare("UPDATE vehicles SET color='Белый' WHERE id=?").run(s.vehicle.id);
 assert.equal((await send('POST',path,{decision:'approved',expectedRevision:2},s.token,'atomic-restored-color')).status,200);
});
