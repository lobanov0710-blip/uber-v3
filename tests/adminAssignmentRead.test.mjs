import assert from 'node:assert/strict';
import test from 'node:test';
import router from '../src/router.js';
import worker from '../src/index.js';
import { sqliteD1 } from './helpers/sqliteD1.mjs';
import { seedModeration, moderator, fixturePassword, driverId } from './helpers/adminModerationScenario.mjs';
import { getAdminOrders, getAdminAssignmentOptions } from '../src/core/adminAssignmentReadService.js';
import { assignOrderByAdmin, reassignOrderByAdmin } from '../src/core/orderAssignmentService.js';
import { provisionOwnerBootstrap } from '../src/core/ownerMfaControlPlane.js';
import { startOwnerMfaEnrollment, confirmOwnerMfaEnrollment, verifyOwnerMfa } from '../src/core/ownerMfaService.js';
import { loginStaff } from '../src/core/staffAuthService.js';
import { totp, unbase32 } from '../src/core/ownerMfaCrypto.js';

const orderId='order_read123', car='vehicle_fixture001', car2='vehicle_fixture002';
const permissions=['orders.read','orders.assign','orders.reassign','drivers.read','vehicles.read'];
const user={id:moderator,role:'admin'};
function grants(DB, values=permissions) {
  DB.sqlite.prepare('DELETE FROM staff_permissions WHERE account_id=?').run(moderator);
  const insert=DB.sqlite.prepare('INSERT INTO staff_permissions(account_id,permission,granted_by,created_at) VALUES(?,?,?,1)');
  for(const p of values)insert.run(moderator,p,moderator);
}
function order(DB,id=orderId,status='new') {
  DB.sqlite.prepare(`INSERT INTO orders(id,name,phone,route,from_place,to_place,trip_date,tariff,comment,status,created_at,updated_at)
    VALUES(?,'SYNTHETIC_PRIVATE_PASSENGER','+79990000001','PRIVATE ROUTE','Origin','Destination','2030-01-01','comfort','SYNTHETIC_PRIVATE_COMMENT',?,1,1)`).run(id,status);
}
async function setup(t) {
  const DB=sqliteD1();t.after(()=>DB.sqlite.close());await seedModeration(DB);grants(DB);order(DB);
  DB.sqlite.exec("UPDATE driver_profiles SET registration_status='approved',identity_status='verified'; UPDATE vehicles SET status='approved'");
  DB.sqlite.prepare(`INSERT INTO vehicles(id,driver_id,vin,plate,make,model,class,capacity,status,created_at,updated_at)
    VALUES(?,?,'TESTVIN0000000002','TEST2','Test','Car2','comfort',4,'approved',1,1)`).run(car2,driverId);
  const env={DB,JWT_SECRET:'synthetic-assignment-read-jwt-01234567890123456789',ADMIN_MFA_ENCRYPTION_KEY:Buffer.alloc(32,9).toString('base64')};
  async function send(path,token,method='GET') {
    const response=await router(new Request('https://fixture.invalid'+path,{method,headers:token?{Authorization:'Bearer '+token}:{}}),env,{});
    assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');
    const body=await response.json();assert.match(body.requestId,/^req_[0-9a-f-]{36}$/);return {status:response.status,body};
  }
  const session=await loginStaff(env,{login:moderator,password:fixturePassword},{ip:'203.0.113.22'});assert.equal(session.ok,true);
  return {DB,env,send,token:session.accessToken};
}
const params=s=>new URLSearchParams(s);
const optionsPath='/v1/admin/orders/'+orderId+'/assignment-options';
const key=n=>({idempotencyKey:'synthetic-assignment-'+n});
const mutation=(vehicleId=car,expectedRevision=1)=>({driverId,vehicleId,expectedRevision,reason:'Synthetic manual assignment'});
const auditCount=DB=>DB.sqlite.prepare("SELECT count(*) n FROM audit_events WHERE action IN('admin.orders_read','admin.assignment_options_read')").get().n;

function minimal(result) {
  const encoded=JSON.stringify(result);
  for(const secret of ['SYNTHETIC_PRIVATE_PASSENGER','SYNTHETIC_PRIVATE_COMMENT','+79990000001','+79990000000','TESTVIN','private_object_key','passport','password','secret','refreshToken'])assert.ok(!encoded.includes(secret),secret);
}

