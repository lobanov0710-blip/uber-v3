// Owner-private terminal only. No write, provisioning, export or deployment action.
import {readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {privateTerminal,ask,confirm} from './lib/ownerTerminal.mjs';
import {TARGET,CONFIRMATION,hash,makeConfig,checkConfig,checkEnvironment,metadataSql,selectProfile,validateMetrics} from './lib/vehicleInventoryPolicy.mjs';
import {VehicleInventoryWrangler} from './lib/vehicleInventoryWrangler.mjs';
import {privateDirectory,writeJson} from './lib/vehicleInventoryFiles.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),args=process.argv.slice(2),action=args.length===1&&['init','read'].includes(args[0])?args[0]:'invalid_action';
if(args.length===0||(args.length===1&&args[0]==='--help')){
 console.log('Usage: node scripts/vehicleInventoryRead.mjs init|read\nApproved STAGING metadata + 18 private aggregates only. Private TTY required.');process.exit(0);
}
let phase=action,folder;
try{
 if(action==='invalid_action')throw Error('Unknown action');privateTerminal();if(process.env.GITHUB_ACTIONS)throw Error('Private terminal required');phase='source';
 const release=JSON.parse(await readFile(path.join(root,'vehicle-inventory-release.json'),'utf8'));
 const required=['scripts/vehicleInventoryRead.mjs','scripts/lib/ownerTerminal.mjs','scripts/lib/vehicleInventoryPolicy.mjs','scripts/lib/vehicleInventoryWrangler.mjs','scripts/lib/vehicleInventoryFiles.mjs','scripts/vehicle-inventory-schema.json','docs/VEHICLE_LEGACY_INVENTORY_READ_PLAN_2026-11-19.json','README-WINDOWS.md','package.json','package-lock.json',...['legacy','registration','bindings','trusted','holds'].map(n=>'docs/proposals/vehicle-inventory-readonly/'+n+'.sql')];
 if(!/^[a-f0-9]{40}$/.test(release.sourceCommit)||!/^[a-f0-9]{40}$/.test(release.sourceTree)||Object.keys(release.files??{}).sort().join('|')!==[...required].sort().join('|')||required.some(n=>!(/^[a-f0-9]{64}$/).test(release.files?.[n])))throw Error('Pinned source required');
 for(const n of required)if(hash(await readFile(path.join(root,n)))!==release.files[n])throw Error('Package source changed');
 const configPath=path.join(root,'wrangler.vehicle-inventory.staging.json');
 if(action==='init'){
  let existing;
  try{existing=checkConfig(JSON.parse(await readFile(configPath,'utf8')));}catch(error){if(error.code!=='ENOENT')throw error;}
  if(existing){checkEnvironment(process.env,existing.account_id);console.log('LOCAL_CONFIG_ALREADY_PRESENT. Target verified; nothing replaced. Next: read.');}
  else{
   const config=makeConfig(await ask('Cloudflare Account ID (32 lowercase hex; NOT a token): '));checkEnvironment(process.env,config.account_id);
   await writeFile(configPath,JSON.stringify(config,null,2)+'\n',{flag:'wx',mode:0o600});
   console.log('LOCAL_CONFIG_READY. Next: private Cloudflare login, then read.');
  }
 }else{
  phase='config';
  const config=checkConfig(JSON.parse(await readFile(configPath,'utf8')));checkEnvironment(process.env,config.account_id);
  const schema=JSON.parse(await readFile(path.join(root,'scripts/vehicle-inventory-schema.json'),'utf8'));
  const plan=JSON.parse(await readFile(path.join(root,'docs/VEHICLE_LEGACY_INVENTORY_READ_PLAN_2026-11-19.json'),'utf8'));
  if(plan.status!=='approved_variant_A'||plan.remoteReadAuthorized!==true||plan.remoteWriteAllowed!==false||plan.target.databaseId!==TARGET.databaseId||plan.profiles.length!==5)throw Error('Approved read plan required');
  const queries=new Map();for(const p of plan.profiles){const sql=await readFile(path.join(root,p.sqlPath),'utf8');if(hash(sql)!==p.sqlSha256)throw Error('Fixed query changed');queries.set(p.name,sql);}
  const meta=metadataSql(schema),client=new VehicleInventoryWrangler(root,config,[meta,...queries.values()]);
  phase='metadata';console.log('Reading known STAGING schema metadata; provider output stays private.');
  const before=selectProfile(await client.query(meta),schema,plan),profile=before.profile;
  console.log('PROFILE='+profile.name+' QUERY_SHA256='+profile.sqlSha256);phase='confirm';await confirm(CONFIRMATION);
  phase='private_folder';folder=await privateDirectory('TransferDriver-Inventory-');
  phase='aggregate';const startedAtUtc=new Date().toISOString();
  const metrics=validateMetrics(await client.query(queries.get(profile.name)),profile),completedAtUtc=new Date().toISOString();
  phase='metadata_recheck';const after=selectProfile(await client.query(meta),schema,plan);
  if(after.schemaFingerprint!==before.schemaFingerprint)throw Error('Schema changed during read');
  phase='save';const common={formatVersion:1,scope:'staging_private_aggregate_read',sourceCommit:release.sourceCommit,sourceTree:release.sourceTree,worker:TARGET.worker,databaseName:TARGET.databaseName,databaseId:TARGET.databaseId,profile:profile.name,querySha256:profile.sqlSha256,startedAtUtc,completedAtUtc,activationAuthorized:false,admissionEvaluated:false,remoteWritesPerformed:false};
  await writeJson(folder,'metrics.private.json',{...common,schemaCapabilities:profile.schemaCapabilities,schemaFingerprint:before.schemaFingerprint,metrics});
  await writeJson(folder,'receipt.public.json',{...common,result:'success',sourceFilesVerified:true,schemaStable:true,aggregateFormatVerified:true,privateReportWritten:true});
  console.log('READ_ONLY_COMPLETE. Files: %USERPROFILE%\\'+path.basename(folder)+'\\');
  console.log('Keep metrics.private.json private. Share ONLY receipt.public.json; it contains no metrics or private-report hash.');folder=null;
 }
}catch{
 let cleanup=true;if(folder){try{await rm(folder,{recursive:true,force:true});}catch{cleanup=false;}}
 console.error('VEHICLE INVENTORY FAILED at '+phase+'. No result accepted; no credentials/provider/SQL output disclosed.'+(cleanup?'':' PRIVATE_OUTPUT_CLEANUP_REQUIRED.'));
 process.exitCode=1;
}
