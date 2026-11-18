import test from 'node:test';
import assert from 'node:assert/strict';
import router from '../src/router.js';
import worker from '../src/index.js';
import { sqliteD1 } from './helpers/sqliteD1.mjs';
import { seedRuleActors,ruleSecrets,moderator,driverId,ownerId } from './helpers/adminVehicleRuleScenario.mjs';
import { trustedScenario } from './helpers/trustedAssessmentScenario.mjs';
import { classificationReviewWorkflow } from './helpers/adminClassificationReviewScenario.mjs';
async function setup(t){
  const DB=sqliteD1();t.after(()=>DB.sqlite.close());await seedRuleActors(DB);const env={DB,...ruleSecrets};
  const raw=async(method,path,body,token,headers={})=>{
    const r=await router(new Request('https://fixture.invalid'+path,{method,headers:{'Content-Type':'application/json','CF-Connecting-IP':'203.0.113.10',
      ...(token?{Authorization:'Bearer '+token}:{}),...headers},...(body===undefined?{}:{body})}),env,{});
    assert.equal(r.headers.get('Cache-Control'),'no-store');return {status:r.status,body:await r.json()};
  };
  const send=(method,path,body,token,key)=>raw(method,path,body===undefined?undefined:JSON.stringify(body),token,key?{'Idempotency-Key':key}:{});
  const scenario=async()=>{const s=await trustedScenario(env,send);return {...s,path:'/v1/admin/vehicles/'+s.vehicle.id+'/classification'};};
  return {DB,env,send,raw,scenario};
}
test('actual HTTP review, correction, separate approval, held assignment, history pages, privacy and rollback',async t=>{
  const {env,send}=await setup(t);await classificationReviewWorkflow(env,send);
});
test('review rejects unknown/injected fields, unapproved make, invalid values and incomplete evidence',async t=>{
  const {DB,send,scenario}=await setup(t),s=await scenario();
  const variants=[{vehicleClass:'business'},{approved:true},{yearVerified:true},{powertrainVerified:true},{actorAccountId:ownerId},{role:'owner'},
    {parameters:{...s.body.parameters,make:'Unapproved make'}},{parameters:{...s.body.parameters,modelYear:'2023'}},
    {parameters:{...s.body.parameters,bodyType:'SUV'}},{parameters:{...s.body.parameters,extra:true}},
    {evidence:[s.body.evidence[0],s.body.evidence[0]]},{evidence:[]},{reason:''},{conditions:[...s.body.conditions,...s.body.conditions]},
    {conditions:[{conditionId:'unknown',result:'satisfied'}]}];
  for(const delta of variants)assert.equal((await send('POST',s.path+'/review',{...s.body,...delta},s.token,'public-invalid-fields')).status,400);
  assert.equal((await send('POST',s.path+'/review',s.body,s.token)).status,400);
  assert.equal(DB.sqlite.prepare('SELECT count(*) n FROM vehicle_trusted_assessments').get().n,0);
});
test('HTTP body parsing is bounded at 16KiB and malformed bodies never create an assessment',async t=>{
  const {DB,raw,scenario}=await setup(t),s=await scenario();
  for(const body of ['{',JSON.stringify({...s.body,reason:'x'.repeat(17000)}),'null']){
    assert.equal((await raw('POST',s.path+'/review',body,s.token,{'Idempotency-Key':'public-malformed'})).status,400);
  }
  assert.equal((await raw('POST',s.path+'/review',JSON.stringify(s.body),s.token,{'Idempotency-Key':'public-too-large','Content-Length':'17000'})).status,400);
  assert.equal(DB.sqlite.prepare('SELECT count(*) n FROM vehicle_trusted_assessments').get().n,0);
});
test('OWNER-only exception retains actual model, uses same-make basis conditions and never bypasses BEV',async t=>{
  const {DB,send,scenario}=await setup(t),s=await scenario();
  DB.sqlite.prepare("UPDATE vehicles SET model='Unknown',model_year=2018,revision=2 WHERE id=?").run(s.vehicle.id);
  const body={...s.body,expectedRevision:2,expectedInputRevision:2,expectedRuleVersion:null,mode:'exception',
    parameters:{...s.body.parameters,model:'Unknown',modelYear:2018},
    exception:{basisRuleVersion:s.rule.version,yearBelowMinimum:true,waivedConditionIds:[]}};
  for(const permission of ['vehicles.approve_exception','vehicle_rules.manage'])assert.throws(()=>DB.sqlite.prepare('INSERT INTO staff_permissions VALUES(?,?,?,1)').run(moderator,permission,ownerId));
  assert.equal((await send('POST',s.path+'/review',body,s.token,'public-dispatcher-exception')).status,403);
  const result=await send('POST',s.path+'/review',body,s.ownerToken,'public-owner-exception');assert.equal(result.status,200);assert.equal(result.body.classification.vehicleClass,'comfort');
  const read=await send('GET',s.path,undefined,s.ownerToken);assert.equal(read.body.verifiedParameters.model,'Unknown');assert.equal(read.body.pinnedRuleVersion,null);
  assert.equal(read.body.classification.ruleVersion,s.rule.version);assert.deepEqual(read.body.conditions,s.rule.conditions);
  const bev=await send('POST',s.path+'/review',{...body,expectedRevision:3,parameters:{...body.parameters,powertrain:'battery_electric'}},s.ownerToken,'public-owner-bev');
  assert.equal(bev.status,200);assert.equal(bev.body.classification.outcome,'excluded');assert.equal(bev.body.classification.vehicleClass,null);
});
test('current metadata never presents an old candidate as trusted after natural expiry',async t=>{
  const {DB,send,scenario}=await setup(t),s=await scenario(),expiry=Date.now()+600000;
  DB.sqlite.prepare('UPDATE document_resources SET expires_at=? WHERE vehicle_id=?').run(expiry,s.vehicle.id);
  assert.equal((await send('POST',s.path+'/review',s.body,s.token,'public-expiring-proof')).status,200);
  let clock=Date.now();DB.sqlite.function('julianday',_now=>clock/86400000+2440587.5);
  assert.equal((await send('GET',s.path,undefined,s.token)).body.classification.outcome,'candidate');clock=expiry+1000;
  const read=await send('GET',s.path,undefined,s.token);assert.equal(read.status,200);assert.equal(read.body.verifiedParameters,null);
  assert.equal(read.body.classification,null);assert.deepEqual(read.body.evidence,[]);assert.equal(read.body.history[0].outcome,'candidate');
  assert.equal(DB.sqlite.prepare('SELECT count(*) n FROM vehicle_assessment_invalidations').get().n,0);
});
test('public manual/excluded results remain explicit and unverified conditions never become satisfied',async t=>{
  const {send,scenario}=await setup(t),s=await scenario();
  const unchecked=await send('POST',s.path+'/review',{...s.body,conditions:[]},s.token,'public-unchecked-conditions');
  assert.equal(unchecked.status,200);assert.equal(unchecked.body.classification.outcome,'manual_review');
  assert.ok(unchecked.body.classification.reasonCodes.includes('rule_conditions_unverified'));
  const unknown={...s.body,expectedRevision:2,expectedRuleVersion:null,parameters:{...s.body.parameters,model:'Unknown'},conditions:[]};
  const missing=await send('POST',s.path+'/review',unknown,s.token,'public-unknown-model');assert.equal(missing.status,200);
  assert.equal(missing.body.classification.outcome,'manual_review');assert.deepEqual(missing.body.classification.reasonCodes,['model_not_found']);
  const excluded=await send('POST',s.path+'/review',{...unknown,expectedRevision:3,expectedInputRevision:2,parameters:{...unknown.parameters,powertrain:'battery_electric'}},s.token,'public-bev-excluded');
  assert.equal(excluded.status,200);assert.equal(excluded.body.classification.outcome,'excluded');
  const read=await send('GET',s.path,undefined,s.token);assert.equal(read.body.verifiedParameters.powertrain,'battery_electric');assert.equal(read.body.classification.vehicleClass,null);
  assert.equal(read.body.history.length,3);
});
test('read rechecks grants, session, token version and actual OWNER MFA in its audited transaction',async t=>{
  for(const change of ["DELETE FROM staff_permissions WHERE permission='vehicles.verify'",'UPDATE staff_sessions SET revoked_at=created_at',
    'UPDATE staff_accounts SET token_version=token_version+1','UPDATE admin_mfa_session_families SET expires_at=verified_at+1']){
    const {DB,send,scenario}=await setup(t),s=await scenario(),batch=DB.batch.bind(DB);let once=false;
    DB.batch=async statements=>{if(!once){once=true;DB.sqlite.exec(change);}return batch(statements);};
    const token=change.includes('admin_mfa')?s.ownerToken:s.token;
    const r=await send('GET',s.path,undefined,token);assert.equal(r.status,403,change);assert.equal(r.body.declaredParameters,undefined);
    assert.equal(DB.sqlite.prepare("SELECT count(*) n FROM audit_events WHERE action='admin.vehicle_classification_read'").get().n,0);
  }
});
test('write rechecks permission and evidence after precheck, and replay rechecks current access',async t=>{
  for(const change of ["DELETE FROM staff_permissions WHERE permission='vehicles.verify'","UPDATE document_resources SET status='rejected' WHERE id='document_trusted_front'"]){
    const {DB,send,scenario}=await setup(t),s=await scenario(),batch=DB.batch.bind(DB);let calls=0;
    DB.batch=async statements=>{if(++calls===2)DB.sqlite.exec(change);return batch(statements);};
    const r=await send('POST',s.path+'/review',s.body,s.token,'public-write-race');assert.ok([403,409].includes(r.status));
    assert.equal(DB.sqlite.prepare('SELECT count(*) n FROM vehicle_trusted_assessments').get().n,0);
    assert.equal(DB.sqlite.prepare("SELECT count(*) n FROM audit_events WHERE action='admin.vehicle_assessment_recorded'").get().n,0);
  }
  const {DB,send,scenario}=await setup(t),s=await scenario();
  assert.equal((await send('POST',s.path+'/review',s.body,s.token,'public-replay-access')).status,200);
  DB.sqlite.prepare("DELETE FROM staff_permissions WHERE account_id=? AND permission='vehicles.verify'").run(moderator);
  assert.equal((await send('POST',s.path+'/review',s.body,s.token,'public-replay-access')).status,403);
});
test('invalid history query, missing vehicle, methods and OWNER phone scope fail safely',async t=>{
  const {env,send,scenario}=await setup(t),s=await scenario();
  for(const query of ['?limit=1','?historyCursor=bad','?historyCursor=','?historyCursor=a&historyCursor=b'])assert.equal((await send('GET',s.path+query,undefined,s.token)).status,400);
  assert.equal((await send('GET','/v1/admin/vehicles/vehicle_missing000/classification',undefined,s.token)).status,404);
  assert.equal((await send('GET',s.path+'/review',undefined,s.token)).status,405);
  assert.equal((await send('POST',s.path+'/review?unknown=1',s.body,s.token,'public-invalid-query')).status,400);
  assert.equal((await send('POST',s.path+'/review',s.body)).status,401);
  assert.equal((await send('POST',s.path+'/review',s.body,s.driver,'public-driver-denied')).status,403);
  for(const method of ['GET','POST']){
    const r=await worker.fetch(new Request('https://uber-v3-staging.lobanov0710.workers.dev'+s.path+(method==='POST'?'/review':''),{method}),{...env,APP_ENV:'staging',ADMIN_PHONE_TEST_ONLY:'true'},{});
    assert.equal(r.status,404);assert.equal(r.headers.get('Cache-Control'),'no-store');
  }
});