test('actual HTTP minimal orders and options need only operational grants, with no passenger/private material',async t=>{
  const {DB,send,token}=await setup(t);
  const list=await send('/v1/admin/orders',token);assert.equal(list.status,200);minimal(list.body);
  assert.deepEqual(Object.keys(list.body.orders[0]).sort(),['id','from','to','date','tariff','status','revision','assignment'].sort());
  assert.equal(list.body.orders[0].assignment,null);assert.equal(list.body.nextCursor,null);
  const choices=await send(optionsPath,token);assert.equal(choices.status,200);minimal(choices.body);assert.equal(choices.body.orderRevision,1);
  assert.equal(choices.body.options.length,2);assert.ok(choices.body.options.every(x=>x.eligible&&x.availability.state==='off_line'));
  assert.deepEqual(Object.keys(choices.body.options[0]).sort(),['driverId','fullName','vehicleId','make','model','plate','status','availability','eligible','blockers'].sort());
  assert.equal(auditCount(DB),2);
  const audits=DB.sqlite.prepare("SELECT action,target_id,request_id FROM audit_events WHERE action LIKE 'admin.%_read'").all();minimal(audits);assert.ok(audits.every(x=>x.request_id.startsWith('req_')));
});

test('keyset orders enumerate more than legacy 1000 with no duplicate, omission or hidden cutoff',async t=>{
  const {DB,send,token}=await setup(t);DB.sqlite.exec('BEGIN');for(let i=0;i<1105;i++)order(DB,'order_page'+String(i).padStart(5,'0'));DB.sqlite.exec('COMMIT');
  let cursor=null;const ids=[];do {
    const page=await send('/v1/admin/orders?limit=50'+(cursor?'&cursor='+cursor:''),token);assert.equal(page.status,200);assert.ok(page.body.orders.length<=50);
    ids.push(...page.body.orders.map(x=>x.id));cursor=page.body.nextCursor;
  }while(cursor);
  assert.equal(ids.length,1106);assert.equal(new Set(ids).size,1106);assert.deepEqual(ids,[...ids].sort());
});

test('candidate keyset uses driver plus vehicle and order/status-bound cursors reject reuse',async t=>{
  const {DB,env}=await setup(t);order(DB,'order_other123');
  DB.sqlite.exec(`INSERT INTO staff_accounts(id,login,display_name,role,status,password_algorithm,password_iterations,password_salt,password_hash,token_version,password_changed_at,created_at,updated_at) SELECT 'staff_driver456','driver456',display_name,role,status,password_algorithm,password_iterations,password_salt,password_hash,token_version,password_changed_at,created_at,updated_at FROM staff_accounts WHERE id='${driverId}'`);
  DB.sqlite.prepare(`INSERT INTO driver_profiles(staff_account_id,normalized_phone,created_at,updated_at) VALUES('staff_driver456','+79990000002',1,1)`).run();
  DB.sqlite.prepare(`INSERT INTO vehicles(id,driver_id,vin,plate,make,model,class,capacity,status,created_at,updated_at) VALUES('vehicle_fixture003','staff_driver456','TESTVIN0000000003','TEST3','Test','Car3','comfort',4,'approved',1,1)`).run();
  const first=await getAdminAssignmentOptions(env,user,orderId,params('limit=1'));assert.equal(first.options[0].vehicleId,car);assert.ok(first.nextCursor);
  const second=await getAdminAssignmentOptions(env,user,orderId,params('limit=1&cursor='+first.nextCursor));assert.equal(second.options[0].vehicleId,car2);assert.ok(second.nextCursor);
  const third=await getAdminAssignmentOptions(env,user,orderId,params('limit=1&cursor='+second.nextCursor));assert.equal(third.options[0].driverId,'staff_driver456');assert.equal(third.nextCursor,null);
  assert.equal((await getAdminAssignmentOptions(env,user,'order_other123',params('cursor='+first.nextCursor))).status,400);
  const list=await getAdminOrders(env,user,params('status=new&limit=1'));
  assert.equal((await getAdminOrders(env,user,params('status=taken&cursor='+list.nextCursor))).status,400);
  assert.equal((await getAdminOrders(env,user,params('cursor='+first.nextCursor))).status,400);
});

test('strict query rejects unknown/duplicate parameters, malformed types, bounds and noncanonical cursor before reading content',async t=>{
  const {DB,send,token}=await setup(t);
  for(const suffix of ['?limit=0','?limit=51','?limit=01','?limit=1.5','?limit=','?limit=2&limit=2','?status=','?status=completed','?driverId=staff_driver123','?mfaVerified=true','?cursor=','?cursor=%%%','?cursor='+'a'.repeat(513),'?cursor='+btoa('["admin.orders.v1","",12345678]')]){
    const result=await send('/v1/admin/orders'+suffix,token);assert.equal(result.status,400,suffix);assert.equal(result.body.orders,undefined);
  }
  assert.equal((await send(optionsPath+'?status=new',token)).status,400);
  assert.equal((await send('/v1/admin/orders/%2Finvalid/assignment-options',token)).status,400);
  assert.equal((await send('/v1/admin/orders/order_missing123/assignment-options',token)).status,404);
  assert.equal(auditCount(DB),0);
});

