// LOCAL DATABASE ONLY. Secrets are shown only to an interactive owner terminal, never CI logs.
import { DatabaseSync } from 'node:sqlite';
import { realpathSync,statSync } from 'node:fs';
import { provisionOwnerBootstrap } from '../src/core/ownerMfaControlPlane.js';
const args=process.argv.slice(2);
if(args.length===0||args.includes('--help')){
 console.log('Usage: node scripts/adminMfaBootstrap.mjs --local-db PATH --owner-id ACCOUNT [--reset --confirm-owner-id ACCOUNT]');
 console.log('Existing local SQLite DB only. No network/remote D1 access. Interactive private owner terminal required.');
 process.exit(0);
}
try{
 if(!process.stdout.isTTY||!process.stdin.isTTY||process.env.CI)throw new Error('Interactive private owner terminal required');
 const allowed=new Set(['--local-db','--owner-id','--reset','--confirm-owner-id']);let values={},reset=false;
 for(let i=0;i<args.length;i++){
  const arg=args[i];if(!allowed.has(arg)||Object.hasOwn(values,arg))throw new Error('Invalid arguments');
  if(arg==='--reset'){reset=true;values[arg]=true;}else{if(!args[i+1]||args[i+1].startsWith('--'))throw new Error('Missing argument');values[arg]=args[++i];}
 }
 const account=values['--owner-id'];if(typeof account!=='string'||!account||account.length>100)throw new Error('Owner ID required');
 if(reset&&values['--confirm-owner-id']!==account)throw new Error('Reset requires explicit matching owner confirmation');
 if(!reset&&values['--confirm-owner-id'])throw new Error('Unexpected reset confirmation');
 const path=realpathSync(values['--local-db']);if(!statSync(path).isFile())throw new Error('Existing local database required');
 const db=new DatabaseSync(path);db.exec('PRAGMA foreign_keys=ON');
 const execute=(sql,args,method)=>{const names=new Set(sql.match(/\?\d+/g)||[]);return db.prepare(sql)[method](...(names.size?[Object.fromEntries(args.map((v,i)=>['?'+(i+1),v]).filter(([k])=>names.has(k)))]:args));};
 const make=(sql,args=[])=>({sql,args,bind(...next){return make(sql,next);},async first(){return execute(sql,args,'get')??null;}});
 const DB={prepare:sql=>make(sql),async batch(statements){db.exec('BEGIN IMMEDIATE');try{const out=statements.map(s=>({meta:{changes:Number(execute(s.sql,s.args,'run').changes)}}));db.exec('COMMIT');return out;}catch(error){db.exec('ROLLBACK');throw error;}}};
 try{
  const result=await provisionOwnerBootstrap({DB},account,{reset});
  process.stdout.write('One-time bootstrap code (do not send to chat/Git/logs):\n'+result.bootstrapCode+'\nExpires: '+new Date(result.expiresAt).toISOString()+'\n');
 }finally{db.close();}
}catch{console.error('OWNER MFA CONTROL-PLANE ACTION FAILED. Check local DB, account and explicit reset arguments.');process.exitCode=1;}
