import { adminCan,resolveAdminAccess } from './adminAuthorization.js';
import { createMutationIdempotency } from './mutationIdempotency.js';
import { APPROVED_VEHICLE_MAKES } from './approvedVehicleMakes.js';

const fail=(status,code)=>({ok:false,status,error:status===403?'forbidden':status===404?'not found':'invalid request',code});
const text=(v,max=80)=>typeof v==='string'&&v===v.trim()&&v.length>0&&v.length<=max&&!/[\u0000-\u001f\u007f]/.test(v);
const version=v=>text(v,128)&&/^[A-Za-z0-9_.:-]+$/.test(v);
const positive=v=>Number.isSafeInteger(v)&&v>0;
const types=['sedan','crossover','minivan','other'];
const ownerExists=`EXISTS(SELECT 1 FROM staff_owner_binding o WHERE o.singleton=1 AND o.account_id=a.id)`;
const sqlNow=`MAX(?4,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))`;
// Fixed, server-owned SQL. The first six bindings always describe the current
// authenticated principal; payload role, permission and MFA booleans are ignored.
const authorized=`EXISTS(SELECT 1 FROM staff_accounts a JOIN staff_sessions s ON s.account_id=a.id
 WHERE a.id=?1 AND s.id=?2 AND a.role='admin' AND a.status='active' AND a.token_version=?3
 AND (a.locked_until IS NULL OR a.locked_until<=?4) AND s.revoked_at IS NULL
 AND s.replaced_by_session_id IS NULL AND s.expires_at>${sqlNow}
 AND ((${ownerExists} AND EXISTS(SELECT 1 FROM admin_mfa_session_families e
   JOIN admin_mfa_factors f ON f.account_id=e.account_id AND f.revision=e.factor_revision
   WHERE e.account_id=a.id AND e.family_id=s.family_id AND e.token_version=a.token_version
   AND e.verified_at<=?4 AND f.enabled_at<=e.verified_at AND e.expires_at>${sqlNow} AND e.expires_at<=s.expires_at))
 OR (?6=0 AND NOT ${ownerExists} AND EXISTS(SELECT 1 FROM staff_permissions p
   WHERE p.account_id=a.id AND lower(trim(p.permission))=?5))))`;