test('401/403, current permission revocation and action-specific grants fail closed without data or audit',async t=>{
  const {DB,send,token}=await setup(t);
  for(const path of ['/v1/admin/orders',optionsPath]){
    assert.equal((await send(path)).status,401);assert.equal((await send(path,'invalid')).status,401);assert.equal((await send(path,token,'POST')).status,405);
  }
  for(const missing of ['orders.read','drivers.read','vehicles.read']){
    grants(DB,permissions.filter(p=>p!==missing));assert.equal((await send(optionsPath,token)).status,403);
  }
  grants(DB,['orders.read','drivers.read','vehicles.read','orders.reassign']);assert.equal((await send(optionsPath,token)).status,403);
  grants(DB,[]);const denied=await send('/v1/admin/orders',token);assert.equal(denied.status,403);assert.equal(denied.body.orders,undefined);assert.equal(auditCount(DB),0);
});

test('filter returns only operational status and assigned snapshot; reassign requires its grant and blocks unchanged pair/in_progress',async t=>{
  const {DB,env,send,token}=await setup(t);assert.equal((await assignOrderByAdmin(env,user,orderId,mutation(),key('assign'))).ok,true);
  const list=await send('/v1/admin/orders?status=taken',token);assert.equal(list.body.orders[0].status,'taken');assert.equal(list.body.orders[0].assignment.phase,'assigned');minimal(list.body);
  assert.equal((await send('/v1/admin/orders?status=new',token)).body.orders.length,0);
  grants(DB,['orders.read','drivers.read','vehicles.read','orders.assign']);assert.equal((await send(optionsPath,token)).status,403);
  grants(DB,['orders.read','drivers.read','vehicles.read','orders.reassign']);let choices=(await send(optionsPath,token)).body.options;
  assert.deepEqual(choices.find(x=>x.vehicleId===car).blockers,['assignment_unchanged']);assert.equal(choices.find(x=>x.vehicleId===car2).eligible,true);
  DB.sqlite.exec("UPDATE orders SET status='in_progress'");choices=(await send(optionsPath,token)).body.options;assert.ok(choices.every(x=>x.blockers.includes('order_not_reassignable')));
});

test('read shares actual mutation eligibility: approval, identity, photo grace, vehicle suspension and online active-car mismatch',async t=>{
  const {DB,env}=await setup(t);
  const checks=[
    ["UPDATE driver_profiles SET registration_status='changes_required'",'driver_not_approved'],
    ["UPDATE driver_profiles SET identity_status='pending'",'identity_verification_required'],
    ["UPDATE vehicles SET status='suspended' WHERE id='"+car+"'",'vehicle_not_approved'],
    ["UPDATE vehicles SET next_photo_check_due_at="+(Date.now()-86400001)+" WHERE id='"+car+"'",'vehicle_photo_control_required']
  ];
  for(const [sql,code]of checks){
    DB.sqlite.exec(sql);const snapshot=await getAdminAssignmentOptions(env,user,orderId);assert.ok(snapshot.options.find(x=>x.vehicleId===car).blockers.includes(code));
    assert.equal((await assignOrderByAdmin(env,user,orderId,mutation(),key(code))).code,code);
    DB.sqlite.exec("UPDATE driver_profiles SET registration_status='approved',identity_status='verified'; UPDATE vehicles SET status='approved',next_photo_check_due_at=NULL");
  }
  DB.sqlite.prepare('INSERT INTO driver_availability(driver_id,state,active_vehicle_id,updated_at) VALUES(?,?,?,1)').run(driverId,'on_line',car2);
  const mismatch=(await getAdminAssignmentOptions(env,user,orderId)).options.find(x=>x.vehicleId===car);assert.ok(mismatch.blockers.includes('active_vehicle_mismatch'));
  assert.equal((await assignOrderByAdmin(env,user,orderId,mutation(),key('mismatch'))).code,'active_vehicle_mismatch');
  DB.sqlite.exec("UPDATE driver_availability SET state='off_line'");assert.equal((await getAdminAssignmentOptions(env,user,orderId)).options.find(x=>x.vehicleId===car).eligible,true);
  t.mock.method(Date,'now',()=>1800000000000);DB.sqlite.prepare('UPDATE vehicles SET next_photo_check_due_at=? WHERE id=?').run(Date.now()-86400000,car);
  assert.equal((await getAdminAssignmentOptions(env,user,orderId)).options.find(x=>x.vehicleId===car).eligible,true);
});

