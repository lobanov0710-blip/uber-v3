import assert from 'node:assert/strict';
import { authenticateStaffRequest } from '../../src/core/staffAuthorization.js';
import { recordTrustedVehicleAssessment } from '../../src/core/trustedVehicleAssessmentRepository.js';
import { ruleOwnerLogin,ruleBody,moderator,driverId,fixturePassword } from './adminVehicleRuleScenario.mjs';
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
  return {trustedStorage:'PASS',ownerAndDispatcherAuthority:true,idempotentReplay:true,noAdmissionProjection:true,
    unrelatedEditPreservesTrust:true,evidenceChangeAndRestoreRemainsInvalid:true,historyImmutable:true,auditRollback:true};
}
