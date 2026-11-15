// Synthetic native workerd/D1 only; no credentials or remote changes.
import { build } from 'esbuild';
import { Miniflare,convertV4MiniflareOptions } from 'miniflare';
import { sqliteD1 } from '../tests/helpers/sqliteD1.mjs';
import { ownerPhoneScenario,phoneSecrets } from '../tests/helpers/ownerPhoneScenario.mjs';
import { TARGET } from '../scripts/lib/adminPhoneSetupPolicy.mjs';
const bundle=await build({entryPoints:[new URL('../src/index.js',import.meta.url).pathname],bundle:true,write:false,format:'esm',target:'es2022',platform:'browser'});
const local=sqliteD1(),mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'phone-audit',modules:true,script:bundle.outputFiles[0].text,bindings:{...phoneSecrets,APP_ENV:'staging',ADMIN_PHONE_TEST_ONLY:'true'},d1Databases:['DB'],compatibilityDate:'2026-08-20'}]}));
try{
 const DB=await mf.getD1Database('DB','phone-audit');
 for(const row of local.sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all())await DB.prepare(row.sql).run();
 for(const row of local.sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL").all())await DB.prepare(row.sql).run();
 // Issue the pre-existing dispatcher session outside phone mode through the tested service.
 const {loginStaff}=await import('../src/core/staffAuthService.js');
 const send=async(route,body,token,phone=true)=>{
  if(!phone){const result=await loginStaff({DB,...phoneSecrets},body,{ip:'203.0.113.11'});return {status:result.ok?200:401,body:result};}
  const response=await mf.dispatchFetch('https://'+TARGET.host+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','CF-Connecting-IP':'203.0.113.11',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:response.status,body:await response.json()};
 };
 console.log(JSON.stringify({engine:'local workerd HTTP/D1',...await ownerPhoneScenario(DB,send),result:'PASS'}));
}finally{local.sqlite.close();await mf.dispose();}
