import {spawn} from 'node:child_process';
import {readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {checkConfig,checkEnvironment} from './vehicleInventoryPolicy.mjs';
import {privateDirectory} from './vehicleInventoryFiles.mjs';

export class VehicleInventoryWrangler{
 constructor(root,config,allowedSql){this.root=root;this.config=checkConfig(config);this.allowedSql=new Set(allowedSql);}
 async query(sql){if(!this.allowedSql.has(sql))throw Error('Only fixed read-only SQL allowed');return this.#run(['d1','execute','DB','--remote','--command',sql,'--json']);}
 async #run(args){
  checkConfig(this.config);checkEnvironment(process.env,this.config.account_id);
  const pkg=JSON.parse(await readFile(path.join(this.root,'node_modules/wrangler/package.json'),'utf8'));
  if(pkg.version!=='4.125.0'||pkg.main!=='wrangler-dist/cli.js')throw Error('Pinned Wrangler required');
  const temporary=await privateDirectory('TransferDriver-InventoryLogs-',tmpdir());
  try{
   const configPath=path.join(temporary,'wrangler.json');await writeFile(configPath,JSON.stringify(this.config),{flag:'wx',mode:0o600});
   const output=await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[path.join(this.root,'node_modules/wrangler/wrangler-dist/cli.js'),...args,'--config',configPath],{cwd:this.root,shell:false,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,CLOUDFLARE_ACCOUNT_ID:this.config.account_id,WRANGLER_LOG_PATH:path.join(temporary,'private.log'),WRANGLER_LOG_SANITIZE:'true',WRANGLER_LOG:'log',WRANGLER_SEND_METRICS:'false',CI:'true'}});
    let bytes=0,finished=false,failed=false,forceTimer;const chunks=[];
    const finish=(error,value)=>{if(finished)return;finished=true;clearTimeout(timer);clearTimeout(forceTimer);process.removeListener('SIGINT',abort);error?reject(Error('Private provider read failed')):resolve(value);};
    const abort=()=>{if(failed)return;failed=true;child.kill();forceTimer=setTimeout(()=>child.kill('SIGKILL'),1000);};const timer=setTimeout(abort,30000);process.once('SIGINT',abort);
    child.on('error',()=>finish(true));
    const receive=(chunk,stdout)=>{bytes+=chunk.length;if(bytes>524288)return abort();if(stdout)chunks.push(chunk);};
    child.stdout.on('data',c=>receive(c,true));child.stderr.on('data',c=>receive(c,false));
    child.on('close',code=>finish(failed||code!==0,Buffer.concat(chunks).toString('utf8')));
   });
   try{return JSON.parse(output);}catch{throw Error('Invalid private provider JSON');}
  }finally{await rm(temporary,{recursive:true,force:true});}
 }
}
