// Test-only loopback provider; never included in the owner bundle.
import {createServer} from 'node:http';
import {readFileSync,readdirSync,writeFileSync,mkdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import os from 'node:os';
import child from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {metadataSql,TARGET} from './scripts/lib/vehicleInventoryPolicy.mjs';
const root=fileURLToPath(new URL('.',import.meta.url)),scenario=process.env.INVENTORY_FIXTURE_CASE;
const home=path.join(root,'private-home');mkdirSync(home);os.homedir=()=>scenario==='folder_error'?path.join(home,'missing-parent'):home;
const schema=JSON.parse(readFileSync(new URL('./scripts/vehicle-inventory-schema.json',import.meta.url)));
const plan=JSON.parse(readFileSync(new URL('./docs/VEHICLE_LEGACY_INVENTORY_READ_PLAN_2026-11-19.json',import.meta.url)));
const cutoff=Number(process.env.INVENTORY_FIXTURE_CUTOFF||18),db=new DatabaseSync(':memory:');
db.exec('CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL UNIQUE,applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');
for(const name of readdirSync(path.join(root,'fixture-migrations')).filter(n=>/^\d{4}_/.test(n)).sort())if(Number(name.slice(0,4))<=cutoff){db.exec(readFileSync(path.join(root,'fixture-migrations',name),'utf8'));db.prepare('INSERT INTO d1_migrations(name) VALUES(?)').run(name);}
if(scenario==='orphans')db.exec("PRAGMA foreign_keys=OFF; INSERT INTO driver_availability VALUES('CONFIDENTIAL_DRIVER','CONFIDENTIAL_MISSING','on_line',1,1); INSERT INTO order_assignments(id,order_id,driver_id,vehicle_id,assigned_by,reason,created_at) VALUES('CONFIDENTIAL_ASSIGNMENT','CONFIDENTIAL_ORDER','CONFIDENTIAL_DRIVER','CONFIDENTIAL_MISSING','CONFIDENTIAL_OWNER','CONFIDENTIAL_REASON',1); PRAGMA foreign_keys=ON");
if(scenario==='newer_chain')db.prepare('INSERT INTO d1_migrations(name) VALUES(?)').run('0026_unknown.sql');
if(scenario==='unknown_column')db.exec('ALTER TABLE vehicles ADD COLUMN confidential_unexpected TEXT');
db.exec('PRAGMA query_only=ON');
const normalize=sql=>sql.trim().replace(/;$/,'');
const meta=metadataSql(schema),allowed=new Set([meta,...plan.profiles.map(p=>readFileSync(path.join(root,p.sqlPath),'utf8'))].map(normalize));
let requests=0,metricRequests=0,metadataRequests=0,writeRequests=0,badRequests=0;
const server=createServer(async(request,response)=>{
 try{
  requests++;let body='';for await(const chunk of request)body+=chunk;
  if(request.method!=='POST'||request.url!=='/client/v4/accounts/'+'a'.repeat(32)+'/d1/database/'+TARGET.databaseId+'/query'){badRequests++;throw Error('Unexpected endpoint');}
  const {sql}=JSON.parse(body);if(typeof sql!=='string'||!allowed.has(normalize(sql))){writeRequests++;throw Error('Non-whitelisted SQL');}
  const aggregate=normalize(sql)!==normalize(meta);if(aggregate)metricRequests++;else metadataRequests++;
  if(scenario==='auth_error'){response.writeHead(401,{'Content-Type':'application/json'});response.end(JSON.stringify({success:false,errors:[{code:10000,message:'CONFIDENTIAL_PROVIDER_TOKEN'}],result:null}));return;}
  if(aggregate&&scenario==='timeout')return;
  if(aggregate&&scenario==='malformed'){response.writeHead(200,{'Content-Type':'application/json'});response.end('CONFIDENTIAL_NOT_JSON');return;}
  const before=db.prepare('SELECT total_changes() n').get().n;
  const results=sql.split(';').map(s=>s.trim()).filter(Boolean).map(statement=>({success:true,results:db.prepare(statement).all(),meta:{changed_db:false,changes:0}}));
  if(db.prepare('SELECT total_changes() n').get().n!==before){writeRequests++;throw Error('Read changed database');}
  if(aggregate&&scenario==='extra_column')results[0].results[0].confidential='CONFIDENTIAL_PROVIDER_VALUE';
  if(aggregate&&scenario==='wrong_counter')results[0].results[0].online_without_matching_candidate=99;
  if(aggregate&&scenario==='schema_changed'){db.exec('PRAGMA query_only=OFF');db.prepare('INSERT INTO d1_migrations(name) VALUES(?)').run('0026_unexpected.sql');db.exec('PRAGMA query_only=ON');}
  response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify({success:true,errors:[],messages:[],result:results}));
 }catch{response.writeHead(400,{'Content-Type':'application/json'});response.end(JSON.stringify({success:false,errors:[{code:1000,message:'CONFIDENTIAL_PROVIDER_FAILURE'}],messages:[],result:null}));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));server.unref();server.on('connection',socket=>socket.unref());
const original=child.spawn;
child.spawn=function(command,args,options){
 if(args?.[0]?.endsWith('wrangler-dist/cli.js')){
  if(options.env.WRANGLER_LOG_SANITIZE!=='true'||options.env.WRANGLER_SEND_METRICS!=='false')throw Error('Unsafe log policy');
  options={...options,env:{...options.env,CLOUDFLARE_API_BASE_URL:'http://127.0.0.1:'+server.address().port+'/client/v4',CLOUDFLARE_API_TOKEN:'CONFIDENTIAL_SYNTHETIC_TOKEN'}};
 }
 return original.call(this,command,args,options);
};
syncBuiltinESMExports();
process.on('exit',()=>{writeFileSync(path.join(root,'fixture-result.json'),JSON.stringify({requests,metricRequests,metadataRequests,writeRequests,badRequests,realCloudflareRequests:0}));db.close();});