function prepare(env,sql,args){
  const n=Math.max(0,...[...sql.matchAll(/\?(\d+)/g)].map(m=>Number(m[1])));
  return env.DB.prepare(sql).bind(...args.slice(0,n));
}
async function context(env,user,permission,options,ownerOnly=false){
  if(user?.role!=='admin'||typeof user.sessionId!=='string'||!positive(user.tokenVersion))return {error:fail(403,'admin_role_required')};
  const access=await resolveAdminAccess(env,user);
  if(!access.ok||!adminCan(access,permission)||(ownerOnly&&!access.isOwner))return {error:fail(403,ownerOnly?'owner_required':'permission_required')};
  if(access.isOwner&&(options.mfa?.required!==true||options.mfa?.verified!==true))return {error:fail(403,'owner_mfa_required')};
  return {args:[user.id,user.sessionId,user.tokenVersion,Date.now(),permission,ownerOnly?1:0],requestId:options.requestId??('req_'+crypto.randomUUID())};
}
function rows(result){if(result?.success!==true||!Array.isArray(result.results))throw Error('Vehicle rule read failed');return result.results;}
const projection=`r.version,r.make,r.model,r.revision,r.min_year,r.class,r.notes,d.allowed_body_types,d.conditions_json`;
function rule(row){
  if(!row)return null;
  const allowed=row.conditions_json==null
    ? row.class==='comfort'?['sedan','crossover']:row.class==='business'?[row.make==='Li Auto'&&['L7','L9'].includes(row.model)?'crossover':'sedan']:null
    : row.allowed_body_types==null?null:JSON.parse(row.allowed_body_types);
  // Preserve a legacy note as one indivisible condition, never guess its meaning.
  const conditions=row.conditions_json==null?(row.notes?[row.notes]:[]):JSON.parse(row.conditions_json);
  if(!version(row.version)||!text(row.make)||!text(row.model)||!positive(row.revision)||!positive(row.min_year)
    ||row.min_year>9999||!['comfort','business','minivan'].includes(row.class)
    ||!Array.isArray(conditions)||conditions.length>32||conditions.some(x=>!text(x,1000))
    ||(allowed!==null&&(!Array.isArray(allowed)||!allowed.length||allowed.some(x=>!types.includes(x)))))throw Error('Invalid vehicle rule data');
  return {version:row.version,make:row.make,model:row.model,revision:row.revision,minYear:row.min_year,
    vehicleClass:row.class,allowedBodyTypes:allowed,conditions:conditions.map((value,i)=>({id:row.version+':'+(i+1),text:value}))};
}
async function sha256(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');}
function auditTargetExists(action,slot){return action==='admin.vehicle_rule_read'?`EXISTS(SELECT 1 FROM vehicle_classification_rules WHERE version=${slot})`
  :action==='admin.vehicle_classification_read'?`EXISTS(SELECT 1 FROM vehicles WHERE id=${slot})`:'1';}
async function audit(env,c,action,target){
  const exists=auditTargetExists(action,'?9');
  return prepare(env,`INSERT INTO audit_events
 (id,actor_account_id,action,target_type,target_id,outcome,request_id,created_at)
 SELECT ?7,?1,?8,CASE WHEN ?8='admin.vehicle_classification_read' THEN 'vehicle' ELSE 'vehicle_rule' END,?11,'success',?10,?4
 WHERE ${authorized} AND (${exists})`,[...c.args,'audit_'+crypto.randomUUID(),action,target,c.requestId,
    target.length<=120?target:'rule_ref_'+await sha256(target)]);}
async function read(env,c,queries,action,target){
  c.args[3]=Date.now();
  const result=await env.DB.batch([prepare(env,`SELECT CASE WHEN ${authorized} THEN 1 ELSE 0 END AS allowed`,c.args),
    ...queries.map(q=>prepare(env,q.sql,[...c.args,...q.args])),await audit(env,c,action,target),
    prepare(env,`SELECT changes() AS audited,CASE WHEN ${authorized} THEN 1 ELSE 0 END AS allowed,
      CASE WHEN (${auditTargetExists(action,'?7')}) THEN 1 ELSE 0 END AS expected_audit`,[...c.args,target])]);
  const receipt=rows(result.at(-1))[0];
  if(rows(result[0])[0]?.allowed!==1||receipt?.allowed!==1)return fail(403,'permission_required');
  if(result.some(x=>x?.success!==true))throw Error('Vehicle rule read audit failed');
  if(receipt.audited!==receipt.expected_audit)throw Error('Vehicle rule read audit missing');
  return {ok:true,data:result.slice(1,-2).map(rows)};
}
function encode(value){return btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function decode(value){try{if(!/^[A-Za-z0-9_-]{1,1024}$/.test(value))return null;
  const raw=atob(value.replace(/-/g,'+').replace(/_/g,'/'));const v=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(raw,x=>x.charCodeAt(0))));return encode(v)===value?v:null;}catch{return null;}}
