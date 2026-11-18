// Exact populated24 ->25 upgrade on native D1. Synthetic fixtures only.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare,convertV4MiniflareOptions } from 'miniflare';
import { sqliteD1 } from '../tests/helpers/sqliteD1.mjs';
import { seedRuleActors,ruleSecrets } from '../tests/helpers/adminVehicleRuleScenario.mjs';
import { populatedLiftbackFixture,verifyLiftbackUpgrade,comfortLiftbackWorkflow } from '../tests/helpers/comfortLiftbackScenario.mjs';
const bundle=await build({entryPoints:[new URL('../src/index.js',import.meta.url).pathname],bundle:true,write:false,format:'esm',target:'es2022',platform:'browser'});
const local=sqliteD1({throughMigration:24});
const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'comfort-liftback',modules:true,script:bundle.outputFiles[0].text,
 bindings:ruleSecrets,d1Databases:['DB'],compatibilityDate:'2026-08-20'}]}));
try{
 const DB=await mf.getD1Database('DB','comfort-liftback');
 for(const type of ['table','index','view','trigger'])for(const row of local.sqlite.prepare("SELECT sql FROM sqlite_master WHERE type=? AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all(type))await DB.prepare(row.sql).run();
 await seedRuleActors(DB);const env={DB,...ruleSecrets};
 const send=async(method,path,body,token,key)=>{const r=await mf.dispatchFetch('https://fixture.invalid'+path,{method,
  headers:{'Content-Type':'application/json','CF-Connecting-IP':'203.0.113.10',...(token?{Authorization:'Bearer '+token}:{}),...(key?{'Idempotency-Key':key}:{})},
  ...(body===undefined?{}:{body:JSON.stringify(body)})});assert.equal(r.headers.get('Cache-Control'),'no-store');return{status:r.status,body:await r.json()};};
 const names=local.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>r.name);
 const fixture=await populatedLiftbackFixture(env,send),upgrade=await verifyLiftbackUpgrade(env,fixture,names),workflow=await comfortLiftbackWorkflow(env,send,fixture);
 assert.equal((await DB.prepare('PRAGMA quick_check').first()).quick_check,'ok');
 console.log(JSON.stringify({engine:'native local workerd HTTP/D1',...upgrade,...workflow,foreignKeys:true,quickCheck:true,realCloudflareRequests:0}));
}finally{local.sqlite.close();await mf.dispose();}
