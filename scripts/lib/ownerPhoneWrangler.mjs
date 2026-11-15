import { spawn } from 'node:child_process';
import { mkdtemp,rm,readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkConfig } from './adminPhoneSetupPolicy.mjs';
export class OwnerPhoneWrangler {
 constructor(root,configPath){this.root=root;this.configPath=configPath;}
 async run(args,{input=null,json=false}={}){
  const config=checkConfig(JSON.parse(await readFile(this.configPath,'utf8')));
  const pkg=JSON.parse(await readFile(path.join(this.root,'node_modules/wrangler/package.json'),'utf8'));
  if(pkg.version!=='4.125.0')throw new Error('Pinned Wrangler 4.125.0 required');
  if(process.env.WRANGLER_ENV||process.env.CLOUDFLARE_ENV)throw new Error('Unexpected environment selector');
  const temporary=await mkdtemp(path.join(tmpdir(),'transfer-owner-log-'));
  try{
   const output=await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[path.join(this.root,'node_modules/wrangler/bin/wrangler.js'),...args,'--config',this.configPath],{
     cwd:this.root,shell:false,stdio:['pipe','pipe','pipe'],env:{...process.env,CLOUDFLARE_ACCOUNT_ID:config.account_id,WRANGLER_LOG_PATH:path.join(temporary,'wrangler.log'),WRANGLER_SEND_METRICS:'false',CI:'true'}});
    const stdout=[],stderr=[];let bytes=0;const timer=setTimeout(()=>{child.kill();reject(new Error('Cloudflare command timed out; inspect state before retry'));},180000);
    const abort=()=>{child.kill();reject(new Error('Owner cancelled'));};process.once('SIGINT',abort);
    child.on('error',()=>{clearTimeout(timer);process.removeListener('SIGINT',abort);reject(new Error('Cannot start pinned Wrangler'));});
    const receive=(chunk,err)=>{bytes+=chunk.length;if(bytes>2_097_152){child.kill();return;}(err?stderr:stdout).push(chunk);};
    child.stdout.on('data',c=>receive(c,false));child.stderr.on('data',c=>receive(c,true));child.stdin.on('error',()=>{});
    child.stdin.end(input==null?undefined:input+'\n');
    child.on('close',code=>{clearTimeout(timer);process.removeListener('SIGINT',abort);
     if(code!==0||bytes>2_097_152)return reject(new Error(/not authenticated|Authentication error|10000/i.test(Buffer.concat([...stderr,...stdout]).toString('utf8'))?'Cloudflare login or permission required':'Cloudflare command failed; no raw provider output printed'));
     resolve(Buffer.concat(stdout).toString('utf8'));
    });
   });
   if(!json)return null;
   try{return JSON.parse(output);}catch{throw new Error('Unexpected Cloudflare response; stop before writing');}
  }finally{await rm(temporary,{recursive:true,force:true});}
 }
}
