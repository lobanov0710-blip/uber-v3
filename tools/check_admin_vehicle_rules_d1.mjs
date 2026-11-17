// Populated 21 -> 22 upgrade and actual Worker HTTP on native local D1 only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { Miniflare,convertV4MiniflareOptions } from 'miniflare';
import { sqliteD1 } from '../tests/helpers/sqliteD1.mjs';
import { seedRuleActors,ruleApiWorkflow,ruleSecrets,ownerId } from '../tests/helpers/adminVehicleRuleScenario.mjs';
const bundle=await build({entryPoints:[new URL('../src/index.js',import.meta.url).pathname],bundle:true,
  write:false,format:'esm',target:'es2022',platform:'browser'});
const local=sqliteD1({throughMigration:21});
const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'admin-rules',modules:true,
  script:bundle.outputFiles[0].text,bindings:ruleSecrets,d1Databases:['DB'],compatibilityDate:'2026-08-20'}]}));
try {
  const DB=await mf.getD1Database('DB','admin-rules');
  for(const type of ['table','index','view','trigger'])for(const row of local.sqlite.prepare("SELECT sql FROM sqlite_master WHERE type=? AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all(type))await DB.prepare(row.sql).run();
  await seedRuleActors(DB);
  // Enumerate the exact application schema copied above. D1 also lists private
  // provider tables such as _cf_METADATA; their contents must remain inaccessible.
  const names=local.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(x=>x.name);
  const snapshot=async()=>{
    const values=[];for(const name of names)values.push((await DB.prepare('SELECT * FROM "'+name+'" ORDER BY rowid').all()).results);
    return values;
  };
  const before=await snapshot();
  const sql=readFileSync(new URL('../migrations/0022_vehicle_rule_definitions.sql',import.meta.url),'utf8');
  const triggers=[...sql.matchAll(/^CREATE TRIGGER[\s\S]*?END;/gm)].map(m=>m[0]);assert.equal(triggers.length,3);
  const ordinary=sql.replace(/^CREATE TRIGGER[\s\S]*?END;/gm,'').replace(/--[^\n]*/g,'').split(';').map(x=>x.trim()).filter(Boolean);
  const statements=[...ordinary,...triggers];assert.equal(ordinary.length,1);
  await assert.rejects(DB.batch([...statements.map(s=>DB.prepare(s)),DB.prepare('SELECT * FROM intentionally_missing_rule_fixture')]));
  assert.equal((await DB.prepare("SELECT name FROM sqlite_master WHERE name='vehicle_classification_rule_definitions'").all()).results.length,0);
  assert.deepEqual(await snapshot(),before);
  await DB.batch(statements.map(s=>DB.prepare(s)));
  assert.deepEqual(await snapshot(),before);
  assert.equal((await DB.prepare('SELECT count(*) n FROM vehicle_classification_rule_definitions').first()).n,0);
  const send=async(method,path,body,token,key)=>{
    const response=await mf.dispatchFetch('https://fixture.invalid'+path,{method,
      headers:{'Content-Type':'application/json','CF-Connecting-IP':'203.0.113.10',...(token?{Authorization:'Bearer '+token}:{}),...(key?{'Idempotency-Key':key}:{})},
      ...(body===undefined?{}:{body:JSON.stringify(body)})});
    assert.equal(response.headers.get('Cache-Control'),'no-store');
    return {status:response.status,body:await response.json()};
  };
  const result=await ruleApiWorkflow({DB,...ruleSecrets},send);
  await assert.rejects(DB.prepare("UPDATE vehicle_classification_rule_definitions SET reason='changed'").run());
  await assert.rejects(DB.prepare('DELETE FROM vehicle_classification_rule_definitions').run());
  await DB.prepare("INSERT INTO vehicle_classification_rules VALUES('native_rule_invalid','Toyota','Synthetic invalid',1,2023,'business','',1)").run();
  await assert.rejects(DB.prepare("INSERT INTO vehicle_classification_rule_definitions VALUES('native_rule_invalid','[\"crossover\"]','[]',?1,'Synthetic',1)").bind(ownerId).run());
  assert.deepEqual((await DB.prepare('PRAGMA foreign_key_check').all()).results,[]);
  // D1 authorizes quick_check, not SQLite's unrestricted integrity_check.
  assert.equal((await DB.prepare('PRAGMA quick_check').first()).quick_check,'ok');
  console.log(JSON.stringify({engine:'native local workerd HTTP/D1',...result,populatedUpgradePreserved:true,
    failedUpgradeRolledBack:true,noSeed:true,definitionImmutable:true,bodyConstraint:true,foreignKeys:true,quickCheck:true}));
} finally {local.sqlite.close();await mf.dispose();}
