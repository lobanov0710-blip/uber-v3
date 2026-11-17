import assert from 'node:assert/strict';
import { authenticateStaffRequest } from '../../src/core/staffAuthorization.js';
import { recordTrustedVehicleAssessment } from '../../src/core/trustedVehicleAssessmentRepository.js';
import { ruleOwnerLogin,ruleBody,moderator,driverId,fixturePassword,ownerId } from './adminVehicleRuleScenario.mjs';
export async function trustedScenario(env,send){
  const ownerToken=await ruleOwnerLogin(env,send);
  const token=(await send('POST','/staff/login',{login:moderator,password:fixturePassword})).body.accessToken;
  const driver=(await send('POST','/staff/login',{login:driverId,password:fixturePassword})).body.accessToken;
  const published=await send('POST','/v1/admin/vehicle-rules',ruleBody,ownerToken,'trusted-fixture-rule');assert.equal(published.status,201);
  const rule=published.body.rule;
  const made=await send('POST','/v1/driver/vehicles',{vin:'XW8ZZZ61ZFG000001',plate:'SYNTHETIC',make:'Toyota',model:'Camry',modelYear:2023,
    color:'Белый',capacity:4,baggageCapacity:'standard',usageBasis:'owner'},driver);assert.equal(made.status,201);
  const vehicle=made.body.vehicle,evidence=[];
  for(const [id,kind]of [['document_trusted_front','sts_front'],['document_trusted_back','sts_back']]){
    await env.DB.prepare("INSERT INTO document_resources(id,owner_driver_id,vehicle_id,kind,private_object_key,status,created_at,updated_at) VALUES(?1,?2,?3,?4,?1,'verified',1,1)")
      .bind(id,driverId,vehicle.id,kind).run();evidence.push({documentId:id,expectedRevision:1});
  }
  const body={expectedRevision:1,expectedInputRevision:1,expectedRuleVersion:rule.version,mode:'standard',
    parameters:{make:'Toyota',model:'Camry',modelYear:2023,powertrain:'hybrid',bodyType:'sedan'},evidence,
    conditions:rule.conditions.map(c=>({conditionId:c.id,result:'satisfied'})),exception:null,reason:'Synthetic verified parameters'};
  const capture=async(bodyValue=body,key='trusted-capture',asToken=token)=>{
    const auth=await authenticateStaffRequest(new Request('https://fixture.invalid',{headers:{Authorization:'Bearer '+asToken}}),env);
    if(!auth.ok)return {ok:false,status:auth.status};
    return recordTrustedVehicleAssessment(env,auth.user,vehicle.id,bodyValue,{idempotencyKey:key,mfa:auth.mfa});
  };
  return {ownerToken,token,driver,rule,vehicle,body,capture};
}
export async function trustedStorageWorkflow(env,send){
  const s=await trustedScenario(env,send),first=await s.capture();assert.equal(first.ok,true);assert.equal(first.classification.outcome,'candidate');
  assert.equal(first.classification.vehicleClass,'comfort');
  assert.equal((await send('POST','/v1/admin/vehicles/'+s.vehicle.id+'/classification/review',s.body,s.ownerToken,'trusted-public-not-enabled')).status,404);
  assert.deepEqual(await s.capture(),first);
  assert.equal((await s.capture({...s.body,reason:'Changed'},'trusted-capture')).status,409);
  const vehicle=await env.DB.prepare('SELECT class,status,revision FROM vehicles WHERE id=?1').bind(s.vehicle.id).first();
  assert.equal(vehicle.class,null);assert.equal(vehicle.status,'draft');assert.equal(vehicle.revision,2);
  assert.equal((await env.DB.prepare('SELECT id FROM vehicle_current_trusted_assessments WHERE vehicle_id=?1').bind(s.vehicle.id).first()).id,first.assessmentId);
  await env.DB.prepare("UPDATE vehicles SET color='Blue',revision=revision+1 WHERE id=?1").bind(s.vehicle.id).run();
  assert.ok(await env.DB.prepare('SELECT id FROM vehicle_current_trusted_assessments WHERE vehicle_id=?1').bind(s.vehicle.id).first());
  await env.DB.prepare("UPDATE document_resources SET private_object_key='SyntheticChanged' WHERE id='document_trusted_front'").run();
  await env.DB.prepare("UPDATE document_resources SET private_object_key=id WHERE id='document_trusted_front'").run();
  assert.equal(await env.DB.prepare('SELECT id FROM vehicle_current_trusted_assessments WHERE vehicle_id=?1').bind(s.vehicle.id).first(),null);
  assert.equal((await env.DB.prepare('SELECT count(*) n FROM vehicle_trusted_assessments WHERE vehicle_id=?1').bind(s.vehicle.id).first()).n,1);
  await assert.rejects(env.DB.prepare('DELETE FROM vehicle_trusted_assessments WHERE id=?1').bind(first.assessmentId).run());
  await env.DB.prepare("CREATE TRIGGER trusted_fixture_audit_failure BEFORE INSERT ON audit_events WHEN NEW.action='admin.vehicle_assessment_recorded' BEGIN SELECT RAISE(ABORT,'PRIVATE_TRUSTED_PROVIDER_ERROR'); END").run();
  await assert.rejects(s.capture({...s.body,expectedRevision:3},'trusted-audit-rollback'));
  assert.equal((await env.DB.prepare('SELECT revision FROM vehicles WHERE id=?1').bind(s.vehicle.id).first()).revision,3);
  assert.equal((await env.DB.prepare("SELECT count(*) n FROM mutation_idempotency WHERE operation='admin.vehicle_assessment.record'").first()).n,1);
  await env.DB.prepare('DROP TRIGGER trusted_fixture_audit_failure').run();
  const made=await send('POST','/v1/admin/vehicle-rules',{...ruleBody,make:'Li Auto',model:'L7',vehicleClass:'business',allowedBodyTypes:['crossover']},s.ownerToken,'trusted-native-li-rule');assert.equal(made.status,201);
  await env.DB.prepare("UPDATE vehicles SET make='Li Auto',model='L8',revision=revision+1 WHERE id=?1").bind(s.vehicle.id).run();
  const request={...s.body,expectedRevision:4,expectedInputRevision:2,expectedRuleVersion:null,mode:'exception',
    parameters:{...s.body.parameters,make:'Li Auto',model:'L8',bodyType:'crossover'},
    conditions:made.body.rule.conditions.map(c=>({conditionId:c.id,result:'satisfied'})),
    exception:{basisRuleVersion:made.body.rule.version,yearBelowMinimum:false,waivedConditionIds:[]}};
  const excluded=await s.capture(request,'trusted-native-actual-body',s.ownerToken);assert.equal(excluded.ok,true);assert.equal(excluded.classification.outcome,'excluded');
  const saved=await env.DB.prepare('SELECT * FROM vehicle_trusted_assessments WHERE id=?1').bind(excluded.assessmentId).first();
  const row={...saved,id:'assessment_native_forged_li',sequence:3,outcome:'candidate',class:'business',reason_codes_json:'[]',audit_event_id:'audit_native_li_forged'};
  await env.DB.prepare("INSERT INTO audit_events VALUES('audit_native_li_forged',?1,'admin.vehicle_assessment_recorded','vehicle',?2,'success',NULL,1)").bind(ownerId,s.vehicle.id).run();
  await assert.rejects(env.DB.prepare('INSERT INTO vehicle_trusted_assessments('+Object.keys(row).join(',')+') VALUES('+Object.keys(row).map((_,i)=>'?'+(i+1)).join(',')+')').bind(...Object.values(row)).run());
  return {trustedStorage:'PASS',ownerAndDispatcherAuthority:true,idempotentReplay:true,noAdmissionProjection:true,
    unrelatedEditPreservesTrust:true,evidenceChangeAndRestoreRemainsInvalid:true,historyImmutable:true,auditRollback:true,actualVehicleBodyGuard:true};
}
