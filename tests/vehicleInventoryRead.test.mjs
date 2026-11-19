import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFile,spawnSync} from 'node:child_process';
import {promisify} from 'node:util';
import {makeConfig,checkConfig,checkEnvironment,metadataSql,selectProfile,validateMetrics,resultRows,TARGET} from '../scripts/lib/vehicleInventoryPolicy.mjs';
import {VehicleInventoryWrangler} from '../scripts/lib/vehicleInventoryWrangler.mjs';
import {privateDirectory,writeJson} from '../scripts/lib/vehicleInventoryFiles.mjs';
const schema=JSON.parse(await readFile(new URL('../scripts/vehicle-inventory-schema.json',import.meta.url)));
const plan=JSON.parse(await readFile(new URL('../docs/VEHICLE_LEGACY_INVENTORY_READ_PLAN_2026-11-19.json',import.meta.url)));
const result=rows=>({success:true,results:rows,meta:{changed_db:false,changes:0}});
function metadata(contract,count){
 return [result(schema.migrations.slice(0,count).map(name=>({name}))),result(Object.entries(contract.tables).map(([name,v])=>({name,type:v.type}))),...schema.tableNames.map(name=>result((contract.tables[name]?.columns??[]).map(name=>({name}))))];
}
const profile=plan.profiles[0];
function metrics(){const m=Object.fromEntries(profile.returnedColumns.map(k=>[k,0]));m.vehicles=1;m.without_current_trusted_assessment=1;return m;}

