// Run on the owner's private Windows terminal. No public provisioning endpoint.
import { readFile,writeFile,mkdir,mkdtemp,rm,readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { makeConfig,checkConfig,checkRemoteVersion,bootstrapStatements,phoneDeployPhrase,TARGET } from './lib/adminPhoneSetupPolicy.mjs';
import { OwnerPhoneWrangler } from './lib/ownerPhoneWrangler.mjs';
import { privateTerminal,ask,hidden,confirm } from './lib/ownerTerminal.mjs';
import { putMissingPhoneSecret } from './lib/ownerPhoneSecrets.mjs';
import { createAdminBootstrapAccount } from '../src/core/staffProvisioning.js';
import { randomToken,digest } from '../src/core/ownerMfaCrypto.js';
const root=fileURLToPath(new URL('../',import.meta.url)),configPath=path.join(root,'wrangler.admin-phone.staging.json'),privateDir=path.join(root,'.owner-phone');
const actions=new Set(['init','plan','schema','isolate','jwt-key','mfa-key','deploy','owner']);
const args=process.argv.slice(2),action=actions.has(args[0])?args[0]:'invalid_action';
if(args.length===0||(args.length===1&&args[0]==='--help')){
 console.log('Usage: node scripts/adminOwnerPhoneSetup.mjs init|plan|schema|isolate|jwt-key|mfa-key|deploy|owner');
 console.log('STAGING OWNER only. Private TTY required. init writes only a local config; plan is remote read-only.');
 console.log('Other actions require separate exact typed confirmation. No password/token arguments, CI, redirection, production or public reset.');
 process.exit(0);
}
const hash=b=>createHash('sha256').update(b).digest('hex');
async function sourceVerified(){
 const release=JSON.parse(await readFile(path.join(root,'owner-phone-release.json'),'utf8'));
 if(!/^[a-f0-9]{40}$/.test(release.sourceCommit)||!release.files||Object.keys(release.files).length<15)throw new Error('Verified source manifest required');
 for(const [name,expected]of Object.entries(release.files)){
  if(!/^(src\/|scripts\/|migrations\/|package\.json$|package-lock\.json$)/.test(name)||name.split('/').includes('..')||!(/^[a-f0-9]{64}$/).test(expected))throw new Error('Invalid release manifest');
  if(hash(await readFile(path.join(root,name)))!==expected)throw new Error('Source differs from verified package');
 }
 return release;
}
let client;
async function query(sql){
 const result=await client.run(['d1','execute','DB','--remote','--command',sql,'--json'],{json:true});
 if(!Array.isArray(result)||result.length!==1||result[0].success!==true||!Array.isArray(result[0].results))throw new Error('D1 read did not confirm target state');
 return result[0].results;
}
async function state(){
 const databases=await client.run(['d1','list','--json'],{json:true});
 if(!Array.isArray(databases)||!databases.some(d=>d.uuid===TARGET.databaseId&&d.name===TARGET.database))throw new Error('Known staging database not confirmed');
 const deployments=await client.run(['deployments','list','--json'],{json:true});
 const active=Array.isArray(deployments)?deployments.at(-1):null;
 if(active?.versions?.length!==1||active.versions[0].percentage!==100)throw new Error('One active staging version required');
 const versionId=active.versions[0].version_id;if(!/^[a-f0-9-]{36}$/.test(versionId))throw new Error('Invalid active version');
 const version=await client.run(['versions','view',versionId,'--json'],{json:true});const bindings=checkRemoteVersion(version);
 const secrets=await client.run(['secret','list','--format','json'],{json:true});
 if(!Array.isArray(secrets)||secrets.some(s=>typeof s.name!=='string'))throw new Error('Secret names unavailable');
 const applied=(await query('SELECT name FROM d1_migrations ORDER BY id')).map(r=>r.name);
 const local=(await readdir(path.join(root,'migrations'))).filter(n=>/^\d{4}_.+\.sql$/.test(n)).sort();
 if(local.length!==18||applied.some(n=>!local.includes(n)))throw new Error('Unexpected migration chain');
 const pending=local.filter(n=>!applied.includes(n));if(pending.some(n=>n!=='0018_owner_totp_mfa.sql'))throw new Error('Only migration 0018 may be pending');
 const owners=await query("SELECT a.id,a.login,a.status,a.role FROM staff_owner_binding o JOIN staff_accounts a ON a.id=o.account_id WHERE o.singleton=1");
 if(owners.length>1||owners.some(o=>o.status!=='active'||o.role!=='admin'))throw new Error('Active OWNER state needs separate review');
 const tables=await query("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'admin_mfa_%'");
 if(tables.length!==(pending.length?0:7))throw new Error('MFA schema and migration tracking disagree');
 const factors=pending.length?0:Number((await query('SELECT COUNT(*) n FROM admin_mfa_factors'))[0].n);
 return {bindings,versionId,pending,owner:owners[0]??null,factors,jwtPresent:secrets.some(s=>s.name==='JWT_SECRET'),mfaKeyPresent:secrets.some(s=>s.name==='ADMIN_MFA_ENCRYPTION_KEY')};
}
async function probe(){
 for(const [route,status]of [['/v1/admin/me',401],['/v1/admin/mfa/totp/verify',405],['/v1/driver/me',404],['/orders',404]]){
  const response=await fetch('https://'+TARGET.host+route,{redirect:'error',signal:AbortSignal.timeout(20000)});
  try{if(response.status!==status||response.headers.get('X-Transfer-Test-Scope')!=='owner_phone')throw new Error('Deployed OWNER-only scope not confirmed');}
  finally{await response.body?.cancel();}
 }
}
try{
 if(args.length!==1||!actions.has(action))throw new Error('Invalid action');privateTerminal();
 const release=await sourceVerified();await mkdir(privateDir,{recursive:true,mode:0o700});
 if(action==='init'){
  const config=makeConfig(await ask('Cloudflare Account ID (32 lowercase hex characters, not a token): '));
  await writeFile(configPath,JSON.stringify(config,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log('Local STAGING config created. No remote changes. Next: Cloudflare browser login, then plan.');
 }else{
  checkConfig(JSON.parse(await readFile(configPath,'utf8')));client=new OwnerPhoneWrangler(root,configPath);
  console.log('Reading the exact STAGING target; credentials and provider output stay private.');const current=await state();
  if(action==='plan'){
   await client.run(['deploy','--dry-run','--outdir',path.join(privateDir,'dry-run')]);
   const report={kind:'OWNER_PHONE_READ_ONLY_PLAN',sourceCommit:release.sourceCommit,worker:TARGET.worker,hostname:TARGET.host,database:TARGET.database,databaseId:TARGET.databaseId,
    DriverG1Suspended:true,pendingMigrations:current.pending,ownerExists:!!current.owner,ownerFactorCount:current.factors,jwtSecretPresent:current.jwtPresent,mfaSecretPresent:current.mfaKeyPresent,
    currentVersion:current.versionId,currentBindings:current.bindings,scope:'OWNER and one reserved synthetic registration; no Driver/public/legacy API or private storage',remoteWritesPerformed:false};
   await writeFile(path.join(privateDir,'admin-phone-plan.public.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
   console.log('READ-ONLY plan complete. Share only .owner-phone/admin-phone-plan.public.json for review. Do not run write actions before approval.');
  }else if(action==='schema'){
   if(current.pending.length===0){console.log('Migration 0018 already applied; no apply repeated.');process.exitCode=0;}
   else{await confirm('APPLY 0018 TO transfer-servis52-staging');await client.run(['d1','migrations','apply','DB','--remote']);if((await state()).pending.length)throw new Error('Migration not confirmed');console.log('STAGING migration 0018 confirmed.');}
  }else if(action==='jwt-key'||action==='mfa-key'){
   const jwt=action==='jwt-key',name=jwt?'JWT_SECRET':'ADMIN_MFA_ENCRYPTION_KEY';
   const created=await putMissingPhoneSecret(client,current,name,confirm,probe);
   if(created){
    const verified=await state();if(!(jwt?verified.jwtPresent:verified.mfaKeyPresent))throw new Error('Secret name not confirmed');
    console.log(name+' set through stdin; no key printed or saved.');
   }else console.log(name+' already present; never rotated by this setup.');
  }else if(action==='isolate'||action==='deploy'){
   await confirm(phoneDeployPhrase(current,action==='isolate'));await client.run(['deploy']);await probe();
   console.log('STAGING OWNER-only route isolation confirmed. Login still requires both keys, OWNER and TOTP.');
  }else if(action==='owner'){
   if(current.pending.length||!current.jwtPresent||!current.mfaKeyPresent)throw new Error('Schema and secrets not ready');await probe();
   let account=current.owner,newAccount=false;
   if(account){
    const enrolled=await query("SELECT account_id FROM admin_mfa_factors WHERE account_id='"+account.id.replaceAll("'","''")+"'");
    if(enrolled.length)throw new Error('OWNER already enrolled; no password/factor reset is provided');
    console.log('Existing OWNER found. It will not be replaced. Use its existing login/password.');
   }else{
    const choice=(await ask('Create a new OWNER account (N), or bind an existing active admin (E)? ')).toUpperCase();
    if(choice==='N'){
     const login=await ask('New OWNER login: '),displayName=await ask('Display name: ');let password=await hidden('New password (16–128 characters, hidden): '),again=await hidden('Repeat password (hidden): ');
     try{if(password!==again)throw new Error('Password mismatch');account=await createAdminBootstrapAccount({login,displayName,password});newAccount=true;}finally{password=null;again=null;}
    }else if(choice==='E'){
     const id=await ask('Exact existing active admin account ID: ');if(!/^[A-Za-z0-9_-]{1,100}$/.test(id))throw new Error('Invalid account ID');
     const rows=await query("SELECT id,login FROM staff_accounts WHERE id='"+id+"' AND role='admin' AND status='active'");
     if(rows.length!==1)throw new Error('Existing active admin not confirmed');account=rows[0];
     // Binding an existing account also belongs to the one atomic import.
    }else throw new Error('Explicit account choice required');
   }
   await confirm('PROVISION STAGING OWNER '+account.id);
   const now=Number((await query("SELECT CAST(strftime('%s','now') AS INTEGER)*1000 now_ms"))[0]?.now_ms);
   if(!Number.isSafeInteger(now)||now<1)throw new Error('Database clock unavailable');
   if(newAccount)account={...account,passwordChangedAt:now,createdAt:now,updatedAt:now};
   const code=randomToken('bootstrap'),digestValue=await digest('mfa-bootstrap',code),plan=bootstrapStatements({account,newAccount,digest:digestValue,now});
   if(!current.owner&&!newAccount)plan.sql="INSERT INTO staff_owner_binding(singleton,account_id,created_at) SELECT 1,id,"+now+" FROM staff_accounts WHERE id='"+account.id+"' AND role='admin' AND status='active';\n"+plan.sql;
   const temporary=await mkdtemp(path.join(tmpdir(),'transfer-owner-sql-'));
   try{
    const file=path.join(temporary,'owner.sql');await writeFile(file,plan.sql,{flag:'wx',mode:0o600});
    // Pinned Wrangler --file uses Cloudflare's atomic D1 import with rollback on failure.
    await client.run(['d1','execute','DB','--remote','--file',file,'--yes','--json'],{json:true});
    const id=account.id.replaceAll("'","''");const verified=await query("SELECT b.digest,b.expires_at FROM admin_mfa_bootstrap b JOIN staff_owner_binding o ON o.account_id=b.account_id AND o.singleton=1 JOIN staff_accounts a ON a.id=b.account_id WHERE b.account_id='"+id+"' AND a.role='admin' AND a.status='active' AND b.expires_at>CAST(strftime('%s','now') AS INTEGER)*1000");
    if(verified.length!==1||verified[0].digest!==digestValue||verified[0].expires_at!==plan.expiresAt)throw new Error('Bootstrap not confirmed; no code shown');
   }finally{await rm(temporary,{recursive:true,force:true});}
   console.log('One-time setup code (private terminal only; do NOT send to chat or logs):\n'+code+'\nExpires: '+new Date(plan.expiresAt).toISOString());
   console.log('In the APK: login/password → this setup code → add the displayed seed manually to your authenticator → confirm TOTP → save backup codes → fresh login/TOTP.');
  }
 }
}catch{
 console.error('OWNER PHONE SETUP FAILED at '+action+'. No raw credentials/provider/SQL output printed. Stop and share only the safe plan or action name.');process.exitCode=1;
}
