import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import router from '../src/router.js';
import { sqliteD1 } from './helpers/sqliteD1.mjs';
import { seedRuleActors,ruleSecrets,ruleBody,moderator,ownerId } from './helpers/adminVehicleRuleScenario.mjs';
import { trustedScenario,trustedStorageWorkflow } from './helpers/trustedAssessmentScenario.mjs';
import { decideTrustedVehicle } from '../src/core/trustedVehicleDecision.js';
import { recordTrustedVehicleAssessment } from '../src/core/trustedVehicleAssessmentRepository.js';
import { authenticateStaffRequest } from '../src/core/staffAuthorization.js';
async function setup(t){
  const DB=sqliteD1();t.after(()=>DB.sqlite.close());await seedRuleActors(DB);const env={DB,...ruleSecrets};
  const send=async(method,path,body,token,key)=>{
    const r=await router(new Request('https://fixture.invalid'+path,{method,headers:{'Content-Type':'application/json','CF-Connecting-IP':'203.0.113.10',
      ...(token?{Authorization:'Bearer '+token}:{}),...(key?{'Idempotency-Key':key}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})}),env,{});
    return {status:r.status,body:await r.json()};
  };
  return {DB,env,send};
}
test('actual SQL storage, real staff authentication, replay, permanent invalidation and rollback',async t=>{
  const {env,send}=await setup(t);await trustedStorageWorkflow(env,send);
});
test('server decisions enforce year, explicit conditions, same make, BEV and hard body policy',()=>{
  const p={make:'Toyota',model:'Camry',modelYear:2023,powertrain:'hybrid',bodyType:'sedan'};
  const r={version:'rule_v1',make:'Toyota',model:'Camry',minYear:2020,vehicleClass:'comfort',allowedBodyTypes:['sedan','crossover'],conditions:[{id:'rule_v1:1'}]};
  const checked=[{conditionId:'rule_v1:1',result:'satisfied'}];
  assert.equal(decideTrustedVehicle(p,r,checked).outcome,'candidate');
  assert.equal(decideTrustedVehicle({...p,modelYear:2019},r,checked).reasonCodes[0],'year_below_minimum');
  assert.equal(decideTrustedVehicle(p,r,[]).reasonCodes[0],'rule_conditions_unverified');
  const unmet=[{conditionId:'rule_v1:1',result:'unmet'}];assert.equal(decideTrustedVehicle(p,r,unmet).outcome,'manual_review');
  const x={basisRuleVersion:r.version,yearBelowMinimum:true,waivedConditionIds:['rule_v1:1']};
  assert.equal(decideTrustedVehicle({...p,model:'Unknown',modelYear:2019},r,unmet,x).outcome,'candidate');
  assert.equal(decideTrustedVehicle({...p,make:'Haval'},r,unmet,x).error,'invalid_exception');
  assert.equal(decideTrustedVehicle({...p,powertrain:'battery_electric'},r,unmet,x).outcome,'excluded');
  assert.equal(decideTrustedVehicle({...p,bodyType:'minivan'},r,unmet,x).outcome,'excluded');
  assert.equal(decideTrustedVehicle({...p,bodyType:'crossover'},{...r,vehicleClass:'business'},checked).outcome,'excluded');
  for(const model of ['L7','L9'])assert.equal(decideTrustedVehicle({...p,make:'Li Auto',model,bodyType:'crossover'},
    {...r,make:'Li Auto',model,vehicleClass:'business',allowedBodyTypes:['crossover']},checked).outcome,'candidate');
  assert.equal(decideTrustedVehicle(p,null,[]).outcome,'manual_review');
  assert.equal(decideTrustedVehicle(p,r,[...checked,...checked]).error,'invalid_conditions');
  assert.equal(decideTrustedVehicle(p,r,[{conditionId:'invented',result:'satisfied'}]).error,'invalid_conditions');
});
test('storage ignores forged flags and requires real OWNER proof for exceptions',async t=>{
  const {env,send}=await setup(t),s=await trustedScenario(env,send);
  for(const extra of [{vehicleClass:'business'},{yearVerified:true},{actorAccountId:'owner'},{role:'owner'}])assert.equal((await s.capture({...s.body,...extra})).status,400);
  assert.equal((await s.capture(s.body,'trusted-driver-denied',s.driver)).status,403);
  const body={...s.body,mode:'exception',exception:{basisRuleVersion:s.rule.version,yearBelowMinimum:false,waivedConditionIds:[]}};
  assert.equal((await s.capture(body,'trusted-dispatcher-denied')).status,403);
  const auth=await authenticateStaffRequest(new Request('https://fixture.invalid',{headers:{Authorization:'Bearer '+s.ownerToken}}),env);
  env.DB.sqlite.exec('DELETE FROM admin_mfa_session_families');
  assert.equal((await recordTrustedVehicleAssessment(env,auth.user,s.vehicle.id,body,{idempotencyKey:'trusted-forged-mfa',mfa:{required:true,verified:true}})).status,403);
});
test('stale vehicle, input or pinned version and changed evidence cannot create a result',async t=>{
  const {DB,env,send}=await setup(t),s=await trustedScenario(env,send);
  for(const extra of [{expectedRevision:2},{expectedInputRevision:2},{expectedRuleVersion:'unknown_rule'},
    {evidence:[{documentId:'document_fixture002',expectedRevision:1},s.body.evidence[1]]}]){
    const result=await s.capture({...s.body,...extra},'trusted-conflict-'+crypto.randomUUID());assert.equal(result.status,409);
  }
  assert.equal(DB.sqlite.prepare('SELECT count(*) n FROM vehicle_trusted_assessments').get().n,0);
  const corrected=await s.capture({...s.body,parameters:{...s.body.parameters,modelYear:2022}},'trusted-correction-atomic');
  assert.equal(corrected.ok,true);assert.equal(corrected.inputRevision,2);
  assert.equal(DB.sqlite.prepare('SELECT model_year FROM vehicles WHERE id=?').get(s.vehicle.id).model_year,2022);
});
test('data and evidence races between precheck and transaction fail closed',async t=>{
  for(const change of ["UPDATE vehicles SET revision=revision+1", "DELETE FROM staff_permissions WHERE permission='vehicles.verify'",
    "UPDATE document_resources SET status='rejected' WHERE kind='sts_front'", "UPDATE document_resources SET revision=revision+1 WHERE kind='sts_back'"]){
    const {DB,env,send}=await setup(t),s=await trustedScenario(env,send),batch=DB.batch.bind(DB);let calls=0;
    DB.batch=async statements=>{if(++calls===2)DB.sqlite.exec(change);return batch(statements);};
    const result=await s.capture();assert.equal(result.ok,false);assert.ok([403,409].includes(result.status),change);
    assert.equal(DB.sqlite.prepare('SELECT count(*) n FROM vehicle_trusted_assessments').get().n,0);
  }
});
test('new rules, color and generic revisions preserve a pinned assessment; explicit key edits invalidate it',async t=>{
  const {DB,env,send}=await setup(t),s=await trustedScenario(env,send);assert.equal((await s.capture()).ok,true);
  assert.equal((await send('POST','/v1/admin/vehicle-rules',{...ruleBody,minYear:2024,expectedCurrentVersion:s.rule.version},s.ownerToken,'trusted-next-head')).status,201);
  const current=()=>DB.sqlite.prepare('SELECT id,rule_version FROM vehicle_current_trusted_assessments WHERE vehicle_id=?').get(s.vehicle.id);
  assert.equal(current().rule_version,s.rule.version);
  DB.sqlite.prepare("UPDATE vehicles SET color='Black',revision=revision+1 WHERE id=?").run(s.vehicle.id);assert.ok(current());
  DB.sqlite.prepare('UPDATE vehicles SET model_year=2024,revision=revision+1 WHERE id=?').run(s.vehicle.id);assert.equal(current(),undefined);
  DB.sqlite.prepare('UPDATE vehicles SET model_year=2023,revision=revision+1 WHERE id=?').run(s.vehicle.id);assert.equal(current(),undefined);
});
test('new noncandidate result replaces earlier candidate without rewriting history',async t=>{
  const {DB,env,send}=await setup(t),s=await trustedScenario(env,send),first=await s.capture();
  const second=await s.capture({...s.body,expectedRevision:2,parameters:{...s.body.parameters,powertrain:'battery_electric'}},'trusted-bev-review');
  assert.equal(second.ok,true);assert.equal(second.classification.outcome,'excluded');assert.equal(second.classification.vehicleClass,null);
  assert.equal(DB.sqlite.prepare('SELECT count(*) n FROM vehicle_trusted_assessments').get().n,2);
  const live=DB.sqlite.prepare('SELECT id,outcome FROM vehicle_current_trusted_assessments WHERE vehicle_id=?').get(s.vehicle.id);
  assert.equal(live.id,second.assessmentId);assert.equal(live.outcome,'excluded');
  assert.throws(()=>DB.sqlite.prepare("UPDATE vehicle_trusted_assessments SET outcome='candidate' WHERE id=?").run(first.assessmentId));
});
test('verified evidence must include both sides of this vehicle, with no duplicate IDs or omitted conditions',async t=>{
  const {DB,env,send}=await setup(t),s=await trustedScenario(env,send);
  assert.equal((await s.capture({...s.body,evidence:[s.body.evidence[0],s.body.evidence[0]]})).status,400);
  const unchecked=await s.capture({...s.body,conditions:[]},'trusted-unchecked');assert.equal(unchecked.classification.outcome,'manual_review');
  DB.sqlite.exec("UPDATE document_resources SET kind='sts_front' WHERE id='document_trusted_back'");
  assert.equal(DB.sqlite.prepare('SELECT count(*) n FROM vehicle_current_trusted_assessments').get().n,0);
  assert.equal((await s.capture({...s.body,expectedRevision:2},'trusted-missing-back')).status,409);
});
test('SQL rejects forged candidates, duplicates and unaudited inserts independently',async t=>{
  const {DB,env,send}=await setup(t),s=await trustedScenario(env,send);await s.capture();
  const saved={...DB.sqlite.prepare('SELECT * FROM vehicle_trusted_assessments').get()};
  DB.sqlite.prepare("INSERT INTO audit_events VALUES('audit_trusted_raw',?,'admin.vehicle_assessment_recorded','vehicle',?,'success',NULL,1)").run(moderator,s.vehicle.id);
  const insert=extra=>{const row={...saved,id:'assessment_raw_sql',sequence:2,audit_event_id:'audit_trusted_raw',...extra};
    return DB.sqlite.prepare('INSERT INTO vehicle_trusted_assessments('+Object.keys(row).join(',')+') VALUES('+Object.keys(row).map(()=>'?').join(',')+')').run(...Object.values(row));};
  for(const extra of [{powertrain:'battery_electric'},{class:'business'},{body_type:'minivan'},{conditions_json:'[]'},
    {conditions_json:JSON.stringify([...s.body.conditions,...s.body.conditions])},{actor_account_id:'staff_driver123'},
    {audit_event_id:'audit_missing'},{model_year:2019}])assert.throws(()=>insert(extra));
});
test('populated22 ->23 preserves all old tables and rolls back failed upgrades without inventing legacy trust',async t=>{
  const DB=sqliteD1({throughMigration:22});t.after(()=>DB.sqlite.close());await seedRuleActors(DB);
  const names=DB.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(x=>x.name);
  const snapshot=()=>names.map(n=>JSON.stringify(DB.sqlite.prepare('SELECT * FROM "'+n+'"').all()));const before=snapshot();
  const sql=readFileSync(new URL('../migrations/0023_trusted_vehicle_assessments.sql',import.meta.url),'utf8');
  DB.sqlite.exec('BEGIN IMMEDIATE');assert.throws(()=>DB.sqlite.exec(sql+'\nSELECT * FROM missing_trusted_fixture;'));DB.sqlite.exec('ROLLBACK');assert.deepEqual(snapshot(),before);
  assert.equal(DB.sqlite.prepare("SELECT name FROM sqlite_master WHERE name='vehicle_trusted_assessments'").get(),undefined);
  DB.sqlite.exec(sql);assert.deepEqual(snapshot(),before);assert.equal(DB.sqlite.prepare('SELECT count(*) n FROM vehicle_trusted_assessments').get().n,0);
  assert.equal(DB.sqlite.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.deepEqual(DB.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
});
test('public review POST records a candidate without approving the vehicle',async t=>{
  const {env,send}=await setup(t),s=await trustedScenario(env,send);
  const result=await send('POST','/v1/admin/vehicles/'+s.vehicle.id+'/classification/review',s.body,s.ownerToken,'trusted-public-candidate');
  assert.equal(result.status,200);assert.equal(result.body.classification.outcome,'candidate');
  const row=await env.DB.prepare('SELECT status,class FROM vehicles WHERE id=?1').bind(s.vehicle.id).first();
  assert.equal(row.status,'draft');assert.equal(row.class,null);
});
test('OWNER exception uses a rule of the same make while retaining the real unknown model and older year',async t=>{
  const {DB,env,send}=await setup(t),s=await trustedScenario(env,send);
  DB.sqlite.prepare("UPDATE vehicles SET model='Unknown model',model_year=2018,revision=2 WHERE id=?").run(s.vehicle.id);
  const body={...s.body,expectedRevision:2,expectedInputRevision:2,expectedRuleVersion:null,mode:'exception',
    parameters:{...s.body.parameters,model:'Unknown model',modelYear:2018},conditions:s.body.conditions.map(c=>({...c,result:'unmet'})),
    exception:{basisRuleVersion:s.rule.version,yearBelowMinimum:true,waivedConditionIds:s.rule.conditions.map(c=>c.id)}};
  const r=await s.capture(body,'trusted-owner-exception',s.ownerToken);assert.equal(r.ok,true);assert.equal(r.classification.vehicleClass,'comfort');
  const stored=DB.sqlite.prepare('SELECT model,model_year,pinned_rule_version,rule_version FROM vehicle_trusted_assessments').get();
  assert.equal(stored.model,'Unknown model');assert.equal(stored.model_year,2018);assert.equal(stored.pinned_rule_version,null);assert.equal(stored.rule_version,s.rule.version);
  assert.equal(DB.sqlite.prepare('SELECT class FROM vehicles WHERE id=?').get(s.vehicle.id).class,null);
});
test('same-key concurrency has one result; different-key stale confirmations have one winner',async t=>{
  const {DB,env,send}=await setup(t),s=await trustedScenario(env,send);
  const same=await Promise.all([s.capture(),s.capture()]);assert.ok(same.every(r=>r.ok));assert.equal(same[0].assessmentId,same[1].assessmentId);
  const body={...s.body,expectedRevision:2};
  const competing=await Promise.all([s.capture(body,'trusted-competing-a'),s.capture(body,'trusted-competing-b')]);
  assert.equal(competing.filter(r=>r.ok).length,1);assert.equal(competing.find(r=>!r.ok).status,409);
  assert.equal(DB.sqlite.prepare('SELECT count(*) n FROM vehicle_trusted_assessments').get().n,2);
  assert.equal(DB.sqlite.prepare("SELECT count(*) n FROM audit_events WHERE action='admin.vehicle_assessment_recorded'").get().n,2);
});
test('powertrain, VIN, document status and deletion invalidate permanently without rewriting a decision',async t=>{
  for(const change of ["UPDATE vehicles SET powertrain='hybrid'", "UPDATE vehicles SET vin='XW8ZZZ61ZFG000002'",
    "UPDATE document_resources SET status='rejected' WHERE id='document_trusted_front'", "DELETE FROM document_resources WHERE id='document_trusted_front'"]){
    const {DB,env,send}=await setup(t),s=await trustedScenario(env,send);await s.capture();DB.sqlite.exec(change);
    assert.equal(DB.sqlite.prepare('SELECT count(*) n FROM vehicle_current_trusted_assessments').get().n,0);
    assert.equal(DB.sqlite.prepare('SELECT count(*) n FROM vehicle_trusted_assessments').get().n,1);
    assert.throws(()=>DB.sqlite.exec('DELETE FROM vehicle_assessment_invalidations'));
  }
});
test('replay rechecks live permission/MFA and does not expose the protected reason in its receipt',async t=>{
  const {DB,env,send}=await setup(t),s=await trustedScenario(env,send),saved=await s.capture();
  assert.ok(!JSON.stringify(saved).includes(s.body.reason));assert.ok(!JSON.stringify(saved).includes('document_trusted'));
  DB.sqlite.exec("DELETE FROM staff_permissions WHERE permission='vehicles.verify'");assert.equal((await s.capture()).status,403);
  const ownerBody={...s.body,expectedRevision:2};assert.equal((await s.capture(ownerBody,'trusted-owner-replay',s.ownerToken)).ok,true);
  DB.sqlite.exec('DELETE FROM admin_mfa_session_families');assert.equal((await s.capture(ownerBody,'trusted-owner-replay',s.ownerToken)).status,401);
});
test('L7/L9 crossover privilege follows the actual vehicle and cannot be borrowed through a basis model',async t=>{
  const {DB,env,send}=await setup(t),s=await trustedScenario(env,send);
  const made=await send('POST','/v1/admin/vehicle-rules',{...ruleBody,make:'Li Auto',model:'L7',vehicleClass:'business',allowedBodyTypes:['crossover']},s.ownerToken,'trusted-li-rule');assert.equal(made.status,201);
  DB.sqlite.prepare("UPDATE vehicles SET make='Li Auto',model='L8',revision=2 WHERE id=?").run(s.vehicle.id);
  const body={...s.body,expectedRevision:2,expectedInputRevision:2,expectedRuleVersion:null,mode:'exception',
    parameters:{...s.body.parameters,make:'Li Auto',model:'L8',bodyType:'crossover'},
    conditions:made.body.rule.conditions.map(c=>({conditionId:c.id,result:'satisfied'})),
    exception:{basisRuleVersion:made.body.rule.version,yearBelowMinimum:false,waivedConditionIds:[]}};
  const result=await s.capture(body,'trusted-no-borrowed-crossover',s.ownerToken);assert.equal(result.ok,true);
  assert.equal(result.classification.outcome,'excluded');assert.deepEqual(result.classification.reasonCodes,['body_type_not_allowed']);
  const row={...DB.sqlite.prepare('SELECT * FROM vehicle_trusted_assessments').get(),id:'assessment_forged_li',sequence:2,
    outcome:'candidate',class:'business',reason_codes_json:'[]',audit_event_id:'audit_li_forged'};
  DB.sqlite.prepare("INSERT INTO audit_events VALUES('audit_li_forged',?,'admin.vehicle_assessment_recorded','vehicle',?,'success',NULL,1)").run(ownerId,s.vehicle.id);
  assert.throws(()=>DB.sqlite.prepare('INSERT INTO vehicle_trusted_assessments('+Object.keys(row).join(',')+') VALUES('+Object.keys(row).map(()=>'?').join(',')+')').run(...Object.values(row)));
});