export async function listAdminVehicleRules(env,user,params=new URLSearchParams(),options={}){
  const c=await context(env,user,'vehicles.read',options);if(c.error)return c.error;
  for(const key of params.keys())if(!['make','model','limit','cursor'].includes(key)||params.getAll(key).length!==1)return fail(400,'invalid_query');
  const make=params.get('make')??'',model=params.get('model')??'',limit=params.get('limit')??'50';
  if((make&&!text(make))||(model&&!text(model))||params.get('make')===''||params.get('model')===''||!/^(?:[1-9]|[1-4][0-9]|50)$/.test(limit))return fail(400,'invalid_query');
  const filter=await sha256(JSON.stringify([make,model]));
  const cursor=params.has('cursor')?decode(params.get('cursor')):null;
  if(params.has('cursor')&&(!Array.isArray(cursor)||cursor.length!==5||cursor[0]!=='vehicle-rules.v1'||cursor[1]!==filter
    ||!Number.isSafeInteger(cursor[2])||cursor[2]<0||!text(cursor[3])||!text(cursor[4])))return fail(400,'invalid_cursor');
  const r=await read(env,c,[{sql:`SELECT COALESCE(MAX(rowid),0) AS generation FROM vehicle_classification_rules WHERE ${authorized}`,args:[]},
    {sql:`SELECT ${projection} FROM vehicle_classification_current_rules h JOIN vehicle_classification_rules r ON r.version=h.rule_version
      LEFT JOIN vehicle_classification_rule_definitions d ON d.rule_version=r.version
      WHERE ${authorized} AND (?7='' OR r.make=?7) AND (?8='' OR r.model=?8)
      AND (r.make>?9 OR (r.make=?9 AND r.model>?10)) ORDER BY r.make,r.model LIMIT ?11`,args:[make,model,cursor?.[3]??'',cursor?.[4]??'',Number(limit)+1]}],
    'admin.vehicle_rules_read','rules');if(!r.ok)return r;
  const generation=r.data[0][0].generation;if(!Number.isSafeInteger(generation)||generation<0)throw Error('Invalid rule generation');
  if(cursor&&cursor[2]!==generation)return fail(409,'rule_cursor_stale');
  const values=r.data[1].slice(0,Number(limit)).map(rule),last=values.at(-1);
  return {ok:true,rules:values,nextCursor:r.data[1].length>Number(limit)?encode(['vehicle-rules.v1',filter,generation,last.make,last.model]):null};
}
export async function readAdminVehicleRule(env,user,id,options={}){
  const c=await context(env,user,'vehicles.read',options);if(c.error)return c.error;if(!version(id))return fail(400,'invalid_rule_version');
  const r=await read(env,c,[{sql:`SELECT ${projection} FROM vehicle_classification_rules r LEFT JOIN vehicle_classification_rule_definitions d ON d.rule_version=r.version
    WHERE r.version=?7 AND ${authorized}`,args:[id]}],'admin.vehicle_rule_read',id);
  if(!r.ok)return r;return r.data[0][0]?{ok:true,rule:rule(r.data[0][0])}:fail(404,'rule_not_found');
}
function validWrite(body){
  const fields=['make','model','minYear','vehicleClass','allowedBodyTypes','conditions','expectedCurrentVersion','reason'];
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==fields.length||fields.some(k=>!Object.hasOwn(body,k))
    ||Object.keys(body).some(k=>!fields.includes(k))||!text(body.make)||!APPROVED_VEHICLE_MAKES.has(body.make)||!text(body.model)
    ||!positive(body.minYear)||body.minYear>9999||!['comfort','business','minivan'].includes(body.vehicleClass)
    ||!text(body.reason,1000)||(body.expectedCurrentVersion!==null&&!version(body.expectedCurrentVersion))
    ||!Array.isArray(body.conditions)||body.conditions.length>32||body.conditions.some(x=>!text(x,1000))||new Set(body.conditions).size!==body.conditions.length)return false;
  const a=body.allowedBodyTypes;
  if(a!==null&&(!Array.isArray(a)||a.length<1||a.length>4||a.some(x=>!types.includes(x))||new Set(a).size!==a.length))return false;
  if(body.vehicleClass==='comfort'&&(a===null||a.some(x=>!['sedan','crossover'].includes(x))))return false;
  if(body.vehicleClass==='business'&&(a===null||a.some(x=>x!==(body.make==='Li Auto'&&['L7','L9'].includes(body.model)?'crossover':'sedan'))))return false;
  return true;
}
export async function createAdminVehicleRule(env,user,body,options={}){
  const c=await context(env,user,'vehicle_rules.manage',options,true);if(c.error)return c.error;
  if(!validWrite(body))return fail(400,'invalid_rule');
  const idempotency=await createMutationIdempotency({key:options.idempotencyKey,operation:'admin.vehicle_rule.create',target:JSON.stringify([body.make,body.model]),body});
  if(!idempotency.ok)return idempotency;
  const id='rule_'+crypto.randomUUID(),claim='claim_'+crypto.randomUUID();c.args[3]=Date.now();
  const args=[...c.args,idempotency.operation,idempotency.keyDigest,idempotency.requestDigest,claim,id,body.make,body.model,body.minYear,
    body.vehicleClass,body.conditions.join('\n'),body.expectedCurrentVersion,body.allowedBodyTypes===null?null:JSON.stringify(body.allowedBodyTypes),
    JSON.stringify(body.conditions),body.reason,'audit_'+crypto.randomUUID(),c.requestId];
  const owns=`EXISTS(SELECT 1 FROM mutation_idempotency i WHERE i.actor_account_id=?1 AND i.operation=?7 AND i.key_digest=?8
    AND i.request_digest=?9 AND i.claim_id=?10 AND i.state='in_progress')`;
  const r=await env.DB.batch([
    prepare(env,`SELECT CASE WHEN ${authorized} THEN 1 ELSE 0 END AS allowed`,args),
    prepare(env,`INSERT INTO mutation_idempotency(actor_account_id,operation,key_digest,request_digest,claim_id,state,created_at)
      SELECT ?1,?7,?8,?9,?10,'in_progress',?4 WHERE ${authorized} ON CONFLICT(actor_account_id,operation,key_digest) DO NOTHING`,args),
    prepare(env,`INSERT INTO vehicle_classification_rules(version,make,model,revision,min_year,class,notes,created_at)
      SELECT ?11,?12,?13,COALESCE((SELECT MAX(revision) FROM vehicle_classification_rules WHERE make=?12 AND model=?13),0)+1,?14,?15,?16,?4
      WHERE ${owns} AND (SELECT rule_version FROM vehicle_classification_current_rules WHERE make=?12 AND model=?13) IS ?17`,args),
    prepare(env,`INSERT INTO vehicle_classification_rule_definitions(rule_version,allowed_body_types,conditions_json,created_by,reason,created_at)
      SELECT ?11,?18,?19,?1,?20,?4 FROM vehicle_classification_rules WHERE version=?11`,args),
    prepare(env,`INSERT INTO vehicle_classification_current_rules(make,model,rule_version)
      SELECT ?12,?13,?11 FROM vehicle_classification_rules WHERE version=?11
      ON CONFLICT(make,model) DO UPDATE SET rule_version=excluded.rule_version WHERE vehicle_classification_current_rules.rule_version IS ?17`,args),
    prepare(env,`INSERT INTO audit_events(id,actor_account_id,action,target_type,target_id,outcome,request_id,created_at)
      SELECT ?21,?1,'admin.vehicle_rule_created','vehicle_rule',?11,'success',?22,?4 FROM vehicle_classification_current_rules WHERE rule_version=?11`,args),
    prepare(env,`UPDATE mutation_idempotency SET state='completed',http_status=CASE WHEN EXISTS(SELECT 1 FROM vehicle_classification_rules WHERE version=?11) THEN 201 ELSE 409 END,
      result_code=CASE WHEN EXISTS(SELECT 1 FROM vehicle_classification_rules WHERE version=?11) THEN NULL ELSE 'rule_revision_conflict' END,
      result_json=CASE WHEN EXISTS(SELECT 1 FROM vehicle_classification_rules WHERE version=?11) THEN json_object('ruleVersion',?11) ELSE '{}' END,completed_at=?4
      WHERE actor_account_id=?1 AND operation=?7 AND key_digest=?8 AND request_digest=?9 AND claim_id=?10 AND state='in_progress'`,args),
    prepare(env,`SELECT request_digest,state,http_status,result_code,result_json FROM mutation_idempotency WHERE actor_account_id=?1 AND operation=?7 AND key_digest=?8`,args),
    prepare(env,`SELECT ${projection} FROM vehicle_classification_rules r JOIN vehicle_classification_rule_definitions d ON d.rule_version=r.version
      WHERE r.version=(SELECT json_extract(result_json,'$.ruleVersion') FROM mutation_idempotency WHERE actor_account_id=?1 AND operation=?7 AND key_digest=?8)
      AND ${authorized}`,args)
  ]);
  if(rows(r[0])[0]?.allowed!==1)return fail(403,'permission_required');
  const ack=rows(r[7])[0];if(!ack)throw Error('Vehicle rule acknowledgement missing');
  if(ack.request_digest!==idempotency.requestDigest)return fail(409,'idempotency_key_conflict');
  if(ack.state!=='completed')return fail(409,'idempotency_in_progress');
  if(ack.http_status!==201)return fail(409,ack.result_code||'rule_revision_conflict');
  const saved=rows(r[8])[0];if(!saved)return fail(403,'permission_required');return {ok:true,rule:rule(saved)};
}
export async function readAdminVehicleClassification(env,user,id,params=new URLSearchParams(),options={}){
  const c=await context(env,user,'vehicles.verify',options);if(c.error)return c.error;
  if(!/^vehicle_[A-Za-z0-9_-]{8,100}$/.test(id))return fail(400,'invalid_vehicle_id');
  if([...params.keys()].length)return fail(400,'invalid_query'); // No assessment-history cursor exists yet.
  const r=await read(env,c,[{sql:`SELECT v.id,v.revision AS vehicle_revision,v.make AS actual_make,v.model AS actual_model,v.model_year,v.color,
      b.input_revision,b.rule_version AS pinned_version,${projection}
      FROM vehicles v LEFT JOIN vehicle_classification_bindings b ON b.vehicle_id=v.id
      AND b.input_revision=(SELECT MAX(input_revision) FROM vehicle_classification_bindings WHERE vehicle_id=v.id)
      LEFT JOIN vehicle_classification_rules r ON r.version=b.rule_version
      LEFT JOIN vehicle_classification_rule_definitions d ON d.rule_version=r.version WHERE v.id=?7 AND ${authorized}`,args:[id]}],
    'admin.vehicle_classification_read',id);if(!r.ok)return r;const row=r.data[0][0];if(!row)return fail(404,'vehicle_not_found');
  return {ok:true,vehicleId:id,vehicleRevision:row.vehicle_revision,inputRevision:row.input_revision??null,
    declaredParameters:{make:row.actual_make,model:row.actual_model,modelYear:row.model_year??null,color:row.color??null},
    verifiedParameters:null,pinnedRuleVersion:row.pinned_version??null,classification:null,evidence:[],conditions:row.version?rule(row).conditions:[],history:[],nextHistoryCursor:null};
}