for(const status of ['pending','suspended','disabled'])test('inactive driver '+status+' cannot be presented eligible or assigned',async t=>{
  const {DB,env}=await setup(t);DB.sqlite.prepare('UPDATE staff_accounts SET status=? WHERE id=?').run(status,driverId);
  const row=(await getAdminAssignmentOptions(env,user,orderId)).options.find(x=>x.vehicleId===car);assert.ok(row.blockers.includes('driver_not_active'));
  assert.equal((await assignOrderByAdmin(env,user,orderId,mutation(),key('inactive'))).code,'driver_not_active');
});

for(const reassign of [false,true])test('actual SQL rejects account suspension after precheck during '+(reassign?'reassign':'assign'),async t=>{
  const {DB,env}=await setup(t);if(reassign)assert.equal((await assignOrderByAdmin(env,user,orderId,mutation(),key('initial'))).ok,true);
  const before=DB.sqlite.prepare('SELECT count(*) n FROM audit_events').get().n;
  const original=DB.batch.bind(DB);DB.batch=async statements=>{DB.sqlite.prepare("UPDATE staff_accounts SET status='disabled' WHERE id=?").run(driverId);return original(statements);};
  const result=await (reassign?reassignOrderByAdmin:assignOrderByAdmin)(env,user,orderId,mutation(reassign?car2:car,reassign?2:1),key('race'));
  assert.equal(result.ok,false);assert.equal(result.status,409);
  assert.equal(DB.sqlite.prepare('SELECT revision FROM orders WHERE id=?').get(orderId).revision,reassign?2:1);
  assert.equal(DB.sqlite.prepare('SELECT count(*) n FROM audit_events').get().n,before);
});

test('HTTP provider/audit failure returns safe 500 and withholds the projection; empty list has explicit null cursor',async t=>{
  const {DB,send,token}=await setup(t);const empty=await send('/v1/admin/orders?status=in_progress',token);assert.equal(empty.status,200);assert.deepEqual(empty.body.orders,[]);assert.equal(empty.body.nextCursor,null);
  DB.sqlite.exec("CREATE TRIGGER deny_read_audit BEFORE INSERT ON audit_events WHEN NEW.action LIKE 'admin.%_read' BEGIN SELECT RAISE(ABORT,'SYNTHETIC_SQL_PRIVATE_PROVIDER'); END");
  const result=await send(optionsPath,token);assert.equal(result.status,500);assert.equal(result.body.options,undefined);assert.ok(!JSON.stringify(result.body).includes('SYNTHETIC_SQL_PRIVATE_PROVIDER'));
});

test('OWNER uses actual server MFA evidence; password-only/forged client flags fail and expired evidence revokes read',async t=>{
  t.mock.method(Date,'now',()=>1800000000000);const {DB,env,send,token}=await setup(t);
  DB.sqlite.prepare('INSERT INTO staff_owner_binding(singleton,account_id,created_at) VALUES(1,?,1)').run(moderator);
  assert.equal((await send('/v1/admin/orders',token)).status,401);
  assert.equal((await getAdminOrders(env,user,params('mfaVerified=true'))).status,403);
  const context={ip:'203.0.113.22'},boot=await provisionOwnerBootstrap(env,moderator),first=await loginStaff(env,{login:moderator,password:fixturePassword},context);
  const start=await startOwnerMfaEnrollment(env,{challengeId:first.challengeId,bootstrapCode:boot.bootstrapCode},context);assert.equal(start.ok,true);
  const seed=unbase32(start.secret);assert.equal((await confirmOwnerMfaEnrollment(env,{enrollmentId:start.enrollmentId,code:await totp(seed,Math.floor(Date.now()/30000))},context)).ok,true);
  const next=await loginStaff(env,{login:moderator,password:fixturePassword},context);
  const verified=await verifyOwnerMfa(env,{challengeId:next.challengeId,code:await totp(seed,Math.floor(Date.now()/30000)+1)},context);assert.equal(verified.ok,true);
  for(const path of ['/v1/admin/orders',optionsPath])assert.equal((await send(path,verified.accessToken)).status,200);
  DB.sqlite.exec('DELETE FROM admin_mfa_session_families');assert.equal((await send('/v1/admin/orders',verified.accessToken)).status,401);
});

test('OWNER-only staging whitelist still blocks both operational APIs before database/auth access',async()=>{
  const env={APP_ENV:'staging',ADMIN_PHONE_TEST_ONLY:'true'};
  for(const path of ['/v1/admin/orders',optionsPath]){
    const response=await worker.fetch(new Request('https://uber-v3-staging.lobanov0710.workers.dev'+path),env,{});assert.equal(response.status,404);assert.equal((await response.json()).code,'admin_phone_route_unavailable');
  }
});
