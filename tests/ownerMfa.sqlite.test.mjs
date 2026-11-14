import assert from 'node:assert/strict';
import test from 'node:test';
import { sqliteD1 } from './helpers/sqliteD1.mjs';
import { hashStaffPassword } from '../src/core/staffAuthCrypto.js';
import { loginStaff,refreshStaff,logoutStaff } from '../src/core/staffAuthService.js';
import { authenticateStaffRequest } from '../src/core/staffAuthorization.js';
import { provisionOwnerBootstrap } from '../src/core/ownerMfaControlPlane.js';
import { startOwnerMfaEnrollment,confirmOwnerMfaEnrollment,verifyOwnerMfa } from '../src/core/ownerMfaService.js';
import { ownerSessionEvidence,purgeOwnerMfaEphemera } from '../src/core/ownerMfaRepository.js';
import { unbase32,totp,digest } from '../src/core/ownerMfaCrypto.js';
import router from '../src/router.js';
const password='Fixture-Password-123!',verifier=await hashStaffPassword(password);
let now=1800000000000;
const ctx={ip:'203.0.113.10'};
function fixture(t){
 const DB=sqliteD1();t.after(()=>DB.sqlite.close());now=1800000000000;t.mock.method(Date,'now',()=>now);
 const fields=['passwordAlgorithm','passwordIterations','passwordSalt','passwordHash'];
 for(const [id,login]of [['owner-1','owner.fixture'],['dispatcher-1','dispatcher.fixture'],['driver-1','driver.fixture']]){
  DB.sqlite.prepare(`INSERT INTO staff_accounts(id,login,display_name,role,status,password_algorithm,password_iterations,password_salt,password_hash,password_changed_at,created_at,updated_at)
  VALUES(?,?,?,?,'active',?,?,?,?,1,1,1)`).run(id,login,id,id==='driver-1'?'driver':'admin',...fields.map(k=>verifier[k]));
 }
 DB.sqlite.prepare('INSERT INTO staff_owner_binding(singleton,account_id,created_at) VALUES(1,?,1)').run('owner-1');
 return {DB,JWT_SECRET:'fixture-jwt-key-012345678901234567890123',ADMIN_MFA_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64')};
}
async function login(env,login='owner.fixture'){return loginStaff(env,{login,password},ctx);}
async function enrollment(env){
 const boot=await provisionOwnerBootstrap(env,'owner-1'),challenge=await login(env);
 assert.equal(challenge.mfaRequired,true);assert.equal(challenge.enrollmentRequired,true);assert.equal(challenge.accessToken,undefined);assert.equal(challenge.refreshToken,undefined);
 const started=await startOwnerMfaEnrollment(env,{challengeId:challenge.challengeId,bootstrapCode:boot.bootstrapCode},ctx);assert.equal(started.ok,true);
 const seed=unbase32(started.secret),confirmed=await confirmOwnerMfaEnrollment(env,{enrollmentId:started.enrollmentId,code:await totp(seed,Math.floor(now/30000))},ctx);
 assert.equal(confirmed.ok,true);assert.equal(confirmed.recoveryCodes.length,10);assert.equal(confirmed.accessToken,undefined);
 return {seed,codes:confirmed.recoveryCodes,secret:started.secret,bootstrap:boot.bootstrapCode};
}
async function verified(env,seed){now+=30000;const challenge=await login(env);const result=await verifyOwnerMfa(env,{challengeId:challenge.challengeId,code:await totp(seed,Math.floor(now/30000))},ctx);assert.equal(result.ok,true);return result;}
function request(token,path='/v1/admin/me'){return new Request('https://fixture.invalid'+path,{headers:{Authorization:'Bearer '+token}});}
test('OWNER password creates only challenge; enrollment, TOTP, refresh and 12h expiry',async t=>{
 const env=fixture(t),setup=await enrollment(env),session=await verified(env,setup.seed);
 const auth=await authenticateStaffRequest(request(session.accessToken),env);assert.equal(auth.ok,true);assert.equal(auth.mfa.verified,true);
 const expiry=auth.mfa.expiresAt;now+=1000;const rotated=await refreshStaff(env,session.refreshToken);assert.equal(rotated.ok,true);
 const next=await authenticateStaffRequest(request(rotated.accessToken),env);assert.equal(next.mfa.expiresAt,expiry);
 now=expiry;assert.equal((await refreshStaff(env,rotated.refreshToken)).ok,false);
 const dump=env.DB.sqlite.prepare('SELECT * FROM admin_mfa_factors').get();assert.ok(!JSON.stringify(dump).includes(setup.secret));
 assert.equal(env.DB.sqlite.prepare('SELECT count(*) n FROM admin_mfa_recovery').get().n,10);
});
test('password-only OWNER sessions are blocked on new and legacy private routes',async t=>{
 const env=fixture(t);const other=await login(env,'dispatcher.fixture');assert.equal(other.ok,true);
 env.DB.sqlite.prepare('UPDATE staff_sessions SET account_id=? WHERE account_id=?').run('owner-1','dispatcher-1');
 // Forge only a cryptographically valid fixture JWT for an existing pre-MFA OWNER session.
 const {signJWT}=await import('../src/core/auth.js');const s=env.DB.sqlite.prepare('SELECT * FROM staff_sessions').get();
 const token=await signJWT(env.JWT_SECRET,{id:'owner-1',sub:'owner-1',role:'admin',scope:'staff',tokenVersion:1,sid:s.id},900);
 assert.equal((await authenticateStaffRequest(request(token),env)).ok,false);
 for(const path of ['/v1/admin/me','/staff/accounts','/orders'])assert.equal((await router(request(token,path),env,{})).status,401);
 assert.equal((await refreshStaff(env,other.refreshToken)).ok,false);
});
test('atomic TOTP counter/challenge and recovery replay have only one winner',async t=>{
 const env=fixture(t),setup=await enrollment(env);now+=30000;
 const a=await login(env),b=await login(env),code=await totp(setup.seed,Math.floor(now/30000));
 const results=await Promise.all([a,b].map(c=>verifyOwnerMfa(env,{challengeId:c.challengeId,code},ctx)));
 assert.equal(results.filter(x=>x.ok).length,1);
 const c=await login(env),d=await login(env);
 const recovery=await Promise.all([c,d].map(ch=>verifyOwnerMfa(env,{challengeId:ch.challengeId,recoveryCode:setup.codes[0]},ctx,'recovery')));
 assert.equal(recovery.filter(x=>x.ok).length,1);
 assert.equal((await verifyOwnerMfa(env,{challengeId:c.challengeId,recoveryCode:setup.codes[0]},ctx,'recovery')).ok,false);
 assert.ok(env.DB.sqlite.prepare("SELECT count(*) n FROM audit_events WHERE action='admin.mfa.replay_denied'").get().n>0);
});
test('five failed attempts consume challenge; account/IP limits survive new password challenges',async t=>{
 const env=fixture(t),setup=await enrollment(env);const challenge=await login(env);
 for(let i=0;i<5;i++)assert.equal((await verifyOwnerMfa(env,{challengeId:challenge.challengeId,code:'bad'},ctx)).ok,false);
 now+=30000;assert.equal((await verifyOwnerMfa(env,{challengeId:challenge.challengeId,code:await totp(setup.seed,Math.floor(now/30000))},ctx)).ok,false);
 const second=await login(env);
 for(let i=0;i<4;i++)assert.equal((await verifyOwnerMfa(env,{challengeId:second.challengeId,code:'bad'},ctx)).ok,false);
 assert.equal((await login(env)).status,429);
 now+=900000;assert.equal((await login(env)).mfaRequired,true);
 for(let i=0;i<20;i++)await verifyOwnerMfa(env,{challengeId:'mfa_'+'a'.repeat(43),code:'bad'},{ip:'203.0.113.20'});
 assert.equal((await verifyOwnerMfa(env,{challengeId:'mfa_'+'b'.repeat(43),code:'bad'},{ip:'203.0.113.20'})).status,429);
});
test('bootstrap needs password challenge, expires and has only three attempts',async t=>{
 const env=fixture(t),boot=await provisionOwnerBootstrap(env,'owner-1'),challenge=await login(env);
 for(let i=0;i<3;i++)assert.equal((await startOwnerMfaEnrollment(env,{challengeId:challenge.challengeId,bootstrapCode:'wrong'},ctx)).ok,false);
 assert.equal((await startOwnerMfaEnrollment(env,{challengeId:challenge.challengeId,bootstrapCode:boot.bootstrapCode},ctx)).ok,false);
 const next=await provisionOwnerBootstrap(env,'owner-1');now+=900001;const fresh=await login(env);
 assert.equal((await startOwnerMfaEnrollment(env,{challengeId:fresh.challengeId,bootstrapCode:next.bootstrapCode},ctx)).ok,false);
 await assert.rejects(()=>provisionOwnerBootstrap(env,'dispatcher-1'));
});
test('reset revokes every OWNER family, changes version and rejects in-flight proofs',async t=>{
 const env=fixture(t),setup=await enrollment(env),session=await verified(env,setup.seed),pending=await login(env);
 await assert.rejects(()=>provisionOwnerBootstrap(env,'owner-1'));
 await provisionOwnerBootstrap(env,'owner-1',{reset:true});
 assert.equal((await authenticateStaffRequest(request(session.accessToken),env)).ok,false);
 assert.equal((await refreshStaff(env,session.refreshToken)).ok,false);
 assert.equal((await verifyOwnerMfa(env,{challengeId:pending.challengeId,recoveryCode:setup.codes[0]},ctx,'recovery')).ok,false);
 assert.equal((await login(env)).enrollmentRequired,true);
});
test('audit write failure rolls back proof, family and factor counter',async t=>{
 const env=fixture(t),setup=await enrollment(env);now+=30000;const challenge=await login(env),counter=env.DB.sqlite.prepare('SELECT last_counter FROM admin_mfa_factors').get().last_counter;
 env.DB.sqlite.exec("CREATE TRIGGER fail_mfa_audit BEFORE INSERT ON audit_events WHEN NEW.action='admin.mfa.verified' BEGIN SELECT RAISE(ABORT,'fixture audit failure'); END");
 // The real SQLite transaction must roll back the proof and all mutations.
 const code=await totp(setup.seed,Math.floor(now/30000));await assert.rejects(()=>verifyOwnerMfa(env,{challengeId:challenge.challengeId,code},ctx));
 assert.equal(env.DB.sqlite.prepare('SELECT last_counter FROM admin_mfa_factors').get().last_counter,counter);
 assert.equal(env.DB.sqlite.prepare('SELECT count(*) n FROM staff_sessions').get().n,0);
 env.DB.sqlite.exec('DROP TRIGGER fail_mfa_audit');assert.equal((await verifyOwnerMfa(env,{challengeId:challenge.challengeId,code},ctx)).ok,true);
});
test('foreign/revoked/expired challenge and invalid config cannot issue sessions; dispatcher unchanged',async t=>{
 const env=fixture(t),setup=await enrollment(env),challenge=await login(env);now+=300001;
 assert.equal((await verifyOwnerMfa(env,{challengeId:challenge.challengeId,recoveryCode:setup.codes[1]},ctx,'recovery')).ok,false);
 const dispatcher=await login(env,'dispatcher.fixture');assert.ok(dispatcher.accessToken);assert.equal((await authenticateStaffRequest(request(dispatcher.accessToken),env)).ok,true);
 assert.equal((await loginStaff({...env,ADMIN_MFA_ENCRYPTION_KEY:undefined},{login:'owner.fixture',password},ctx)).status,503);
 assert.equal((await loginStaff(env,{login:'owner.fixture',password},{})).status,400);
 await logoutStaff(env,dispatcher.refreshToken);assert.equal((await authenticateStaffRequest(request(dispatcher.accessToken),env)).ok,false);
 await purgeOwnerMfaEphemera(env,now+900000);assert.equal(env.DB.sqlite.prepare('SELECT count(*) n FROM admin_mfa_challenges').get().n,0);
});

test('failure limits use sliding intervals and do not reset at calendar bucket boundaries',async t=>{
 const env=fixture(t);await enrollment(env);now+=899900;
 for(let group=0;group<2;group++){
  const challenge=await login(env);assert.equal(challenge.ok,true);
  for(let i=0;i<5;i++)assert.equal((await verifyOwnerMfa(env,{challengeId:challenge.challengeId,code:'bad'},ctx)).ok,false);
 }
 assert.equal((await login(env)).status,429);now+=200;assert.equal((await login(env)).status,429);
 for(let i=0;i<20;i++)await verifyOwnerMfa(env,{challengeId:'mfa_'+'a'.repeat(43),code:'bad'},{ip:'203.0.113.30'});
 now+=60000-(now%60000)+1;
 assert.equal((await verifyOwnerMfa(env,{challengeId:'mfa_'+'a'.repeat(43),code:'bad'},{ip:'203.0.113.30'})).status,429);
 now+=900000;assert.equal((await login(env)).mfaRequired,true);
});
