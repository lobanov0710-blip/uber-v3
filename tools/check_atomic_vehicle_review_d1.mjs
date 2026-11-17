// Populated23 ->24 and actual legacy approval HTTP + internal correction on native D1.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { Miniflare,convertV4MiniflareOptions } from 'miniflare';
import { sqliteD1 } from '../tests/helpers/sqliteD1.mjs';
import { seedRuleActors,ruleSecrets } from '../tests/helpers/adminVehicleRuleScenario.mjs';
import { atomicVehicleReviewWorkflow } from '../tests/helpers/atomicVehicleReviewScenario.mjs';
const bundle=await build({entryPoints:[new URL('../src/index.js',import.meta.url).pathname],bundle:true,
 write:false,format:'esm',target:'es2022',platform:'browser'});
const local=sqliteD1({throughMigration:23});
const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'atomic-vehicle',modules:true,script:bundle.outputFiles[0].text,
 bindings:ruleSecrets,d1Databases:['DB'],compatibilityDate:'2026-08-20'}]}));
try{
 const DB=await mf.getD1Database('DB','atomic-vehicle');
 for(const type of ['table','index','view','trigger'])for(const row of local.sqlite.prepare("SELECT sql FROM sqlite_master WHERE type=? AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all(type))await DB.prepare(row.sql).run();
 await seedRuleActors(DB);
 const names=local.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(x=>x.name);
 const snapshot=async()=>{const out=[];for(const n of names)out.push((await DB.prepare('SELECT * FROM "'+n+'" ORDER BY rowid').all()).results);return out;};
 const before=await snapshot(),sql=readFileSync(new URL('../migrations/0024_vehicle_reverification_holds.sql',import.meta.url),'utf8');
 const triggers=[...sql.matchAll(/^CREATE TRIGGER[\s\S]*?END;/gm)].map(m=>m[0]);assert.equal(triggers.length,3);
 const tables=sql.replace(/^CREATE TRIGGER[\s\S]*?END;/gm,'').replace(/--[^\n]*/g,'').split(';').map(x=>x.trim()).filter(Boolean);assert.equal(tables.length,1);
 const statements=[...tables,...triggers];
 await assert.rejects(DB.batch([...statements.map(s=>DB.prepare(s)),DB.prepare('SELECT * FROM missing_atomic_fixture')]));
 assert.equal((await DB.prepare("SELECT count(*) n FROM sqlite_master WHERE name='vehicle_reverification_assignment_holds'").first()).n,0);assert.deepEqual(await snapshot(),before);
 await DB.batch(statements.map(s=>DB.prepare(s)));assert.deepEqual(await snapshot(),before);
 assert.equal((await DB.prepare('SELECT count(*) n FROM vehicle_reverification_assignment_holds').first()).n,0);
 const send=async(method,path,body,token,key)=>{const r=await mf.dispatchFetch('https://fixture.invalid'+path,{method,
  headers:{'Content-Type':'application/json','CF-Connecting-IP':'203.0.113.10',...(token?{Authorization:'Bearer '+token}:{}),...(key?{'Idempotency-Key':key}:{})},
  ...(body===undefined?{}:{body:JSON.stringify(body)})});assert.equal(r.headers.get('Cache-Control'),'no-store');return {status:r.status,body:await r.json()};};
 const result=await atomicVehicleReviewWorkflow({DB,...ruleSecrets},send);
 assert.deepEqual((await DB.prepare('PRAGMA foreign_key_check').all()).results,[]);
 assert.equal((await DB.prepare('PRAGMA quick_check').first()).quick_check,'ok');
 console.log(JSON.stringify({engine:'native local workerd HTTP/D1',...result,populatedUpgradePreserved:true,failedUpgradeRolledBack:true,noBackfill:true,foreignKeys:true,quickCheck:true}));
}finally{local.sqlite.close();await mf.dispose();}
