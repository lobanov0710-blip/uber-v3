// Atomic corrections and trusted review shared by the HTTP API and internal workflows.
import { authorized, prepare, context } from './adminClassifierAccess.js';
import { mapVehicleRule } from './adminVehicleRuleService.js';
import { createMutationIdempotency } from './mutationIdempotency.js';
import { decideTrustedVehicle } from './trustedVehicleDecision.js';
import { APPROVED_VEHICLE_MAKES } from './approvedVehicleMakes.js';
const positive=v=>Number.isSafeInteger(v)&&v>0;
const text=(v,n=80)=>typeof v==='string'&&v===v.trim()&&v.length>0&&v.length<=n&&!/[\u0000-\u001f\u007f]/.test(v);
const version=v=>text(v,128)&&/^[A-Za-z0-9_.:-]+$/.test(v);
const fields=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
const fail=(status,code)=>({ok:false,status,code});
const columns='r.version,r.make,r.model,r.revision,r.min_year,r.class,r.notes,d.allowed_body_types,d.conditions_json';
function valid(body){
  if(!fields(body,['expectedRevision','expectedInputRevision','expectedRuleVersion','mode','parameters','evidence','conditions','exception','reason'])
    ||!positive(body.expectedRevision)||(body.expectedInputRevision!==null&&!positive(body.expectedInputRevision))||(body.expectedRuleVersion!==null&&!version(body.expectedRuleVersion))
    ||!['standard','exception'].includes(body.mode)||!text(body.reason,1000))return false;
  const p=body.parameters;
  if(!fields(p,['make','model','modelYear','powertrain','bodyType'])||!text(p.make)||!APPROVED_VEHICLE_MAKES.has(p.make)||!text(p.model)||!positive(p.modelYear)||p.modelYear>9999
    ||!['combustion','hybrid','battery_electric'].includes(p.powertrain)||!['sedan','crossover','minivan','other'].includes(p.bodyType))return false;
  if(!Array.isArray(body.evidence)||body.evidence.length<2||body.evidence.length>8
    ||body.evidence.some(e=>!fields(e,['documentId','expectedRevision'])||typeof e.documentId!=='string'||!/^[A-Za-z0-9_-]{8,120}$/.test(e.documentId)||!positive(e.expectedRevision))
    ||new Set(body.evidence.map(e=>e.documentId)).size!==body.evidence.length)return false;
  if(!Array.isArray(body.conditions)||body.conditions.length>32||body.conditions.some(c=>!fields(c,['conditionId','result'])||!text(c.conditionId,128)||!['satisfied','unmet'].includes(c.result)))return false;
  const x=body.exception;
  return body.mode==='standard'?x===null:fields(x,['basisRuleVersion','yearBelowMinimum','waivedConditionIds'])&&version(x.basisRuleVersion)
    &&typeof x.yearBelowMinimum==='boolean'&&Array.isArray(x.waivedConditionIds)&&x.waivedConditionIds.length<=32&&x.waivedConditionIds.every(v=>text(v,128));
}
function rows(r){if(r?.success!==true||!Array.isArray(r.results))throw Error('Assessment storage failed');return r.results;}
function acknowledged(row,digest){
  if(row.request_digest!==digest)return fail(409,'idempotency_key_conflict');
  if(row.state!=='completed')return fail(409,'idempotency_in_progress');
  return row.http_status===200?{ok:true,...JSON.parse(row.result_json)}:fail(409,row.result_code);
}
export async function recordTrustedVehicleAssessment(env,user,vehicleId,body,options={}){
  const c=await context(env,user,body?.mode==='exception'?'vehicles.approve_exception':'vehicles.verify',options,body?.mode==='exception');
  if(c.error)return c.error;
  if(!/^vehicle_[A-Za-z0-9_-]{8,100}$/.test(vehicleId)||!valid(body))return fail(400,'invalid_assessment');
  // Existing vehicles without a binding require the separately planned legacy
  // migration/inventory; never synthesize a first-save rule here.
  const idem=await createMutationIdempotency({key:options.idempotencyKey,operation:'admin.vehicle_assessment.record',target:vehicleId,body});
  if(!idem.ok)return idem;
  const prior=await env.DB.batch([
    prepare(env,`SELECT CASE WHEN ${authorized} THEN 1 ELSE 0 END AS allowed`,c.args),
    prepare(env,`SELECT request_digest,state,http_status,result_code,result_json FROM mutation_idempotency
      WHERE actor_account_id=?1 AND operation=?7 AND key_digest=?8 AND ${authorized}`,[...c.args,idem.operation,idem.keyDigest])]);
  if(rows(prior[0])[0]?.allowed!==1)return fail(403,'permission_required');
  if(rows(prior[1])[0])return acknowledged(rows(prior[1])[0],idem.requestDigest);
  const state=await env.DB.prepare(`SELECT v.make AS actual_make,v.model AS actual_model,v.model_year,v.powertrain AS declared_powertrain,v.driver_id,
    b.input_revision,b.rule_version AS pinned_version,COALESCE((SELECT MAX(sequence) FROM vehicle_trusted_assessments WHERE vehicle_id=v.id),0) AS sequence,${columns}
    FROM vehicles v LEFT JOIN vehicle_classification_bindings b ON b.vehicle_id=v.id AND b.input_revision=(SELECT MAX(input_revision) FROM vehicle_classification_bindings WHERE vehicle_id=v.id)
    LEFT JOIN vehicle_classification_rules r ON r.version=b.rule_version LEFT JOIN vehicle_classification_rule_definitions d ON d.rule_version=r.version
    WHERE v.id=?1`).bind(vehicleId).first();
  if(!state)return fail(404,'vehicle_not_found');
  const p=body.parameters;
  const changed=state.actual_make!==p.make||state.actual_model!==p.model||state.model_year!==p.modelYear;
  if(state.input_revision==null&&!changed)return fail(422,'vehicle_binding_required');
  let rule=state.version?mapVehicleRule(state):null;
  if(changed){
    const current=await env.DB.prepare(`SELECT ${columns} FROM vehicle_classification_current_rules h
      JOIN vehicle_classification_rules r ON r.version=h.rule_version LEFT JOIN vehicle_classification_rule_definitions d ON d.rule_version=r.version
      WHERE h.make=?1 AND h.model=?2`).bind(p.make,p.model).first();
    rule=current?mapVehicleRule(current):null;
  }
  const targetPinned=rule?.version??null;
  const targetInput=(state.input_revision??0)+(changed?1:0);
  if(body.mode==='exception'){
    const r=await env.DB.prepare(`SELECT ${columns} FROM vehicle_classification_rules r LEFT JOIN vehicle_classification_rule_definitions d ON d.rule_version=r.version WHERE r.version=?1`)
      .bind(body.exception.basisRuleVersion).first();
    if(!r)return fail(404,'rule_not_found');rule=mapVehicleRule(r);
  }
  const decision=decideTrustedVehicle(p,rule,body.conditions,body.exception);
  if(decision.error)return fail(400,decision.error);
  const id='assessment_'+crypto.randomUUID(),audit='audit_'+crypto.randomUUID(),claim='claim_'+crypto.randomUUID();c.args[3]=Date.now();
  const result={assessmentId:id,vehicleId,vehicleRevision:body.expectedRevision+1,inputRevision:targetInput,classification:decision};
  const args=[...c.args,vehicleId,body.expectedRevision,body.expectedInputRevision,body.expectedRuleVersion,id,state.sequence+1,
    p.powertrain,p.bodyType,body.mode,body.exception===null?null:JSON.stringify(body.exception),JSON.stringify(body.evidence),JSON.stringify(body.conditions),
    decision.outcome,decision.vehicleClass,JSON.stringify(decision.reasonCodes),body.reason,audit,idem.operation,idem.keyDigest,idem.requestDigest,claim,
    decision.ruleVersion,state.declared_powertrain,JSON.stringify(result),c.requestId,p.make,p.model,p.modelYear,changed?1:0,state.pinned_version??null,targetPinned,targetInput,state.input_revision??null];
  const owns=`EXISTS(SELECT 1 FROM mutation_idempotency i WHERE i.actor_account_id=?1 AND i.operation=?24 AND i.key_digest=?25
    AND i.request_digest=?26 AND i.claim_id=?27 AND i.state='in_progress')`;
  const validState=`EXISTS(SELECT 1 FROM vehicles v LEFT JOIN vehicle_classification_bindings b ON b.vehicle_id=v.id AND b.input_revision=(SELECT MAX(input_revision) FROM vehicle_classification_bindings WHERE vehicle_id=v.id)
    WHERE v.id=?7 AND v.revision=?8 AND v.powertrain IS ?29
    AND b.input_revision IS ?9 AND b.input_revision IS ?39 AND b.rule_version IS ?36
    AND ?10 IS ?37 AND (?35=0 OR (SELECT rule_version FROM vehicle_classification_current_rules WHERE make=?32 AND model=?33) IS ?37) AND ?12=COALESCE((SELECT MAX(sequence) FROM vehicle_trusted_assessments WHERE vehicle_id=v.id),0)+1
    AND NOT EXISTS(SELECT 1 FROM json_each(?17) e WHERE NOT EXISTS(SELECT 1 FROM document_resources d WHERE d.id=json_extract(e.value,'$.documentId')
      AND d.revision=json_extract(e.value,'$.expectedRevision') AND d.status='verified' AND d.vehicle_id=v.id AND d.owner_driver_id=v.driver_id
      AND d.kind IN ('sts_front','sts_back') AND (d.expires_at IS NULL OR d.expires_at>MAX(?4,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)))))
    AND 2=(SELECT count(DISTINCT d.kind) FROM document_resources d JOIN json_each(?17) e ON d.id=json_extract(e.value,'$.documentId') WHERE d.kind IN ('sts_front','sts_back')))`;
  const batch=await env.DB.batch([
    prepare(env,`SELECT CASE WHEN ${authorized} THEN 1 ELSE 0 END AS allowed`,args),
    prepare(env,`INSERT INTO mutation_idempotency(actor_account_id,operation,key_digest,request_digest,claim_id,state,created_at)
      SELECT ?1,?24,?25,?26,?27,'in_progress',?4 WHERE ${authorized} ON CONFLICT(actor_account_id,operation,key_digest) DO NOTHING`,args),
    prepare(env,`INSERT INTO audit_events(id,actor_account_id,action,target_type,target_id,outcome,request_id,created_at)
      SELECT ?23,?1,'admin.vehicle_assessment_recorded','vehicle',?7,'success',?31,?4 WHERE ${authorized} AND ${owns} AND ${validState}`,args),
    prepare(env,`UPDATE vehicles SET make=?32,model=?33,model_year=?34,class=NULL,
      status=CASE WHEN status IN ('approved','photo_check_required') THEN 'pending_review' ELSE status END,revision=revision+1,updated_at=?4
      WHERE id=?7 AND revision=?8 AND EXISTS(SELECT 1 FROM audit_events WHERE id=?23)`,args),
    prepare(env,`INSERT INTO vehicle_trusted_assessments(id,vehicle_id,sequence,vehicle_revision,input_revision,pinned_rule_version,rule_version,
      make,model,model_year,declared_powertrain,powertrain,body_type,mode,exception_json,evidence_json,conditions_json,outcome,class,reason_codes_json,reason,actor_account_id,audit_event_id,created_at)
      SELECT ?11,v.id,?12,v.revision,?38,?37,?28,v.make,v.model,v.model_year,v.powertrain,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?1,?23,?4
      FROM vehicles v WHERE v.id=?7 AND v.revision=?8+1 AND EXISTS(SELECT 1 FROM audit_events WHERE id=?23)`,args),
    prepare(env,`INSERT INTO vehicle_reverification_assignment_holds(assignment_id,vehicle_id,assessment_id,created_at)
      SELECT a.id,a.vehicle_id,?11,?4 FROM order_assignments a WHERE a.vehicle_id=?7 AND a.state='active' AND a.revoked_at IS NULL
      AND EXISTS(SELECT 1 FROM vehicle_trusted_assessments WHERE id=?11) ON CONFLICT(assignment_id) DO NOTHING`,args),
    prepare(env,`UPDATE driver_availability SET state='off_line',revision=revision+1,updated_at=?4
      WHERE active_vehicle_id=?7 AND state<>'off_line' AND EXISTS(SELECT 1 FROM vehicle_trusted_assessments WHERE id=?11)`,args),
    prepare(env,`UPDATE mutation_idempotency SET state='completed',http_status=CASE WHEN EXISTS(SELECT 1 FROM vehicle_trusted_assessments WHERE id=?11) THEN 200 ELSE 409 END,
      result_code=CASE WHEN EXISTS(SELECT 1 FROM vehicle_trusted_assessments WHERE id=?11) THEN NULL ELSE 'assessment_revision_or_evidence_conflict' END,
      result_json=CASE WHEN EXISTS(SELECT 1 FROM vehicle_trusted_assessments WHERE id=?11) THEN json_set(?30,'$.requiresDispatcherReassignment',json(CASE WHEN EXISTS(SELECT 1 FROM order_assignments a JOIN vehicle_reverification_assignment_holds h ON h.assignment_id=a.id WHERE a.vehicle_id=?7 AND a.state='active' AND a.revoked_at IS NULL) THEN 'true' ELSE 'false' END)) ELSE '{}' END,completed_at=?4
      WHERE actor_account_id=?1 AND operation=?24 AND key_digest=?25 AND request_digest=?26 AND claim_id=?27 AND state='in_progress'`,args),
    prepare(env,`SELECT request_digest,state,http_status,result_code,result_json FROM mutation_idempotency WHERE actor_account_id=?1 AND operation=?24 AND key_digest=?25`,args),
    prepare(env,`SELECT CASE WHEN ${authorized} THEN 1 ELSE 0 END AS allowed`,args)
  ]);
  if(rows(batch[0])[0]?.allowed!==1||rows(batch.at(-1))[0]?.allowed!==1)return fail(403,'permission_required');
  const ack=rows(batch[8])[0];if(!ack)throw Error('Assessment acknowledgement missing');return acknowledged(ack,idem.requestDigest);
}
