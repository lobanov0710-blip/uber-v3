import test from 'node:test';
import assert from 'node:assert/strict';
import { sqliteD1 } from './helpers/sqliteD1.mjs';
import { hashStaffPassword } from '../src/core/staffAuthCrypto.js';
import { provisionOwnerBootstrap } from '../src/core/ownerMfaControlPlane.js';
import { unbase32,totp } from '../src/core/ownerMfaCrypto.js';
import router from '../src/router.js';
const password='Fixture-Owner-Password-123!',v=await hashStaffPassword(password);
function setup(t){
 const DB=sqliteD1();t.after(()=>DB.sqlite.close());
 for(const [id,login]of [['owner-http','owner.fixture'],['dispatcher-http','dispatcher.fixture']])DB.sqlite.prepare(`INSERT INTO staff_accounts(id,login,display_name,role,status,password_algorithm,password_iterations,password_salt,password_hash,password_changed_at,created_at,updated_at)
 VALUES(?,?,?,'admin','active',?,?,?,?,1,1,1)`).run(id,login,id,v.passwordAlgorithm,v.passwordIterations,v.passwordSalt,v.passwordHash);
 DB.sqlite.prepare('INSERT INTO staff_owner_binding(singleton,account_id,created_at) VALUES(1,?,1)').run('owner-http');
 return {DB,JWT_SECRET:'fixture-http-jwt-key-01234567890123456789',ADMIN_MFA_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64')};
}
async function send(env,path,body,headers={}){
 const response=await router(new Request('https://fixture.invalid'+path,{method:'POST',headers:{'Content-Type':'application/json','CF-Connecting-IP':'203.0.113.10',...headers},body:JSON.stringify(body)}),env,{});
 return {status:response.status,headers:response.headers,body:await response.json()};
}
async function enroll(env){
 const boot=await provisionOwnerBootstrap(env,'owner-http'),first=await send(env,'/staff/login',{login:'owner.fixture',password});
 assert.equal(first.status,200);assert.equal(first.body.mfaRequired,true);assert.equal(first.body.accessToken,undefined);assert.equal(first.headers.get('Cache-Control'),'no-store');
 const start=await send(env,'/v1/admin/mfa/enrollment/start',{challengeId:first.body.challengeId,bootstrapCode:boot.bootstrapCode});
 assert.equal(start.status,200);assert.equal(start.headers.get('Cache-Control'),'no-store');
 const seed=unbase32(start.body.secret),confirm=await send(env,'/v1/admin/mfa/enrollment/confirm',{enrollmentId:start.body.enrollmentId,code:await totp(seed,Math.floor(Date.now()/30000))});
 assert.equal(confirm.status,200);assert.equal(confirm.body.recoveryCodes.length,10);assert.equal(confirm.body.accessToken,undefined);
 return {seed,codes:confirm.body.recoveryCodes,start,confirm};
}
test('public enrollment/TOTP routes return no token before MFA and expose authoritative evidence only after proof',async t=>{
 const env=setup(t),state=await enroll(env),challenge=await send(env,'/staff/login',{login:'owner.fixture',password});
 const login=await send(env,'/v1/admin/mfa/totp/verify',{challengeId:challenge.body.challengeId,code:await totp(state.seed,Math.floor(Date.now()/30000)+1)});
 assert.equal(login.status,200);assert.ok(login.body.accessToken);assert.equal(login.headers.get('Cache-Control'),'no-store');
 const me=await router(new Request('https://fixture.invalid/v1/admin/me',{headers:{Authorization:'Bearer '+login.body.accessToken}}),env,{});
 assert.equal(me.status,200);const profile=await me.json();assert.equal(profile.admin.role,'owner');assert.equal(profile.admin.mfa.verified,true);assert.ok(profile.admin.mfa.expiresAt>Date.now());
 const repeated=await send(env,'/v1/admin/mfa/enrollment/confirm',{enrollmentId:state.start.body.enrollmentId,code:'123456'});
 assert.equal(repeated.status,401);assert.equal(repeated.body.recoveryCodes,undefined);assert.equal(repeated.body.secret,undefined);
});
test('public recovery is one-time and body account/role/client MFA flags never authorize',async t=>{
 const env=setup(t),state=await enroll(env),challenge=await send(env,'/staff/login',{login:'owner.fixture',password});
 const recovered=await send(env,'/v1/admin/mfa/recovery/verify',{challengeId:challenge.body.challengeId,recoveryCode:state.codes[0]});assert.equal(recovered.status,200);
 const next=await send(env,'/staff/login',{login:'owner.fixture',password});
 assert.equal((await send(env,'/v1/admin/mfa/recovery/verify',{challengeId:next.body.challengeId,recoveryCode:state.codes[0]})).status,401);
 assert.equal((await send(env,'/v1/admin/mfa/totp/verify',{challengeId:next.body.challengeId,code:'123456',accountId:'owner-http',mfaVerified:true})).status,400);
 const dispatcher=await send(env,'/staff/login',{login:'dispatcher.fixture',password});assert.ok(dispatcher.body.accessToken);
 assert.equal((await send(env,'/v1/admin/mfa/totp/verify',{challengeId:dispatcher.body.accessToken,code:'123456'})).status,400);
});
test('authentication payload bounds cover Content-Length, chunked and malformed JSON; no HTTP reset endpoint',async t=>{
 const env=setup(t);
 for(const path of ['/staff/login','/v1/admin/mfa/totp/verify']){
  assert.equal((await send(env,path,{}, {'Content-Length':'4097'})).status,400);
  const bytes=new TextEncoder().encode('x'.repeat(5000));
  const request=new Request('https://fixture.invalid'+path,{method:'POST',headers:{'CF-Connecting-IP':'203.0.113.10'},body:new ReadableStream({start(controller){controller.enqueue(bytes);controller.close();}}),duplex:'half'});
  assert.equal((await router(request,env,{})).status,400);
 }
 assert.equal((await router(new Request('https://fixture.invalid/v1/admin/mfa/totp/verify'),env,{})).status,405);
 assert.equal((await send(env,'/v1/admin/mfa/reset',{})).status,404);
});
test('missing server key or trusted edge IP fails closed without leaking secret details',async t=>{
 const env=setup(t);
 const noKey=await send({...env,ADMIN_MFA_ENCRYPTION_KEY:undefined},'/staff/login',{login:'owner.fixture',password});assert.equal(noKey.status,503);assert.equal(noKey.body.accessToken,undefined);
 const noIp=await router(new Request('https://fixture.invalid/staff/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({login:'owner.fixture',password})}),env,{});
 assert.equal(noIp.status,400);const data=await noIp.text();assert.ok(!data.includes(password));assert.ok(!data.includes('ADMIN_MFA_ENCRYPTION_KEY'));
});
