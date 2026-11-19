import {createHash} from 'node:crypto';
export const TARGET=Object.freeze({worker:'uber-v3-staging',databaseName:'transfer-servis52-staging',databaseId:'66474481-a123-47f9-81b4-12af7565ec8d'});
export const CONFIRMATION='READ STAGING VEHICLE METRICS';
export const hash=value=>createHash('sha256').update(value).digest('hex');
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join('|')===[...keys].sort().join('|');
export function makeConfig(accountId){
 if(typeof accountId!=='string'||!/^[a-f0-9]{32}$/.test(accountId))throw Error('Account ID required');
 return {name:TARGET.worker,account_id:accountId,d1_databases:[{binding:'DB',database_name:TARGET.databaseName,database_id:TARGET.databaseId}]};
}
export function checkConfig(config){
 if(!exact(config,['name','account_id','d1_databases'])||config.name!==TARGET.worker||!Array.isArray(config.d1_databases)||config.d1_databases.length!==1)throw Error('Unexpected target');
 const expected=makeConfig(config.account_id);
 if(!exact(config.d1_databases[0],['binding','database_name','database_id'])||Object.keys(expected.d1_databases[0]).some(k=>expected.d1_databases[0][k]!==config.d1_databases[0][k]))throw Error('Unexpected database');
 return config;
}
export function checkEnvironment(env,accountId){
 for(const key of ['CLOUDFLARE_API_BASE_URL','CF_API_BASE_URL','WRANGLER_API_BASE_URL','WRANGLER_ENV','CLOUDFLARE_ENV','NODE_OPTIONS'])if(env[key])throw Error('Unexpected environment override');
 for(const key of ['CLOUDFLARE_ACCOUNT_ID','CF_ACCOUNT_ID'])if(env[key]&&env[key]!==accountId)throw Error('Unexpected account');
}
export function resultRows(value,count){
 if(!Array.isArray(value)||value.length!==count)throw Error('Unexpected result count');
 return value.map(r=>{
  if(!r||r.success!==true||!Array.isArray(r.results)||r.error||r.errors?.length||r.meta?.changed_db===true||(r.meta?.changes!==undefined&&r.meta.changes!==0))throw Error('Unconfirmed read-only result');
  return r.results;
 });
}
export function metadataSql(schema){
 return 'SELECT name FROM d1_migrations ORDER BY id; SELECT name,type FROM sqlite_schema WHERE name IN ('+schema.tableNames.map(n=>"'"+n+"'").join(',')+') ORDER BY name; '+schema.tableNames.map(n=>'PRAGMA table_info('+n+');').join(' ');
}
export function selectProfile(value,schema,plan){
 const rows=resultRows(value,2+schema.tableNames.length),migrations=rows[0].map(r=>{
  if(!exact(r,['name'])||typeof r.name!=='string')throw Error('Invalid migration metadata');return r.name;
 });
 if(migrations.length<18||migrations.length>schema.migrations.length||migrations.some((n,i)=>n!==schema.migrations[i]))throw Error('Unknown migration chain');
 const tables={};
 for(const r of rows[1]){
  if(!exact(r,['name','type'])||!schema.tableNames.includes(r.name)||tables[r.name]||!['table','view'].includes(r.type))throw Error('Invalid table metadata');
  tables[r.name]={type:r.type,columns:[]};
 }
 schema.tableNames.forEach((name,index)=>{
  const columns=rows[index+2].map(r=>{if(typeof r.name!=='string')throw Error('Invalid columns');return r.name;}).sort();
  if(new Set(columns).size!==columns.length||(!tables[name]&&columns.length))throw Error('Inconsistent columns');
  if(tables[name])tables[name].columns=columns;
 });
 const contract=schema.contracts.find(c=>c.migrationCounts.includes(migrations.length));
 const normalize=value=>JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))));
 if(!contract||normalize(contract.tables)!==normalize(tables))throw Error('Unsupported schema');
 const profile=plan.profiles.find(p=>p.name===contract.profile);if(!profile)throw Error('Missing fixed profile');
 return {profile,schemaFingerprint:hash(JSON.stringify({migrations,tables:JSON.parse(normalize(tables))}))};
}
export function validateMetrics(value,profile){
 const rows=resultRows(value,1);if(rows[0].length!==1)throw Error('One aggregate row required');
 const m=rows[0][0];
 if(!exact(m,profile.returnedColumns)||Object.values(m).some(v=>!Number.isSafeInteger(v)||v<0))throw Error('Invalid aggregate fields');
 const total=m.current_candidate+m.current_manual_review+m.current_excluded+m.without_current_trusted_assessment;
 if(!Number.isSafeInteger(total)||total!==m.vehicles)throw Error('Invalid vehicle partition');
 for(const key of profile.returnedColumns.filter(k=>!k.startsWith('online_')&&!k.startsWith('active_assignments'))){if(m[key]>m.vehicles)throw Error('Invalid vehicle counter');}
 if(m.online_without_matching_candidate>m.online_drivers||m.active_assignments_with_hold>m.active_assignments||m.active_assignments_without_matching_candidate>m.active_assignments)throw Error('Invalid operational counters');
 return Object.fromEntries(profile.returnedColumns.map(k=>[k,m[k]]));
}
