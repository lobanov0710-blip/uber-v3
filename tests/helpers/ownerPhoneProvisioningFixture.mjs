// Synthetic loopback provider for the real protected CLI + pinned Wrangler.
// Never loaded by the Worker, production CLI or a delivered setup command.
import {createServer} from 'node:http';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {OwnerPhoneWrangler} from './scripts/lib/ownerPhoneWrangler.mjs';
import {createAdminBootstrapAccount,buildStaffAccountInsertSql} from './src/core/staffProvisioning.js';
import {TARGET} from './scripts/lib/adminPhoneSetupPolicy.mjs';
const scenario=process.env.OWNER_FIXTURE_SCENARIO,db=new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys=ON');
db.exec("CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL UNIQUE,applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");
const migrations=readdirSync(new URL('./migrations/',import.meta.url)).filter(n=>/^\d{4}_.+\.sql$/.test(n)).sort();
for(const name of migrations){db.exec(readFileSync(new URL('./migrations/'+name,import.meta.url),'utf8'));db.prepare('INSERT INTO d1_migrations(name) VALUES(?)').run(name);}
if(scenario!=='new_success'){
 const account=await createAdminBootstrapAccount({login:'owner.fixture',displayName:'Synthetic OWNER',password:'Synthetic-Owner-Password-123!'},{id:'staff_fixture_owner01'});
 db.exec(buildStaffAccountInsertSql(account));db.prepare('INSERT INTO staff_owner_binding(singleton,account_id,created_at) VALUES(1,?,1)').run(account.id);
}
if(scenario==='import_failure')db.exec("CREATE TRIGGER fail_phone_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END");
let uploaded='',importRequests=0,uploads=0,verifyReads=0;
const envelope=result=>JSON.stringify({success:true,errors:[],messages:[],result});
const server=createServer(async(request,response)=>{
 try{
  let body='';for await(const chunk of request)body+=chunk;
  if(request.method==='PUT'&&request.url==='/upload'){
   uploaded=body;uploads++;response.writeHead(200,{etag:'"'+createHash('md5').update(body).digest('hex')+'"'});response.end();return;
  }
  let result;
  if(request.url.endsWith('/import')){
   const action=JSON.parse(body).action;
   if(action==='init')result={upload_url:process.env.CLOUDFLARE_API_BASE_URL.replace('/client/v4','/upload'),filename:'synthetic.sql'};
   else if(action==='ingest'){
    importRequests++;db.exec('BEGIN IMMEDIATE');
    try{db.exec(uploaded);db.exec('COMMIT');}catch{db.exec('ROLLBACK');throw Error('synthetic import rejected');}
    result={status:'complete',success:true,messages:[],result:{num_queries:6,final_bookmark:'synthetic-bookmark',meta:{duration:0.1,rows_read:1,rows_written:1,size_after:0}}};
   }else throw Error('unsupported import fixture action');
  }else if(request.url.endsWith('/query')){
   const {sql}=JSON.parse(body);if(!/^SELECT\b/i.test(sql))throw Error('fixture query must be read-only');
   const rows=db.prepare(sql).all();
   if(sql.startsWith('SELECT b.digest')){verifyReads++;if(scenario==='wrong_postcondition'&&rows[0])rows[0].expires_at++;}
   result=[{success:true,results:rows}];
  }else if(request.url.includes('/d1/database'))result={uuid:TARGET.databaseId,name:TARGET.database};
  else throw Error('unsupported fixture endpoint');
  response.writeHead(200,{'Content-Type':'application/json'});response.end(envelope(result));
 }catch{
  response.writeHead(400,{'Content-Type':'application/json'});response.end(JSON.stringify({success:false,errors:[{code:1000,message:'synthetic provider failure'}],messages:[],result:null}));
 }
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));server.unref();server.on('connection',socket=>socket.unref());
process.env.CLOUDFLARE_API_BASE_URL='http://127.0.0.1:'+server.address().port+'/client/v4';
process.env.CLOUDFLARE_API_TOKEN='synthetic-not-a-real-cloudflare-token';process.env.WRANGLER_LOG='log';
const run=OwnerPhoneWrangler.prototype.run;
OwnerPhoneWrangler.prototype.run=async function(args,options){
 if(args[0]==='d1'&&args[1]==='list')return [{uuid:TARGET.databaseId,name:TARGET.database}];
 if(args[0]==='deployments')return [{versions:[{version_id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',percentage:100}]}];
 if(args[0]==='versions')return {resources:{bindings:[{name:'DB',type:'d1',id:TARGET.databaseId},{name:'DRIVERS',type:'kv_namespace',namespace_id:TARGET.kvId},{name:'APP_ENV',type:'plain_text',text:'staging'}]}};
 if(args[0]==='secret'&&args[1]==='list')return [{name:'JWT_SECRET'},{name:'ADMIN_MFA_ENCRYPTION_KEY'}];
 if(args[0]==='d1'&&args[1]==='execute')return run.call(this,args,options);
 throw Error('fixture prohibits other operations');
};
globalThis.fetch=async input=>{
 const url=new URL(input);if(url.hostname!==TARGET.host)throw Error('unexpected fixture probe target');
 const status=url.pathname==='/v1/admin/me'?401:url.pathname==='/v1/admin/mfa/totp/verify'?405:404;
 return new Response('{}',{status,headers:{'X-Transfer-Test-Scope':'owner_phone'}});
};
process.on('exit',()=>{
 const count=name=>Number(db.prepare('SELECT COUNT(*) n FROM '+name).get().n);
 writeFileSync(new URL('./fixture-result.json',import.meta.url),JSON.stringify({accounts:count('staff_accounts'),owners:count('staff_owner_binding'),factors:count('admin_mfa_factors'),bootstrap:count('admin_mfa_bootstrap'),audits:count('audit_events'),importRequests,uploads,verifyReads}));db.close();
});
