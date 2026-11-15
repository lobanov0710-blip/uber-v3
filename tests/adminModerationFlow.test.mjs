import assert from 'node:assert/strict';
import test from 'node:test';
import router from '../src/router.js';
import { sqliteD1 } from './helpers/sqliteD1.mjs';
import { seedModeration,moderationWorkflow,moderator,fixturePassword,driverId,documentId } from './helpers/adminModerationScenario.mjs';
async function setup(t){
 const DB=sqliteD1();t.after(()=>DB.sqlite.close());await seedModeration(DB);
 const env={DB,JWT_SECRET:'synthetic-moderation-jwt-key-01234567890123456789'};
 const send=async(path,body,token,key)=>{
  const response=await router(new Request('https://fixture.invalid'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...(key?{'Idempotency-Key':key}:{})},body:body===undefined?undefined:JSON.stringify(body)}),env,{});
  assert.equal(response.headers.get('Cache-Control'),'no-store');return {status:response.status,body:await response.json()};
 };return {DB,send,env};
}
test('HTTP moderation returns only one element, preserves verified elements, history, replay and current permissions',async t=>{
 const {DB,send}=await setup(t);await moderationWorkflow(DB,send);
});
test('HTTP moderation audit failure rolls back target, revision, history and idempotency',async t=>{
 const {DB,send}=await setup(t);const token=(await send('/staff/login',{login:moderator,password:fixturePassword})).body.accessToken;
 const base='/v1/admin/registrations/'+driverId;
 assert.equal((await send(base+'/review',{expectedRevision:1},token,'fixture-start-rollback')).status,200);
 DB.sqlite.exec("CREATE TRIGGER fail_moderation_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END");
 const result=await send(base+'/review/items/document/'+documentId,{decision:'rejected',expectedRevision:1,note:'Synthetic reason'},token,'fixture-rollback-review');
 assert.equal(result.status,500);
 const row=DB.sqlite.prepare('SELECT status,revision FROM document_resources WHERE id=?').get(documentId);assert.deepEqual({...row},{status:'pending',revision:1});
 assert.equal(DB.sqlite.prepare("SELECT count(*) n FROM moderation_reviews WHERE target_type='document'").get().n,0);
 assert.equal(DB.sqlite.prepare("SELECT count(*) n FROM mutation_idempotency WHERE operation='admin.registration.item.document'").get().n,0);
});

test('HTTP review rejects oversized payloads and missing correction reasons without mutations',async t=>{
 const {DB,send,env}=await setup(t);const token=(await send('/staff/login',{login:moderator,password:fixturePassword})).body.accessToken;
 const base='/v1/admin/registrations/'+driverId;
 for(const path of [base+'/review',base+'/review/items/document/'+documentId,base+'/review/complete']){
  const response=await router(new Request('https://fixture.invalid'+path,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','Idempotency-Key':'fixture-oversized'},body:JSON.stringify({note:'x'.repeat(5000),decision:'changes_required',expectedRevision:1})}),env,{});
  assert.equal(response.status,400);
 }
 assert.equal((await send(base+'/review',{expectedRevision:1},token,'fixture-start-reason')).status,200);
 for(const path of [base+'/review/items/document/'+documentId,base+'/review/complete']){
  const result=await send(path,{decision:'changes_required',expectedRevision:path.endsWith('/complete')?2:1},token,'fixture-missing-reason');
  assert.equal(result.status,400);assert.equal(result.body.code,'moderation_reason_required');
  for(const note of [{reason:'not a string'},true,42]){
   const invalid=await send(path,{decision:'changes_required',expectedRevision:path.endsWith('/complete')?2:1,note},token,'fixture-invalid-reason');
   assert.equal(invalid.status,400);
  }
 }
 assert.equal(DB.sqlite.prepare('SELECT status FROM document_resources WHERE id=?').get(documentId).status,'pending');
});
