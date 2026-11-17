import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import router from '../src/router.js';
import worker from '../src/index.js';
import { sqliteD1 } from './helpers/sqliteD1.mjs';
import { authenticateStaffRequest } from '../src/core/staffAuthorization.js';
import { createAdminVehicleRule } from '../src/core/adminVehicleRuleService.js';
import { boundedAuthJson } from '../src/core/ownerMfaTransport.js';
import { seedRuleActors,ruleOwnerLogin,ruleApiWorkflow,ruleSecrets,ruleBody,ownerId,moderator,driverId,fixturePassword } from './helpers/adminVehicleRuleScenario.mjs';
const path='/v1/admin/vehicle-rules';
async function setup(t){
  const DB=sqliteD1();t.after(()=>DB.sqlite.close());await seedRuleActors(DB);const env={DB,...ruleSecrets};
  const send=async(method,url,body,token,key,extra={})=>{
    const response=await router(new Request('https://fixture.invalid'+url,{method,
      headers:{'Content-Type':'application/json','CF-Connecting-IP':'203.0.113.10',...(token?{Authorization:'Bearer '+token}:{}),...(key?{'Idempotency-Key':key}:{}),...extra},
      ...(body===undefined?{}:{body:JSON.stringify(body)})}),env,{});
    assert.equal(response.headers.get('Cache-Control'),'no-store');return {status:response.status,body:await response.json()};
  };
  const owner=()=>ruleOwnerLogin(env,send);
  return {DB,env,send,owner};
}
test('actual HTTP rule workflow: OWNER MFA, immutable versions, dispatcher read only, replay and rollback',async t=>{
  const {env,send}=await setup(t);await ruleApiWorkflow(env,send);
});
test('missing auth/driver/DISPATCHER cannot author; payload cannot manufacture OWNER privileges',async t=>{
  const {DB,send}=await setup(t);
  for(const id of [driverId,moderator]){
    const login=await send('POST','/staff/login',{login:id,password:fixturePassword});const token=login.body.accessToken;
    assert.equal((await send('POST',path,ruleBody,token,'rule-unprivileged-'+id)).status,403);
  }
  assert.equal((await send('POST',path,ruleBody)).status,401);
  assert.equal(DB.sqlite.prepare('SELECT count(*) n FROM vehicle_classification_rules').get().n,0);
});
test('unapproved make, economy, invalid years/body types, unknown fields and missing reason fail closed',async t=>{
  const {DB,send,owner}=await setup(t);const token=await owner();
  const variants=[{make:'Unapproved synthetic make'},{vehicleClass:'economy'},{minYear:0},{minYear:2020.5},{minYear:'2023'},
    {reason:''},{reason:null},{allowedBodyTypes:[]},{allowedBodyTypes:['sedan','sedan']},{allowedBodyTypes:['minivan']},
    {vehicleClass:'business',allowedBodyTypes:['crossover']},{conditions:['']},{conditions:[42]},{conditions:['same','same']},
    {yearVerified:true},{role:'owner'},{permissions:['*']},{vehicleClass:'business',make:'Li Auto',model:'L7',allowedBodyTypes:['sedan']}];
  for(const v of variants)assert.equal((await send('POST',path,{...ruleBody,...v},token,'rule-invalid-body')).status,400);
  const missing={...ruleBody};delete missing.expectedCurrentVersion;assert.equal((await send('POST',path,missing,token,'rule-missing-field')).status,400);
  assert.equal(DB.sqlite.prepare('SELECT count(*) n FROM vehicle_classification_rules').get().n,0);
});
test('Li Auto crossover exceptions and unchanged minivan policy are representable',async t=>{
  const {send,owner}=await setup(t);const token=await owner();
  for(const model of ['L7','L9'])assert.equal((await send('POST',path,{...ruleBody,make:'Li Auto',model,vehicleClass:'business',allowedBodyTypes:['crossover']},token,'rule-li-auto-'+model)).status,201);
  assert.equal((await send('POST',path,{...ruleBody,model:'Synthetic minivan',vehicleClass:'minivan',allowedBodyTypes:null},token,'rule-minivan-null')).status,201);
});
test('same key/different body conflicts, stale revision is replayable and does not publish extra versions',async t=>{
  const {DB,send,owner}=await setup(t);const token=await owner();
  const first=await send('POST',path,ruleBody,token,'rule-same-key');assert.equal(first.status,201);
  assert.equal((await send('POST',path,{...ruleBody,minYear:2023},token,'rule-same-key')).body.code,'idempotency_key_conflict');
  for(let n=0;n<2;n++)assert.equal((await send('POST',path,ruleBody,token,'rule-stale-key')).body.code,'rule_revision_conflict');
  assert.equal(DB.sqlite.prepare('SELECT count(*) n FROM vehicle_classification_rules').get().n,1);
  assert.equal(DB.sqlite.prepare("SELECT count(*) n FROM audit_events WHERE action='admin.vehicle_rule_created'").get().n,1);
  assert.equal((await send('POST',path,ruleBody,token)).status,400);
});
test('rule publication never rebinds or approves an existing vehicle; new save uses new head',async t=>{
  const {DB,env,send,owner}=await setup(t);const token=await owner();
  const driver=(await send('POST','/staff/login',{login:driverId,password:fixturePassword})).body.accessToken;
  const body={vin:'XW8ZZZ61ZFG000001',plate:'SYNTHETIC',make:'Toyota',model:'Camry',modelYear:2023,color:'Белый',capacity:4,baggageCapacity:'standard',usageBasis:'owner'};
  const create=async()=>{const r=await send('POST','/v1/driver/vehicles',body,driver);assert.equal(r.status,201);return r.body.vehicle;};
  const unknown=await create();const first=await send('POST',path,ruleBody,token,'rule-head-first');const old=await create();
  const second=await send('POST',path,{...ruleBody,minYear:2023,expectedCurrentVersion:first.body.rule.version},token,'rule-head-second');const fresh=await create();
  const {getCurrentVehicleRuleBinding}=await import('../src/core/vehicleRuleBindingRepository.js');
  assert.equal((await getCurrentVehicleRuleBinding(env,driverId,unknown.id)).ruleVersion,null);
  assert.equal((await getCurrentVehicleRuleBinding(env,driverId,old.id)).ruleVersion,first.body.rule.version);
  assert.equal((await getCurrentVehicleRuleBinding(env,driverId,fresh.id)).ruleVersion,second.body.rule.version);
  assert.ok(DB.sqlite.prepare('SELECT class,status FROM vehicles WHERE id IN (?,?,?)').all(unknown.id,old.id,fresh.id).every(r=>r.class===null&&r.status==='draft'));
});
test('rule/version details are immutable in SQL and audit omits reason and request bodies',async t=>{
  const {DB,send,owner}=await setup(t);const token=await owner();
  const made=await send('POST',path,{...ruleBody,reason:'PRIVATE_TEST_REASON'},token,'rule-immutable');assert.equal(made.status,201);
  assert.throws(()=>DB.sqlite.exec("UPDATE vehicle_classification_rule_definitions SET reason='changed'"));
  assert.throws(()=>DB.sqlite.exec('DELETE FROM vehicle_classification_rule_definitions'));
  const audits=JSON.stringify(DB.sqlite.prepare("SELECT * FROM audit_events WHERE action LIKE 'admin.vehicle_rule%'").all());
  assert.ok(!audits.includes('PRIVATE_TEST_REASON'));assert.ok(!audits.includes('Synthetic condition'));
});
test('Unicode keyset pagination is scoped and becomes stale after a new rule version',async t=>{
  const {send,owner}=await setup(t);const token=await owner();
  for(const model of ['Модель А','Модель Б'])assert.equal((await send('POST',path,{...ruleBody,model},token,'rule-unicode-'+(model.endsWith('А')?'a':'b'))).status,201);
  const first=await send('GET',path+'?make=Toyota&limit=1',undefined,token);assert.equal(first.status,200);assert.ok(first.body.nextCursor);
  const next=await send('GET',path+'?make=Toyota&limit=1&cursor='+first.body.nextCursor,undefined,token);assert.equal(next.status,200);assert.notEqual(first.body.rules[0].model,next.body.rules[0].model);
  assert.equal((await send('GET',path+'?make=Haval&cursor='+first.body.nextCursor,undefined,token)).status,400);
  await send('POST',path,{...ruleBody,model:'New model'},token,'rule-cursor-changed');
  assert.equal((await send('GET',path+'?make=Toyota&cursor='+first.body.nextCursor,undefined,token)).body.code,'rule_cursor_stale');
  for(const query of ['?limit=51','?limit=1&limit=2','?unknown=1','?cursor=bad','?make='])assert.equal((await send('GET',path+query,undefined,token)).status,400);
});
test('permission/MFA/session/owner revocation between precheck and batch prevents all publication',async t=>{
  for(const change of ["DELETE FROM staff_owner_binding",'UPDATE admin_mfa_session_families SET expires_at=verified_at+1',
    'UPDATE staff_sessions SET revoked_at=created_at','UPDATE staff_accounts SET token_version=token_version+1']){
    const {DB,send,owner}=await setup(t);const token=await owner(),batch=DB.batch.bind(DB);let altered=false;
    DB.batch=async statements=>{if(!altered){altered=true;DB.sqlite.exec(change);}return batch(statements);};
    assert.equal((await send('POST',path,ruleBody,token,'rule-late-revocation')).status,403,change);
    assert.equal(DB.sqlite.prepare('SELECT count(*) n FROM vehicle_classification_rules').get().n,0);
    assert.equal(DB.sqlite.prepare("SELECT count(*) n FROM mutation_idempotency WHERE operation='admin.vehicle_rule.create'").get().n,0);
  }
});
test('forged MFA context is insufficient without actual D1 family evidence',async t=>{
  const {DB,env,send,owner}=await setup(t);const token=await owner();
  const auth=await authenticateStaffRequest(new Request('https://fixture.invalid',{headers:{Authorization:'Bearer '+token}}),env);assert.equal(auth.ok,true);
  DB.sqlite.exec('DELETE FROM admin_mfa_session_families');
  const r=await createAdminVehicleRule(env,auth.user,ruleBody,{idempotencyKey:'rule-forged-evidence',mfa:{required:true,verified:true}});
  assert.equal(r.status,403);assert.equal(DB.sqlite.prepare('SELECT count(*) n FROM vehicle_classification_rules').get().n,0);
});
test('vehicle classification GET exposes declarations and pinned conditions but never fabricates verification',async t=>{
  const {DB,send}=await setup(t);const token=(await send('POST','/staff/login',{login:moderator,password:fixturePassword})).body.accessToken;
  const url='/v1/admin/vehicles/vehicle_fixture001/classification',r=await send('GET',url,undefined,token);assert.equal(r.status,200);
  assert.equal(r.body.verifiedParameters,null);assert.equal(r.body.classification,null);assert.deepEqual(r.body.evidence,[]);assert.deepEqual(r.body.history,[]);
  for(const value of ['TESTVIN','private_object_key','Synthetic Driver'])assert.ok(!JSON.stringify(r.body).includes(value));
  assert.equal((await send('GET','/v1/admin/vehicles/vehicle_missing000/classification',undefined,token)).status,404);
  DB.sqlite.prepare("DELETE FROM staff_permissions WHERE account_id=? AND permission='vehicles.verify'").run(moderator);
  assert.equal((await send('GET',url,undefined,token)).status,403);
});
test('body limit supports definitions above 4KiB, rejects >16KiB and does not expand auth payload limit',async t=>{
  const {send,owner}=await setup(t);const token=await owner();
  const conditions=Array.from({length:8},(_,i)=>'Condition'+i+'x'.repeat(900));
  assert.equal((await send('POST',path,{...ruleBody,conditions},token,'rule-larger-than-auth')).status,201);
  assert.equal((await send('POST',path,{...ruleBody,conditions:Array.from({length:20},(_,i)=>'C'+i+'x'.repeat(900))},token,'rule-payload-large')).status,400);
  assert.equal((await send('POST','/staff/login',{login:ownerId,password:'x'.repeat(5000)})).status,400);
  const request=()=>new Request('https://fixture.invalid',{method:'POST',body:JSON.stringify({data:'x'.repeat(5000)})});
  assert.equal(await boundedAuthJson(request()),null);assert.ok(await boundedAuthJson(request(),16384));
});
test('revoked read permission and revoked MFA on replay cannot expose a previously authorized result',async t=>{
  const {DB,send,owner}=await setup(t);const token=await owner();
  assert.equal((await send('POST',path,ruleBody,token,'rule-replay-revocation')).status,201);
  const batch=DB.batch.bind(DB);DB.batch=async statements=>{DB.sqlite.exec('DELETE FROM admin_mfa_session_families');return batch(statements);};
  assert.equal((await send('POST',path,ruleBody,token,'rule-replay-revocation')).status,403);
  DB.batch=batch;const dispatcher=(await send('POST','/staff/login',{login:moderator,password:fixturePassword})).body.accessToken;
  DB.batch=async statements=>{DB.sqlite.prepare("DELETE FROM staff_permissions WHERE account_id=? AND permission='vehicles.read'").run(moderator);return batch(statements);};
  const read=await send('GET',path,undefined,dispatcher);assert.equal(read.status,403);assert.equal(read.body.rules,undefined);
});
test('SQL rejects invalid rule body definitions independently of HTTP validation',async t=>{
  const {DB}=await setup(t);
  DB.sqlite.exec("INSERT INTO vehicle_classification_rules VALUES('rule_invalid_body','Toyota','Camry',1,2020,'business','',1)");
  assert.throws(()=>DB.sqlite.prepare('INSERT INTO vehicle_classification_rule_definitions VALUES(?,?,?,?,?,1)')
    .run('rule_invalid_body','["crossover"]','[]',ownerId,'Synthetic'));
  assert.throws(()=>DB.sqlite.prepare('INSERT INTO vehicle_classification_rule_definitions VALUES(?,?,?,?,?,1)')
    .run('rule_invalid_body','["sedan"]','[42]',ownerId,'Synthetic'));
});
test('owner-phone scope remains closed and unsupported review POST is not exposed',async t=>{
  const {env,send,owner}=await setup(t);
  const res=await worker.fetch(new Request('https://uber-v3-staging.lobanov0710.workers.dev/v1/admin/vehicle-rules'),
    {...env,APP_ENV:'staging',ADMIN_PHONE_TEST_ONLY:'true'},{});
  assert.equal(res.status,404);
  const token=await owner();
  assert.equal((await send('POST','/v1/admin/vehicles/vehicle_fixture001/classification/review',{},token,'review-not-implemented')).status,404);
});
test('populated migration21 ->22 preserves existing data and failed migration rolls back',async t=>{
  const DB=sqliteD1({throughMigration:21});t.after(()=>DB.sqlite.close());await seedRuleActors(DB);
  const tables=DB.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>r.name);
  const before=tables.map(name=>JSON.stringify(DB.sqlite.prepare('SELECT * FROM "'+name+'"').all()));
  const sql=readFileSync(new URL('../migrations/0022_vehicle_rule_definitions.sql',import.meta.url),'utf8');
  DB.sqlite.exec('BEGIN IMMEDIATE');assert.throws(()=>DB.sqlite.exec(sql+'\nSELECT * FROM intentionally_missing_rule_fixture;'));DB.sqlite.exec('ROLLBACK');
  assert.equal(DB.sqlite.prepare("SELECT name FROM sqlite_master WHERE name='vehicle_classification_rule_definitions'").get(),undefined);
  DB.sqlite.exec(sql);
  for(let i=0;i<tables.length;i++)assert.equal(JSON.stringify(DB.sqlite.prepare('SELECT * FROM "'+tables[i]+'"').all()),before[i],tables[i]);
  assert.equal(DB.sqlite.prepare('SELECT count(*) n FROM vehicle_classification_rule_definitions').get().n,0);
  assert.deepEqual(DB.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
});
test('competing publications use CAS and concurrent same-key retries create one immutable result',async t=>{
  const {DB,send,owner}=await setup(t);const token=await owner();
  const competing=await Promise.all([send('POST',path,ruleBody,token,'rule-competing-a'),send('POST',path,ruleBody,token,'rule-competing-b')]);
  assert.deepEqual(competing.map(x=>x.status).sort(),[201,409]);
  const version=competing.find(x=>x.status===201).body.rule.version;
  const body={...ruleBody,minYear:2023,expectedCurrentVersion:version};
  const same=await Promise.all([send('POST',path,body,token,'rule-concurrent-replay'),send('POST',path,body,token,'rule-concurrent-replay')]);
  assert.ok(same.every(x=>x.status===201));assert.deepEqual(same[0].body.rule,same[1].body.rule);
  assert.equal(DB.sqlite.prepare('SELECT count(*) n FROM vehicle_classification_rules').get().n,2);
  assert.equal(DB.sqlite.prepare("SELECT count(*) n FROM audit_events WHERE action='admin.vehicle_rule_created'").get().n,2);
});
test('read audit failure returns no metadata or raw database output',async t=>{
  const {DB,send,owner}=await setup(t);const token=await owner();
  await send('POST',path,ruleBody,token,'rule-read-audit');
  DB.sqlite.exec("CREATE TRIGGER fail_rule_read_audit BEFORE INSERT ON audit_events WHEN NEW.action IN ('admin.vehicle_rules_read','admin.vehicle_classification_read') BEGIN SELECT RAISE(ABORT,'PRIVATE_READ_PROVIDER_FAILURE'); END");
  for(const url of [path,'/v1/admin/vehicles/vehicle_fixture001/classification']){
    const r=await send('GET',url,undefined,token);assert.equal(r.status,500);assert.equal(r.body.rules,undefined);assert.equal(r.body.declaredParameters,undefined);
    assert.ok(!JSON.stringify(r.body).includes('PRIVATE_READ_PROVIDER_FAILURE'));
  }
});
test('approved CSV spellings remain exact; legacy notes and maximum-length versions remain readable',async t=>{
  const {DB,send,owner}=await setup(t);const token=await owner();
  for(const make of ['EXEED','Skoda'])assert.equal((await send('POST',path,{...ruleBody,make},token,'rule-approved-'+make)).status,201);
  const version='v'.repeat(128),notes='Original note, with no invented split';
  DB.sqlite.prepare('INSERT INTO vehicle_classification_rules VALUES(?,?,?,?,?,?,?,1)').run(version,'Toyota','Legacy model',1,2020,'comfort',notes);
  const r=await send('GET',path+'/versions/'+version,undefined,token);assert.equal(r.status,200);
  assert.deepEqual(r.body.rule.conditions,[{id:version+':1',text:notes}]);
  assert.equal(DB.sqlite.prepare("SELECT target_id FROM audit_events WHERE action='admin.vehicle_rule_read'").get().target_id.length,73);
});
test('read fails closed if access expires during its audit or audit insertion is suppressed',async t=>{
  const {DB,send}=await setup(t);
  const token=(await send('POST','/staff/login',{login:moderator,password:fixturePassword})).body.accessToken;
  DB.sqlite.exec("CREATE TRIGGER revoke_during_read BEFORE INSERT ON audit_events WHEN NEW.action='admin.vehicle_rules_read' BEGIN DELETE FROM staff_permissions WHERE permission='vehicles.read'; END");
  const revoked=await send('GET',path,undefined,token);assert.equal(revoked.status,403);assert.equal(revoked.body.rules,undefined);
  DB.sqlite.exec('DROP TRIGGER revoke_during_read');
  DB.sqlite.prepare("INSERT INTO staff_permissions VALUES(?,'vehicles.read',?,1)").run(moderator,moderator);
  DB.sqlite.exec("CREATE TRIGGER suppress_read_audit BEFORE INSERT ON audit_events WHEN NEW.action='admin.vehicle_rules_read' BEGIN SELECT RAISE(IGNORE); END");
  const noAudit=await send('GET',path,undefined,token);assert.equal(noAudit.status,500);assert.equal(noAudit.body.rules,undefined);
});
