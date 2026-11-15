// Local native D1 with the actual bundled Worker; no remote DB, R2 or credentials.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare,convertV4MiniflareOptions } from 'miniflare';
import { sqliteD1 } from '../tests/helpers/sqliteD1.mjs';
import { seedModeration,moderationWorkflow } from '../tests/helpers/adminModerationScenario.mjs';
const bundle=await build({entryPoints:[new URL('../src/index.js',import.meta.url).pathname],bundle:true,write:false,format:'esm',target:'es2022',platform:'browser'});
const local=sqliteD1(),mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'moderation-audit',modules:true,script:bundle.outputFiles[0].text,bindings:{JWT_SECRET:'synthetic-moderation-jwt-key-01234567890123456789'},d1Databases:['DB'],compatibilityDate:'2026-08-20'}]}));
try{
 const DB=await mf.getD1Database('DB','moderation-audit');
 for(const row of local.sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all())await DB.prepare(row.sql).run();
 for(const row of local.sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL").all())await DB.prepare(row.sql).run();
 await seedModeration(DB);
 const send=async(path,body,token,key)=>{
  const response=await mf.dispatchFetch('https://fixture.invalid'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...(key?{'Idempotency-Key':key}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  assert.equal(response.headers.get('Cache-Control'),'no-store');return {status:response.status,body:await response.json()};
 };
 const result=await moderationWorkflow(DB,send);
 console.log(JSON.stringify({engine:'local workerd HTTP/D1',partialReturnPreservesVerified:true,replayAndRevocation:true,identityApprovalDenied:true,auditRows:result.auditRows,result:'PASS'}));
}finally{local.sqlite.close();await mf.dispose();}
