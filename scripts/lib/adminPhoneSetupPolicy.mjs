// Protected local control-plane helpers; never imported by the Worker/router.
import { buildStaffAccountInsertSql } from '../../src/core/staffProvisioning.js';
import { BOOTSTRAP_TTL } from '../../src/core/ownerMfaRepository.js';
export const TARGET=Object.freeze({worker:'uber-v3-staging',host:'uber-v3-staging.lobanov0710.workers.dev',database:'transfer-servis52-staging',databaseId:'66474481-a123-47f9-81b4-12af7565ec8d',kvId:'b8fdeb74fda8415ab06b3b1c86c78e8f'});
export function makeConfig(accountId){
 if(!/^[a-f0-9]{32}$/.test(accountId))throw new Error('Invalid Cloudflare account ID');
 return {name:TARGET.worker,account_id:accountId,main:'src/index.js',compatibility_date:'2026-06-01',workers_dev:true,
  vars:{APP_ENV:'staging',ADMIN_PHONE_TEST_ONLY:'true'},triggers:{crons:['0 * * * *']},
  kv_namespaces:[{binding:'DRIVERS',id:TARGET.kvId}],d1_databases:[{binding:'DB',database_name:TARGET.database,database_id:TARGET.databaseId,migrations_dir:'migrations'}]};
}
export function checkConfig(config){
 const expected=makeConfig(config?.account_id);
 const canonical=v=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):Array.isArray(v)?v.map(canonical):v;
 if(JSON.stringify(canonical(config))!==JSON.stringify(canonical(expected)))throw new Error('Exact OWNER phone-test configuration required');
 return expected;
}
export function checkRemoteVersion(version){
 const bindings=version?.resources?.bindings;if(!Array.isArray(bindings))throw new Error('Worker bindings cannot be verified');
 const db=bindings.filter(b=>b.name==='DB'),kv=bindings.filter(b=>b.name==='DRIVERS');
 if(db.length!==1||db[0].type!=='d1'||db[0].id!==TARGET.databaseId||kv.length!==1||kv[0].type!=='kv_namespace'||kv[0].namespace_id!==TARGET.kvId)throw new Error('Remote staging bindings mismatch');
 for(const b of bindings){
  if(b.type==='secret_text'||b.name==='DB'||b.name==='DRIVERS')continue;
  if(b.type==='plain_text'&&((b.name==='APP_ENV'&&b.text==='staging')||(b.name==='ADMIN_PHONE_TEST_ONLY'&&b.text==='true')))continue;
  throw new Error('Unexpected current binding requires separate review');
 }
 return bindings.map(b=>({name:b.name,type:b.type}));
}
function literal(value){
 if(typeof value==='number'&&Number.isSafeInteger(value)&&value>0)return String(value);
 if(typeof value!=='string'||value.length>1000||/[\u0000-\u001f\u007f]/.test(value))throw new Error('Invalid control-plane SQL value');
 return "'"+value.replaceAll("'","''")+"'";
}
export function bootstrapStatements({account,newAccount=false,digest,now=Date.now()}){
 if(!account||typeof account.id!=='string'||!account.id||account.id.length>100||!/^[a-f0-9]{64}$/.test(digest)||!Number.isSafeInteger(now)||now<1)throw new Error('Invalid OWNER bootstrap plan');
 const id=literal(account.id),hash=literal(digest),time=literal(now),expiry=literal(now+BOOTSTRAP_TTL),audit=literal('audit_'+crypto.randomUUID());
 const statements=[];
 if(newAccount){statements.push(buildStaffAccountInsertSql(account).trim().replace(/;$/,''));statements.push(`INSERT INTO staff_owner_binding(singleton,account_id,created_at) VALUES(1,${id},${time})`);}
 const owner=`SELECT a.id FROM staff_accounts a JOIN staff_owner_binding o ON o.account_id=a.id AND o.singleton=1 WHERE a.id=${id} AND a.role='admin' AND a.status='active' AND NOT EXISTS(SELECT 1 FROM admin_mfa_factors WHERE account_id=a.id)`;
 statements.push(`INSERT INTO admin_mfa_bootstrap(account_id,digest,expires_at) SELECT id,${hash},${expiry} FROM (${owner}) WHERE true ON CONFLICT(account_id) DO UPDATE SET digest=excluded.digest,expires_at=excluded.expires_at,attempts=0,enrollment_digest=NULL,consumed_at=NULL`);
 const claimed=`EXISTS(SELECT 1 FROM admin_mfa_bootstrap b WHERE b.account_id=${id} AND b.digest=${hash} AND b.expires_at=${expiry})`;
 statements.push(`UPDATE staff_sessions SET revoked_at=COALESCE(revoked_at,${time}) WHERE account_id=${id} AND ${claimed}`);
 statements.push(`DELETE FROM admin_mfa_challenges WHERE account_id=${id} AND ${claimed}`);
 statements.push(`INSERT INTO audit_events(id,actor_account_id,action,target_type,target_id,outcome,created_at) SELECT ${audit},${id},'admin.mfa.phone_bootstrap_created','owner_mfa',${id},'success',${time} WHERE ${claimed}`);
 return {statements,sql:statements.join(';\n')+';\n',expiresAt:now+BOOTSTRAP_TTL};
}
