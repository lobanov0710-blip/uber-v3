import assert from 'node:assert/strict';
import test from 'node:test';
import router from '../src/router.js';
import worker from '../src/index.js';
import { sqliteD1 } from './helpers/sqliteD1.mjs';
import { seedVehicleReads,vehicleReadWorkflow,car,car2,minimal } from './helpers/adminVehicleReadScenario.mjs';
import { moderator,fixturePassword,driverId } from './helpers/adminModerationScenario.mjs';
import { getAdminVehicles,getAdminVehiclePhotoChecks } from '../src/core/adminVehicleReadService.js';
import { provisionOwnerBootstrap } from '../src/core/ownerMfaControlPlane.js';
import { startOwnerMfaEnrollment,confirmOwnerMfaEnrollment,verifyOwnerMfa } from '../src/core/ownerMfaService.js';
import { loginStaff } from '../src/core/staffAuthService.js';
import { totp,unbase32 } from '../src/core/ownerMfaCrypto.js';
const list='/v1/admin/vehicles',checks=list+'/'+car+'/photo-checks',user={id:moderator,role:'admin'};
async function setup(t){
  const DB=sqliteD1();t.after(()=>DB.sqlite.close());await seedVehicleReads(DB);
  const env={DB,JWT_SECRET:'synthetic-photo-read-jwt-01234567890123456789',ADMIN_MFA_ENCRYPTION_KEY:Buffer.alloc(32,9).toString('base64')};
  const send=async(path,token,body,key,method)=>{
    const response=await router(new Request('https://fixture.invalid'+path,{method:method??(body?'POST':'GET'),headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...(key?{'Idempotency-Key':key}:{})},...(body?{body:JSON.stringify(body)}:{})}),env,{});
    assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');
    const data=await response.json();if(path.startsWith('/v1/'))assert.match(data.requestId,/^req_[0-9a-f-]{36}$/);return {status:response.status,body:data};
  };
  const session=await loginStaff(env,{login:moderator,password:fixturePassword},{ip:'203.0.113.20'});assert.equal(session.ok,true);
  return {DB,env,send,token:session.accessToken};
}
test('actual HTTP read/create/read workflow: minimal projection, scoped paging, current revision, grants and audits',async t=>{const {DB,send}=await setup(t);await vehicleReadWorkflow(DB,send);});
test('strict queries reject unknown/repeated/empty values and malformed IDs without read audit',async t=>{
  const {DB,send,token}=await setup(t);
  for(const suffix of ['?limit=','?limit=0','?limit=51','?limit=01','?limit=1.5','?limit=2&limit=2','?status=','?status=unknown','?status=approved&status=approved','?driverId='+driverId,'?mfaVerified=true','?cursor=','?cursor=%%%','?cursor='+'a'.repeat(513)])assert.equal((await send(list+suffix,token)).status,400,suffix);
  assert.equal((await send(checks+'?status=approved',token)).status,400);
  assert.equal((await send(list+'/%2Finvalid/photo-checks',token)).status,400);
  assert.equal((await send(list+'/vehicle_missing123/photo-checks',token)).status,404);
  assert.equal(DB.sqlite.prepare("SELECT count(*) n FROM audit_events WHERE action LIKE 'admin.%_read'").get().n,0);
});
test('empty collection and six existing vehicle-status filters stay explicit',async t=>{
  const {send,token}=await setup(t);
  for(const status of ['draft','pending_review','approved','photo_check_required','suspended','rejected']){const r=await send(list+'?status='+status,token);assert.equal(r.status,200);assert.ok(r.body.vehicles.every(v=>v.status===status));if(status!=='approved'){assert.deepEqual(r.body.vehicles,[]);assert.equal(r.body.nextCursor,null);}}
});
test('keyset vehicles has no 1000-row cutoff or duplicate',async t=>{
  const {DB,send,token}=await setup(t);DB.sqlite.exec('BEGIN');
  for(let n=0;n<1003;n++)DB.sqlite.prepare("INSERT INTO vehicles(id,driver_id,vin,plate,make,model,class,capacity,status,created_at,updated_at) VALUES(?,?,'TESTVIN0000000003','T','Test','Car','comfort',4,'draft',1,1)").run('vehicle_page'+String(n).padStart(8,'0'),driverId);
  DB.sqlite.exec('COMMIT');const ids=[];let cursor=null;
  do {const r=await send(list+'?limit=50'+(cursor?'&cursor='+cursor:''),token);assert.equal(r.status,200);ids.push(...r.body.vehicles.map(v=>v.id));cursor=r.body.nextCursor;}while(cursor);
  assert.equal(ids.length,1005);assert.equal(new Set(ids).size,1005);assert.deepEqual(ids,[...ids].sort());
});
test('provider or audit failure returns safe500 with no projection',async t=>{
  const {DB,send,token}=await setup(t);DB.sqlite.exec("CREATE TRIGGER deny_vehicle_audit BEFORE INSERT ON audit_events WHEN NEW.action IN ('admin.vehicles_read','admin.vehicle_photo_checks_read') BEGIN SELECT RAISE(ABORT,'PRIVATE_PROVIDER_SQL'); END");
  for(const path of [list,checks]){const r=await send(path,token);assert.equal(r.status,500);assert.equal(r.body.vehicles,undefined);assert.equal(r.body.checks,undefined);assert.ok(!JSON.stringify(r.body).includes('PRIVATE_PROVIDER_SQL'));}
});
test('noncanonical and wrongly scoped cursors fail closed',async t=>{
  const {send,token}=await setup(t);
  for(const value of [["admin.vehicles.v1","",4],["admin.vehicles.v1","",car,'extra'],["admin.vehicles.v1",'draft',car]]){
    const cursor=btoa(JSON.stringify(value)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');assert.equal((await send(list+'?cursor='+cursor,token)).status,400);
  }
  assert.equal((await send(list+'?cursor='+btoa('["admin.vehicles.v1","","'+car+'"]')+'=',token)).status,400);
});
test('unsafe stored revisions fail rather than being rounded or leaked',async t=>{
  const {DB,send,token}=await setup(t);DB.sqlite.prepare('UPDATE vehicles SET revision=? WHERE id=?').run(9007199254740992,car);
  assert.equal((await send(list,token)).status,500);assert.equal((await send(checks,token)).status,500);
});
test('OWNER needs actual current server MFA and revocation withholds metadata',async t=>{
  t.mock.method(Date,'now',()=>1800000000000);const {DB,env,send,token}=await setup(t);
  DB.sqlite.prepare('INSERT INTO staff_owner_binding(singleton,account_id,created_at) VALUES(1,?,1)').run(moderator);
  assert.equal((await send(list,token)).status,401);
  assert.equal((await getAdminVehicles(env,user,new URLSearchParams(),{mfa:{verified:true}})).status,403);
  assert.equal((await getAdminVehiclePhotoChecks(env,user,car,new URLSearchParams('mfaVerified=true'))).status,403);
  const ctx={ip:'203.0.113.20'},boot=await provisionOwnerBootstrap(env,moderator),first=await loginStaff(env,{login:moderator,password:fixturePassword},ctx);
  const enrollment=await startOwnerMfaEnrollment(env,{challengeId:first.challengeId,bootstrapCode:boot.bootstrapCode},ctx);const seed=unbase32(enrollment.secret);
  assert.equal((await confirmOwnerMfaEnrollment(env,{enrollmentId:enrollment.enrollmentId,code:await totp(seed,Math.floor(Date.now()/30000))},ctx)).ok,true);
  const next=await loginStaff(env,{login:moderator,password:fixturePassword},ctx);const verified=await verifyOwnerMfa(env,{challengeId:next.challengeId,code:await totp(seed,Math.floor(Date.now()/30000)+1)},ctx);
  for(const path of [list,checks]){const r=await send(path,verified.accessToken);assert.equal(r.status,200);minimal(r.body);}
  DB.sqlite.exec('DELETE FROM admin_mfa_session_families');assert.equal((await send(checks,verified.accessToken)).status,401);
});
test('wrong method and owner-phone scope preserve the existing boundary',async t=>{
  const {send,token}=await setup(t);assert.equal((await send(list,token,undefined,undefined,'POST')).status,405);
  for(const path of [list,checks]){const r=await worker.fetch(new Request('https://uber-v3-staging.lobanov0710.workers.dev'+path),{APP_ENV:'staging',ADMIN_PHONE_TEST_ONLY:'true'},{});assert.equal(r.status,404);assert.equal((await r.json()).code,'admin_phone_route_unavailable');}
});

// The two approved restriction modes must differ for an already active trip.
for(const mode of ['after_current_trip','immediate'])test('active assignment phase respects '+mode,async t=>{
  const {DB,env}=await setup(t);
  DB.sqlite.prepare("INSERT INTO orders(id,name,phone,route,trip_date,status,driver_id,created_at,updated_at) VALUES('order_photo_active','Test','+79990000000','Test','2030-01-01','taken',?,1,1)").run(driverId);
  DB.sqlite.prepare("INSERT INTO order_assignments(id,order_id,driver_id,vehicle_id,state,assigned_by,reason,created_at,phase) VALUES('assignment_photo_active','order_photo_active',?,?,'active',?,'Synthetic',1,'en_route_to_pickup')").run(driverId,car,moderator);
  DB.sqlite.prepare("INSERT INTO vehicle_photo_checks(id,vehicle_id,kind,reason,due_at,grace_until,result,created_at,updated_at,restriction_mode) VALUES('photo-check_active001',?,'manual','Synthetic',1,1,'pending',1,1,?)").run(car,mode);
  const {changeDriverAssignmentPhase}=await import('../src/core/driverTripOperationalService.js');
  const result=await changeDriverAssignmentPhase(env,{id:driverId,role:'driver'},'assignment_photo_active',{phase:'arrived',expectedRevision:1},{idempotencyKey:'photo-active-'+mode});
  assert.equal(result.ok,mode==='after_current_trip');
  assert.equal(DB.sqlite.prepare("SELECT phase FROM order_assignments WHERE id='assignment_photo_active'").get().phase,mode==='after_current_trip'?'arrived':'en_route_to_pickup');
  assert.equal(DB.sqlite.prepare("SELECT state FROM order_assignments WHERE id='assignment_photo_active'").get().state,'active');
});

test('immediate restriction created after phase precheck still blocks atomic SQL mutation',async t=>{
  const {DB,env}=await setup(t);
  DB.sqlite.prepare("INSERT INTO orders(id,name,phone,route,trip_date,status,driver_id,created_at,updated_at) VALUES('order_photo_race','Test','+79990000000','Test','2030-01-01','taken',?,1,1)").run(driverId);
  DB.sqlite.prepare("INSERT INTO order_assignments(id,order_id,driver_id,vehicle_id,state,assigned_by,reason,created_at,phase) VALUES('assignment_photo_race','order_photo_race',?,?,'active',?,'Synthetic',1,'en_route_to_pickup')").run(driverId,car,moderator);
  const batch=DB.batch.bind(DB);DB.batch=async statements=>{DB.sqlite.prepare("INSERT INTO vehicle_photo_checks(id,vehicle_id,kind,reason,due_at,grace_until,result,created_at,updated_at,restriction_mode) VALUES('photo-check_phase_race',?,'manual','Synthetic',1,1,'pending',1,1,'immediate')").run(car);return batch(statements);};
  const {changeDriverAssignmentPhase}=await import('../src/core/driverTripOperationalService.js');
  const result=await changeDriverAssignmentPhase(env,{id:driverId,role:'driver'},'assignment_photo_race',{phase:'arrived',expectedRevision:1},{idempotencyKey:'photo-phase-race'});
  assert.equal(result.ok,false);assert.equal(result.status,409);
  assert.equal(DB.sqlite.prepare("SELECT revision FROM order_assignments WHERE id='assignment_photo_race'").get().revision,1);
  assert.equal(DB.sqlite.prepare("SELECT count(*) n FROM audit_events WHERE action='driver.assignment.phase'").get().n,0);
});