test('configuration accepts only the approved staging tuple and no extra selectors',()=>{
 const c=makeConfig('a'.repeat(32));assert.deepEqual(checkConfig(c),c);
 for(const mutate of [v=>v.name='uber-v3',v=>v.account_id='bad',v=>v.env={},v=>v.d1_databases[0].database_id='production',v=>v.d1_databases.push(v.d1_databases[0]),v=>v.main='src/index.js']){
  const bad=structuredClone(c);mutate(bad);assert.throws(()=>checkConfig(bad));
 }
 for(const k of ['CLOUDFLARE_API_BASE_URL','CF_API_BASE_URL','WRANGLER_API_BASE_URL','WRANGLER_ENV','CLOUDFLARE_ENV','NODE_OPTIONS','CF_ACCOUNT_ID','CLOUDFLARE_ACCOUNT_ID'])assert.throws(()=>checkEnvironment({[k]:'PRIVATE_WRONG_VALUE'},c.account_id));
 assert.doesNotThrow(()=>checkEnvironment({CLOUDFLARE_ACCOUNT_ID:c.account_id},c.account_id));
});
test('all eight known migration states select the intended fixed profile',()=>{
 for(const contract of schema.contracts)for(const count of contract.migrationCounts){
  const value=selectProfile(metadata(contract,count),schema,plan);
  assert.equal(value.profile.name,contract.profile);assert.match(value.schemaFingerprint,/^[a-f0-9]{64}$/);
 }
});
test('newer or reordered migration chains and partial or unknown schema stop before metric selection',()=>{
 const c=schema.contracts.at(-1),base=metadata(c,25);
 for(const mutate of [v=>v[0].results.push({name:'0026_unknown.sql'}),v=>v[0].results.reverse(),v=>v[2].results.pop(),v=>v[2].results.push({name:'PRIVATE_UNEXPECTED_COLUMN'}),v=>v[1].results.find(r=>r.name==='vehicle_current_trusted_assessments').type='table',v=>v[1].results.pop()]){
  const bad=structuredClone(base);mutate(bad);assert.throws(()=>selectProfile(bad,schema,plan));
 }
});
test('metadata SQL contains only known read operations and never credentials or private table contents',()=>{
 const sql=metadataSql(schema);assert.ok(sql.startsWith('SELECT name FROM d1_migrations'));
 assert.ok(!/INSERT|UPDATE|DELETE|ATTACH|load_extension|staff_accounts|admin_mfa/i.test(sql));
 assert.equal(sql.match(/PRAGMA table_info/g).length,8);
});
test('strict provider result handling never substitutes zero for missing or failed responses',()=>{
 for(const v of [null,[],[{success:false,results:[]}],[{success:true,results:[],meta:{changed_db:true}}],[{success:true,results:[],meta:{changes:1}}],[{success:true,results:[],errors:['PRIVATE_PROVIDER']}],{}])assert.throws(()=>resultRows(v,1));
 for(const mutate of [m=>delete m.vehicles,m=>m.extra='PRIVATE_SECRET',m=>m.vehicles='1',m=>m.missing_year=-1,m=>m.vehicles=Infinity,m=>m.vehicles=Number.MAX_SAFE_INTEGER+1,m=>m.current_candidate=1,m=>m.active_assignments_with_hold=1,m=>m.online_without_matching_candidate=1,m=>m.missing_color=2]){
  const m=metrics();mutate(m);assert.throws(()=>validateMetrics([result([m])],profile));
 }
});
test('orphan operational counts may exceed vehicle count but never their driver or assignment totals',()=>{
 const m=metrics();m.online_drivers=3;m.online_without_matching_candidate=3;m.active_assignments=4;m.active_assignments_without_matching_candidate=4;
 assert.deepEqual(validateMetrics([result([m])],profile),m);
});
test('wrapper rejects arbitrary SQL before loading auth or spawning provider commands',async()=>{
 const c=new VehicleInventoryWrangler('PRIVATE_MISSING_ROOT',makeConfig('a'.repeat(32)),['SELECT 1']);
 await assert.rejects(c.query('DELETE FROM vehicles'));await assert.rejects(c.query('SELECT password_hash FROM staff_accounts'));
 assert.equal(c.run,undefined);assert.equal(c.config.d1_databases[0].database_id,TARGET.databaseId);
});
test('CLI refuses non-TTY, CI and unrecognised actions without disclosing arguments',()=>{
 for(const args of [['read'],['init'],['PRIVATE_TOKEN'],['read','--sql','PRIVATE_SQL']]){
  const r=spawnSync(process.execPath,['scripts/vehicleInventoryRead.mjs',...args],{encoding:'utf8',env:{...process.env,CI:'true'}});
  assert.equal(r.status,1);assert.match(r.stderr,/VEHICLE INVENTORY FAILED/);assert.ok(!/PRIVATE_TOKEN|PRIVATE_SQL|SELECT|password/i.test(r.stdout+r.stderr));
 }
});
test('private files are owner-only on POSIX and owner/SYSTEM only on actual Windows',async t=>{
 const parent=await mkdtemp(path.join(tmpdir(),'inventory-storage-test-'));t.after(()=>rm(parent,{recursive:true,force:true}));
 const folder=await privateDirectory('result-',parent);await writeJson(folder,'metrics.private.json',{synthetic:true});
 assert.equal(JSON.parse(await readFile(path.join(folder,'metrics.private.json'),'utf8')).synthetic,true);
 if(process.platform==='win32'){
  for(const target of [folder,path.join(folder,'metrics.private.json')]){
   const literal=target.replaceAll("'","''");
   const command="$ErrorActionPreference='Stop'; $a=Get-Acl -LiteralPath '"+literal+"'; [pscustomobject]@{ currentSid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; protected=$a.AreAccessRulesProtected; values=@($a.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier]) | ForEach-Object { [pscustomobject]@{ sid=$_.IdentityReference.Value; allow=($_.AccessControlType -eq 'Allow'); full=(($_.FileSystemRights -band 2032127) -eq 2032127) } }) } | ConvertTo-Json -Depth 4 -Compress";
   const nativeEnvironment=Object.fromEntries(Object.entries(process.env).filter(([name])=>name.toUpperCase()!=='PSMODULEPATH'));
   const executable=path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
   const acl=await promisify(execFile)(executable,['-NoProfile','-NonInteractive','-Command',command],{env:nativeEnvironment});
   const v=JSON.parse(acl.stdout),entries=v.values,ids=new Set(entries.map(e=>e.sid));
   assert.ok(ids.size===2&&ids.has('S-1-5-18')&&ids.has(v.currentSid)&&entries.every(e=>e.allow&&e.full),JSON.stringify({target:target===folder?'folder':'file',entryCount:entries.length,principalCount:ids.size,hasOwner:ids.has(v.currentSid),hasSystem:ids.has('S-1-5-18'),otherPrincipal:[...ids].some(id=>![v.currentSid,'S-1-5-18'].includes(id)),allFull:entries.every(e=>e.allow&&e.full)}));
   if(target===folder)assert.equal(v.protected,true);
  }
 }else{
  assert.equal((await stat(folder)).mode&0o777,0o700);assert.equal((await stat(path.join(folder,'metrics.private.json'))).mode&0o777,0o600);
 }
});
