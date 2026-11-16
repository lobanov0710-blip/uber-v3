// Bundled Worker + native local D1, synthetic data only; no deployment or remote bindings.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { sqliteD1 } from '../tests/helpers/sqliteD1.mjs';
import { seedVehicleReads,vehicleReadWorkflow } from '../tests/helpers/adminVehicleReadScenario.mjs';
const bundle=await build({entryPoints:[new URL('../src/index.js',import.meta.url).pathname],bundle:true,write:false,format:'esm',target:'es2022',platform:'browser'});
const local=sqliteD1(),mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'assignment-read-audit',modules:true,script:bundle.outputFiles[0].text,bindings:{JWT_SECRET:'synthetic-assignment-worker-jwt-01234567890123456789'},d1Databases:['DB'],compatibilityDate:'2026-08-20'}]}));
try {
  const DB=await mf.getD1Database('DB','assignment-read-audit');
  for(const row of local.sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all())await DB.prepare(row.sql).run();
  for(const row of local.sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL").all())await DB.prepare(row.sql).run();
  await seedVehicleReads(DB);
  const send=async(path,token,body,key)=>{
    const response=await mf.dispatchFetch('https://fixture.invalid'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...(key?{'Idempotency-Key':key}:{})},...(body?{body:JSON.stringify(body)}:{})});
    assert.equal(response.headers.get('Cache-Control'),'no-store');return {status:response.status,body:await response.json()};
  };
  const result=await vehicleReadWorkflow(DB,send);
  console.log(JSON.stringify({engine:'local workerd HTTP/D1',vehicleReadWorkflow:'PASS',auditRows:result.auditRows,privateProjectionAbsent:true,scopedPagination:true,currentPermissionRevocation:true}));
} finally { local.sqlite.close();await mf.dispose(); }
