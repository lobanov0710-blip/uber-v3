import assert from 'node:assert/strict';
import { trustedScenario } from './trustedAssessmentScenario.mjs';
import { driverId,moderator,ruleBody } from './adminVehicleRuleScenario.mjs';
import { changeDriverAssignmentPhase } from '../../src/core/driverTripOperationalService.js';
import { transitionOrderTerminal } from '../../src/core/orderTerminalMutationService.js';
import { advanceDriverOrder } from '../../src/core/orderRepository.js';
export async function prepareVehicleApproval(env,vehicleId,photoPrefix='photo_atomic_'){
  await env.DB.prepare("UPDATE driver_profiles SET registration_status='under_review' WHERE staff_account_id=?1").bind(driverId).run();
  await env.DB.prepare("UPDATE vehicles SET status='pending_review' WHERE id=?1").bind(vehicleId).run();
  for(const kind of ['left','front','right','rear','open_trunk','rear_cabin','front_cabin'])await env.DB.prepare(
    "INSERT INTO vehicle_photos(id,vehicle_id,kind,private_object_key,status,created_at,updated_at) VALUES(?1,?2,?3,?1,'verified',1,1)")
    .bind(photoPrefix+kind,vehicleId,kind).run();
}
export async function atomicVehicleReviewWorkflow(env,send){
  const s=await trustedScenario(env,send),path='/v1/admin/registrations/'+driverId+'/review/items/vehicle/'+s.vehicle.id;
  await prepareVehicleApproval(env,s.vehicle.id);
  // All legacy prerequisites are present. A stale Admin cannot invent a class.
  const denied=await send('POST',path,{decision:'approved',expectedRevision:1},s.token,'atomic-legacy-no-proof');assert.equal(denied.status,409);
  await env.DB.prepare("CREATE TRIGGER atomic_fixture_audit_failure BEFORE INSERT ON audit_events WHEN NEW.action='admin.vehicle_assessment_recorded' BEGIN SELECT RAISE(ABORT,'PRIVATE_ATOMIC_PROVIDER_ERROR'); END").run();
  await assert.rejects(s.capture({...s.body,parameters:{...s.body.parameters,modelYear:2024}},'atomic-native-rollback'));
  const rolledBack=await env.DB.prepare('SELECT model_year,revision FROM vehicles WHERE id=?1').bind(s.vehicle.id).first();assert.equal(rolledBack.model_year,2023);assert.equal(rolledBack.revision,1);
  assert.equal((await env.DB.prepare('SELECT count(*) n FROM vehicle_classification_bindings WHERE vehicle_id=?1').bind(s.vehicle.id).first()).n,1);
  await env.DB.prepare('DROP TRIGGER atomic_fixture_audit_failure').run();
  assert.equal((await s.capture()).ok,true);
  const approved=await send('POST',path,{decision:'approved',expectedRevision:2},s.token,'atomic-first-approval');assert.equal(approved.status,200);
  assert.equal((await env.DB.prepare('SELECT class,status,revision FROM vehicles WHERE id=?1').bind(s.vehicle.id).first()).class,'comfort');
  await env.DB.prepare("UPDATE driver_profiles SET registration_status='approved',identity_status='verified' WHERE staff_account_id=?1").bind(driverId).run();
  await env.DB.prepare("INSERT INTO driver_availability(driver_id,active_vehicle_id,state,revision,updated_at) VALUES(?1,?2,'on_line',1,1)").bind(driverId,s.vehicle.id).run();
  await env.DB.prepare("INSERT INTO orders(id,name,phone,route,trip_date,status,driver_id,created_at,updated_at) VALUES('order_atomic_review','Synthetic','+79990000000','Synthetic','2030-01-01','taken',?1,1,1)").bind(driverId).run();
  await env.DB.prepare("INSERT INTO order_assignments(id,order_id,driver_id,vehicle_id,state,assigned_by,reason,created_at,phase) VALUES('assignment_atomic_review','order_atomic_review',?1,?2,'active',?3,'Synthetic',1,'en_route_to_pickup')").bind(driverId,s.vehicle.id,moderator).run();
  const newer=await send('POST','/v1/admin/vehicle-rules',{...ruleBody,minYear:2022,vehicleClass:'business',expectedCurrentVersion:s.rule.version},s.ownerToken,'atomic-new-rule');assert.equal(newer.status,201);
  const input={...s.body,expectedRevision:3,expectedRuleVersion:newer.body.rule.version,parameters:{...s.body.parameters,modelYear:2024},
    conditions:newer.body.rule.conditions.map(c=>({conditionId:c.id,result:'satisfied'}))};
  const corrected=await s.capture(input,'atomic-key-correction');assert.equal(corrected.ok,true);assert.equal(corrected.inputRevision,2);
  assert.equal(corrected.classification.vehicleClass,'business');assert.equal(corrected.requiresDispatcherReassignment,true);
  const vehicle=await env.DB.prepare('SELECT class,status,revision,model_year FROM vehicles WHERE id=?1').bind(s.vehicle.id).first();
  assert.equal(vehicle.class,null);assert.equal(vehicle.status,'pending_review');assert.equal(vehicle.model_year,2024);assert.equal(vehicle.revision,4);
  assert.equal((await env.DB.prepare('SELECT state FROM driver_availability WHERE driver_id=?1').bind(driverId).first()).state,'off_line');
  const history=(await env.DB.prepare('SELECT model_year,rule_version FROM vehicle_classification_bindings WHERE vehicle_id=?1 ORDER BY input_revision').bind(s.vehicle.id).all()).results;
  assert.equal(history.length,2);assert.equal(history[0].model_year,2023);assert.equal(history[0].rule_version,s.rule.version);assert.equal(history[1].rule_version,newer.body.rule.version);
  // Reapproval restores only the car. The old trip remains held permanently.
  await env.DB.prepare("UPDATE driver_profiles SET registration_status='under_review' WHERE staff_account_id=?1").bind(driverId).run();
  assert.equal((await send('POST',path,{decision:'approved',expectedRevision:4},s.token,'atomic-reapproval')).status,200);
  const reapproved=await env.DB.prepare('SELECT class,status FROM vehicles WHERE id=?1').bind(s.vehicle.id).first();assert.equal(reapproved.class,'business');assert.equal(reapproved.status,'approved');
  await env.DB.prepare("UPDATE driver_profiles SET registration_status='approved' WHERE staff_account_id=?1").bind(driverId).run();
  const line=await send('PUT','/v1/driver/availability',{activeVehicleId:s.vehicle.id,requestedState:'on_line',expectedRevision:2},s.driver,'atomic-held-line');assert.equal(line.status,422);assert.equal(line.body.code,'vehicle_reverification_required');
  const phase=await changeDriverAssignmentPhase(env,{id:driverId,role:'driver'},'assignment_atomic_review',{phase:'arrived',expectedRevision:1},{idempotencyKey:'atomic-held-phase'});assert.equal(phase.ok,false);
  await env.DB.prepare("UPDATE orders SET status='in_progress' WHERE id='order_atomic_review'").run();
  await env.DB.prepare("UPDATE order_assignments SET phase='in_trip' WHERE id='assignment_atomic_review'").run();
  const terminal=await transitionOrderTerminal(env,{id:driverId,role:'driver'},'order_atomic_review',{status:'done',expectedRevision:1},{idempotencyKey:'atomic-held-done'});assert.equal(terminal.ok,false);
  assert.equal((await advanceDriverOrder(env,'order_atomic_review',driverId,'done',Date.now())).ok,false);
  assert.equal((await env.DB.prepare("SELECT status FROM orders WHERE id='order_atomic_review'").first()).status,'in_progress');
  assert.equal((await env.DB.prepare("SELECT count(*) n FROM order_assignments WHERE order_id='order_atomic_review'").first()).n,1);
  await assert.rejects(env.DB.prepare("DELETE FROM vehicle_reverification_assignment_holds WHERE assignment_id='assignment_atomic_review'").run());
  const newEvidence=[];
  for(const[id,kind]of [['document_atomic_new_front','sts_front'],['document_atomic_new_back','sts_back']]){
    await env.DB.prepare("INSERT INTO document_resources(id,owner_driver_id,vehicle_id,kind,private_object_key,status,created_at,updated_at) VALUES(?1,?2,?3,?4,?1,'verified',1,1)").bind(id,driverId,s.vehicle.id,kind).run();
    newEvidence.push({documentId:id,expectedRevision:1});
  }
  const newProof=await s.capture({...input,expectedRevision:5,expectedInputRevision:2,evidence:newEvidence},'atomic-new-selected-evidence');assert.equal(newProof.ok,true);
  await env.DB.prepare("UPDATE driver_profiles SET registration_status='under_review' WHERE staff_account_id=?1").bind(driverId).run();
  assert.equal((await send('POST',path,{decision:'approved',expectedRevision:6},s.token,'atomic-approval-new-documents')).status,200);
  await env.DB.prepare("UPDATE document_resources SET private_object_key='ObsoleteSyntheticChanged' WHERE id='document_trusted_front'").run();
  const stable=await env.DB.prepare('SELECT status,class,revision FROM vehicles WHERE id=?1').bind(s.vehicle.id).first();assert.equal(stable.status,'approved');assert.equal(stable.class,'business');assert.equal(stable.revision,7);
  return {atomicVehicleReview:'PASS',legacyApprovalBypassDenied:true,serverClassOnApproval:true,correctionUsesCurrentRule:true,
    bindingHistoryPreserved:true,offline:true,reapprovalDoesNotReleaseTrip:true,lineAndPhaseBlocked:true,bothDonePathsBlocked:true,noAutomaticReplacement:true,atomicCorrectionAuditRollback:true,obsoleteEvidenceIsolation:true};
}
