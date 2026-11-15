import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../src/index.js';
import { makeConfig,checkConfig,checkRemoteVersion,bootstrapStatements,TARGET } from '../scripts/lib/adminPhoneSetupPolicy.mjs';
import { ownerPhoneTestEnabled } from '../src/core/adminPhoneTestScope.js';
import { createAdminBootstrapAccount } from '../src/core/staffProvisioning.js';
import { digest } from '../src/core/ownerMfaCrypto.js';
import { sqliteD1 } from './helpers/sqliteD1.mjs';
const password='Synthetic-Owner-Password-123!',code='bootstrap_'+'a'.repeat(43);
test('phone configuration permits exactly the known staging tuple and never broadens D3',()=>{
 const config=makeConfig('a'.repeat(32));assert.deepEqual(checkConfig(config),config);
 for(const mutate of [c=>c.name='uber-v3',c=>c.vars.APP_ENV='production',c=>c.vars.ADMIN_PHONE_TEST_ONLY='false',c=>c.routes=['example.invalid/*'],c=>c.env={},c=>c.d1_databases[0].database_id='c1d490e4-68f0-4f78-8f53-7d10df7c3395',c=>c.r2_buckets=[{}],c=>c.vars.ADMIN_MFA_ENCRYPTION_KEY='forbidden']){
  const invalid=structuredClone(config);mutate(invalid);assert.throws(()=>checkConfig(invalid));
 }
 assert.equal(ownerPhoneTestEnabled({}),false);assert.throws(()=>ownerPhoneTestEnabled({APP_ENV:'production',ADMIN_PHONE_TEST_ONLY:'true'}));
});
test('phone Worker fails closed for wrong host, every Driver/public/legacy route and wrong methods',async()=>{
 const env={APP_ENV:'staging',ADMIN_PHONE_TEST_ONLY:'true'};
 for(const path of ['/v1/driver/me','/v1/driver/session/exchange','/orders','/calculate','/staff/accounts','/v1/admin/mfa/reset']){
  const response=await worker.fetch(new Request('https://'+TARGET.host+path),env,{});assert.equal(response.status,404);assert.equal(response.headers.get('X-Transfer-Test-Scope'),'owner_phone');
 }
 assert.equal((await worker.fetch(new Request('https://'+TARGET.host+'/staff/login'),env,{})).status,405);
 assert.equal((await worker.fetch(new Request('https://uber-v3.lobanov0710.workers.dev/staff/login',{method:'POST'}),env,{})).status,503);
 assert.equal((await worker.fetch(new Request('https://'+TARGET.host+'/staff/login'),{...env,APP_ENV:'production'},{})).status,503);
});
test('new OWNER provisioning and bootstrap/audit are atomic and contain no raw password/code',async t=>{
 const DB=sqliteD1();t.after(()=>DB.sqlite.close());
 const account=await createAdminBootstrapAccount({login:'owner.fixture',displayName:"Synthetic Owner's; Name",password});
 const hash=await digest('mfa-bootstrap',code);const plan=bootstrapStatements({account,newAccount:true,digest:hash});
 assert.ok(!plan.sql.includes(password)&&!plan.sql.includes(code));
 await DB.batch(plan.statements.map(sql=>DB.prepare(sql)));assert.equal(DB.sqlite.prepare('SELECT account_id FROM staff_owner_binding').get().account_id,account.id);
 assert.equal(DB.sqlite.prepare('SELECT display_name FROM staff_accounts').get().display_name,"Synthetic Owner's; Name");
 const other=await createAdminBootstrapAccount({login:'other.fixture',displayName:'Other fixture',password});
 await assert.rejects(DB.batch(bootstrapStatements({account:other,newAccount:true,digest:'b'.repeat(64)}).statements.map(sql=>DB.prepare(sql))));
 assert.equal(DB.sqlite.prepare('SELECT count(*) n FROM staff_accounts').get().n,1);
 assert.equal(DB.sqlite.prepare('SELECT count(*) n FROM audit_events').get().n,1);
});
test('audit failure rolls all OWNER provisioning back; existing factor is never reset',async t=>{
 const DB=sqliteD1();t.after(()=>DB.sqlite.close());
 const account=await createAdminBootstrapAccount({login:'owner.fixture',displayName:'Synthetic Owner',password});
 DB.sqlite.exec("CREATE TRIGGER fail_owner_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END");
 const plan=bootstrapStatements({account,newAccount:true,digest:'c'.repeat(64)});await assert.rejects(DB.batch(plan.statements.map(sql=>DB.prepare(sql))));
 assert.equal(DB.sqlite.prepare('SELECT count(*) n FROM staff_accounts').get().n,0);
 DB.sqlite.exec('DROP TRIGGER fail_owner_audit');await DB.batch(plan.statements.map(sql=>DB.prepare(sql)));
 DB.sqlite.prepare("INSERT INTO admin_mfa_factors(account_id,encrypted_seed,revision,last_counter,enabled_at) VALUES(?,'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx','factor_fixture12345',-1,1)").run(account.id);
 const protectedPlan=bootstrapStatements({account,digest:'d'.repeat(64)});await DB.batch(protectedPlan.statements.map(sql=>DB.prepare(sql)));
 assert.equal(DB.sqlite.prepare('SELECT digest FROM admin_mfa_bootstrap').get().digest,'c'.repeat(64));
});

