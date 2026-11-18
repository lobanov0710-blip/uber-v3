// Actual local Worker HTTP, immutable proof and all admission mutations on native D1.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare,convertV4MiniflareOptions } from 'miniflare';
import { sqliteD1 } from '../tests/helpers/sqliteD1.mjs';
import { seedRuleActors,ruleSecrets } from '../tests/helpers/adminVehicleRuleScenario.mjs';
import { admissionWorkflow } from '../tests/helpers/vehicleAdmissionScenario.mjs';
const bundle=await build({entryPoints:[new URL('../src/index.js',import.meta.url).pathname],bundle:true,
 write:false,format:'esm',target:'es2022',platform:'browser'});
const local=sqliteD1();
const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'vehicle-admission',modules:true,script:bundle.outputFiles[0].text,
 bindings:ruleSecrets,d1Databases:['DB'],compatibilityDate:'2026-08-20'}]}));
try{
 const DB=await mf.getD1Database('DB','vehicle-admission');
 for(const type of ['table','index','view','trigger'])for(const row of local.sqlite.prepare("SELECT sql FROM sqlite_master WHERE type=? AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all(type))await DB.prepare(row.sql).run();
 await seedRuleActors(DB);
 const send=async(method,path,body,token,key)=>{const r=await mf.dispatchFetch('https://fixture.invalid'+path,{method,
  headers:{'Content-Type':'application/json','CF-Connecting-IP':'203.0.113.10',...(token?{Authorization:'Bearer '+token}:{}),...(key?{'Idempotency-Key':key}:{})},
  ...(body===undefined?{}:{body:JSON.stringify(body)})});assert.equal(r.headers.get('Cache-Control'),'no-store');return {status:r.status,body:await r.json()};};
 const result=await admissionWorkflow({DB,...ruleSecrets},send);
 assert.deepEqual((await DB.prepare('PRAGMA foreign_key_check').all()).results,[]);
 assert.equal((await DB.prepare('PRAGMA quick_check').first()).quick_check,'ok');
 console.log(JSON.stringify({engine:'native local workerd HTTP/D1',...result,foreignKeys:true,quickCheck:true,realCloudflareRequests:0}));
}finally{local.sqlite.close();await mf.dispose();}
