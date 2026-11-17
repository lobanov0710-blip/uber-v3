// Exact populated22 ->23 upgrade and internal storage on native local D1.
// No public review POST, remote data, provider credentials or admission enabled.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { Miniflare,convertV4MiniflareOptions } from 'miniflare';
import { sqliteD1 } from '../tests/helpers/sqliteD1.mjs';
import { seedRuleActors,ruleSecrets } from '../tests/helpers/adminVehicleRuleScenario.mjs';
import { trustedStorageWorkflow } from '../tests/helpers/trustedAssessmentScenario.mjs';
const bundle=await build({entryPoints:[new URL('../src/index.js',import.meta.url).pathname],bundle:true,
  write:false,format:'esm',target:'es2022',platform:'browser'});
const local=sqliteD1({throughMigration:22});
const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'trusted-assessment',modules:true,script:bundle.outputFiles[0].text,
  bindings:ruleSecrets,d1Databases:['DB'],compatibilityDate:'2026-08-20'}]}));
try {
  const DB=await mf.getD1Database('DB','trusted-assessment');
  for(const type of ['table','index','trigger'])for(const row of local.sqlite.prepare("SELECT sql FROM sqlite_master WHERE type=? AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all(type))await DB.prepare(row.sql).run();
  await seedRuleActors(DB);
  const names=local.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>r.name);
  const snapshot=async()=>{const rows=[];for(const name of names)rows.push((await DB.prepare('SELECT * FROM "'+name+'" ORDER BY rowid').all()).results);return rows;};
  const before=await snapshot();
  const sql=readFileSync(new URL('../migrations/0023_trusted_vehicle_assessments.sql',import.meta.url),'utf8');
  const triggers=[...sql.matchAll(/^CREATE TRIGGER[\s\S]*?END;/gm)].map(m=>m[0]);assert.equal(triggers.length,8);
  const ordinary=sql.replace(/^CREATE TRIGGER[\s\S]*?END;/gm,'').replace(/--[^\n]*/g,'').split(';').map(x=>x.trim()).filter(Boolean);assert.equal(ordinary.length,3);
  const statements=[...ordinary,...triggers];
  await assert.rejects(DB.batch([...statements.map(s=>DB.prepare(s)),DB.prepare('SELECT * FROM missing_trusted_fixture')]));
  assert.equal((await DB.prepare("SELECT count(*) n FROM sqlite_master WHERE name='vehicle_trusted_assessments'").first()).n,0);
  assert.deepEqual(await snapshot(),before);
  await DB.batch(statements.map(s=>DB.prepare(s)));assert.deepEqual(await snapshot(),before);
  assert.equal((await DB.prepare('SELECT count(*) n FROM vehicle_trusted_assessments').first()).n,0);
  const send=async(method,path,body,token,key)=>{
    const r=await mf.dispatchFetch('https://fixture.invalid'+path,{method,headers:{'Content-Type':'application/json','CF-Connecting-IP':'203.0.113.10',
      ...(token?{Authorization:'Bearer '+token}:{}),...(key?{'Idempotency-Key':key}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
    assert.equal(r.headers.get('Cache-Control'),'no-store');return {status:r.status,body:await r.json()};
  };
  const result=await trustedStorageWorkflow({DB,...ruleSecrets},send);
  assert.deepEqual((await DB.prepare('PRAGMA foreign_key_check').all()).results,[]);
  assert.equal((await DB.prepare('PRAGMA quick_check').first()).quick_check,'ok');
  console.log(JSON.stringify({engine:'native local workerd HTTP authentication + internal D1 storage',...result,
    populatedUpgradePreserved:true,failedUpgradeRolledBack:true,noSeed:true,foreignKeys:true,quickCheck:true,publicReviewRemainsClosed:true}));
} finally {local.sqlite.close();await mf.dispose();}