test('actual HTTP phone flow requires OWNER MFA and isolates existing dispatcher, Driver and registrations',async t=>{
 const {ownerPhoneScenario,phoneSecrets}=await import('./helpers/ownerPhoneScenario.mjs');
 const DB=sqliteD1();t.after(()=>DB.sqlite.close());
 const send=async(route,body,token,phone=true)=>{
  const response=await worker.fetch(new Request('https://'+TARGET.host+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','CF-Connecting-IP':'203.0.113.11',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)}),{DB,...phoneSecrets,...(phone?{APP_ENV:'staging',ADMIN_PHONE_TEST_ONLY:'true'}:{})},{});
  if(phone)assert.equal(response.headers.get('X-Transfer-Test-Scope'),'owner_phone');
  return {status:response.status,body:await response.json()};
 };
 await ownerPhoneScenario(DB,send);
});
test('phone scheduler touches only MFA ephemera, not Driver/support data',async()=>{
 const sql=[];const env={APP_ENV:'staging',ADMIN_PHONE_TEST_ONLY:'true',DB:{prepare(statement){sql.push(statement);return {bind(){return this;},run:async()=>({success:true})};},batch:async statements=>statements.map(()=>({success:true}))}};
 await worker.scheduled({},env,{});assert.equal(sql.length,4);assert.ok(sql.every(s=>!/(driver_|photo_|support_|vehicles)/i.test(s)));assert.ok(sql.every(s=>s.includes('admin_mfa_')));
});
test('private provisioning CLI refuses CI/non-TTY before reading credentials or making changes',async()=>{
 const {spawnSync}=await import('node:child_process');
 const result=spawnSync(process.execPath,['scripts/adminOwnerPhoneSetup.mjs','owner'],{encoding:'utf8',env:{...process.env,CI:'true'}});
 assert.equal(result.status,1);assert.match(result.stderr,/FAILED at owner/);assert.ok(!result.stdout.includes('bootstrap_'));
});

test('remote inspection rejects unknown or production bindings before deploy',()=>{
 const bindings=[{name:'DB',type:'d1',id:TARGET.databaseId},{name:'DRIVERS',type:'kv_namespace',namespace_id:TARGET.kvId},{name:'APP_ENV',type:'plain_text',text:'staging'},{name:'JWT_SECRET',type:'secret_text'}];
 assert.equal(checkRemoteVersion({resources:{bindings}}).length,4);
 for(const extra of [{name:'FILES',type:'r2_bucket'},{name:'APP_ENV',type:'plain_text',text:'production'},{name:'OTHER',type:'plain_text',text:'unknown'}])assert.throws(()=>checkRemoteVersion({resources:{bindings:[...bindings,extra]}}));
 const wrong=structuredClone(bindings);wrong[0].id='production';assert.throws(()=>checkRemoteVersion({resources:{bindings:wrong}}));
});
