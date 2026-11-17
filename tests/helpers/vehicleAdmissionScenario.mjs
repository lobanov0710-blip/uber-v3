import assert from 'node:assert/strict';
import { trustedScenario } from './trustedAssessmentScenario.mjs';
import { prepareVehicleApproval } from './atomicVehicleReviewScenario.mjs';
import { driverId } from './adminVehicleRuleScenario.mjs';
import { authenticateStaffRequest } from '../../src/core/staffAuthorization.js';
import { recordTrustedVehicleAssessment } from '../../src/core/trustedVehicleAssessmentRepository.js';
import { putDriverAvailability } from '../../src/core/driverAvailabilityService.js';
import { assignOrderByAdmin,reassignOrderByAdmin } from '../../src/core/orderAssignmentService.js';
import { changeDriverAssignmentPhase } from '../../src/core/driverTripOperationalService.js';
import { transitionOrderTerminal } from '../../src/core/orderTerminalMutationService.js';
import { advanceDriverOrder } from '../../src/core/orderRepository.js';
import { updateDriverAvailability } from '../../src/core/driverAvailabilityRepository.js';
import { assignOrderToDriverVehicle,reassignOrderToDriverVehicle } from '../../src/core/orderAssignmentRepository.js';
export async function admissionScenario(env,send){
 const s=await trustedScenario(env,send),expires=Date.now()+600000;
 await env.DB.prepare("UPDATE document_resources SET expires_at=?1 WHERE id IN ('document_trusted_front','document_trusted_back')").bind(expires).run();
 await prepareVehicleApproval(env,s.vehicle.id);assert.equal((await s.capture()).ok,true);
 const approve=async(id,revision,key)=>send('POST','/v1/admin/registrations/'+driverId+'/review/items/vehicle/'+id,{decision:'approved',expectedRevision:revision},s.ownerToken,key);
 assert.equal((await approve(s.vehicle.id,2,'admission-primary-approved')).status,200);
 const owner=await authenticateStaffRequest(new Request('https://fixture.invalid',{headers:{Authorization:'Bearer '+s.ownerToken}}),env);
 const driver=await authenticateStaffRequest(new Request('https://fixture.invalid',{headers:{Authorization:'Bearer '+s.driver}}),env);assert.equal(owner.ok,true);assert.equal(driver.ok,true);
 const create=await send('POST','/v1/driver/vehicles',{vin:'XW8ZZZ61ZFG000002',plate:'SYNTHETIC2',make:'Toyota',model:'Camry',modelYear:2023,color:'White',capacity:4,baggageCapacity:'standard',usageBasis:'owner'},s.driver);assert.equal(create.status,201);
 const second=create.body.vehicle.id,evidence=[];
 for(const[id,kind]of [['document_admission_second_front','sts_front'],['document_admission_second_back','sts_back']]){
  await env.DB.prepare("INSERT INTO document_resources(id,owner_driver_id,vehicle_id,kind,private_object_key,status,expires_at,created_at,updated_at) VALUES(?1,?2,?3,?4,?1,'verified',?5,1,1)").bind(id,driverId,second,kind,expires).run();evidence.push({documentId:id,expectedRevision:1});
 }
 await prepareVehicleApproval(env,second,'photo_admission_second_');
 assert.equal((await recordTrustedVehicleAssessment(env,owner.user,second,{...s.body,evidence},{idempotencyKey:'admission-secondary-proof',mfa:owner.mfa})).ok,true);
 assert.equal((await approve(second,2,'admission-secondary-approved')).status,200);
 // Synthetic pre-existing identity only; no liveness/provider endpoint is used.
 await env.DB.prepare("UPDATE driver_profiles SET registration_status='approved',identity_status='verified' WHERE staff_account_id=?1").bind(driverId).run();
 await env.DB.prepare("INSERT INTO driver_availability(driver_id,state,revision,updated_at) VALUES(?1,'off_line',1,1)").bind(driverId).run();
 const order=async(id,status='new')=>env.DB.prepare("INSERT INTO orders(id,name,phone,route,trip_date,status,driver_id,created_at,updated_at) VALUES(?1,'Synthetic','+79990000000','Synthetic','2030-01-01',?2,?3,1,1)").bind(id,status,status==='new'?null:driverId).run();
 return {...s,second,expires,owner:owner.user,driverUser:driver.user,order};
}
export async function admissionWorkflow(env,send){
 const s=await admissionScenario(env,send),time=s.expires+1,id='order_admission_workflow';await s.order(id);
 const options=await send('GET','/v1/admin/orders/'+id+'/assignment-options',undefined,s.ownerToken);assert.equal(options.status,200);const choices=options.body.options.filter(x=>[s.vehicle.id,s.second].includes(x.vehicleId));assert.equal(choices.length,2);assert.ok(choices.every(x=>x.eligible));
 const on=await send('PUT','/v1/driver/availability',{activeVehicleId:s.vehicle.id,requestedState:'on_line',expectedRevision:1},s.driver,'admission-online-positive');assert.equal(on.status,200);
 assert.equal((await send('PUT','/v1/driver/availability',{activeVehicleId:s.vehicle.id,requestedState:'off_line',expectedRevision:2},s.driver,'admission-offline-positive')).status,200);
 await env.DB.prepare("UPDATE vehicles SET status='approved',color='White' WHERE id='vehicle_fixture001'").run();
 const legacy=await send('PUT','/v1/driver/availability',{activeVehicleId:'vehicle_fixture001',requestedState:'on_line',expectedRevision:3},s.driver,'admission-native-legacy-no-proof');assert.equal(legacy.status,422);assert.equal(legacy.body.code,'vehicle_classification_required');
 const state=id=>env.DB.prepare('SELECT class,status,revision FROM vehicles WHERE id=?1').bind(id).first();const before=await state(s.vehicle.id),secondBefore=await state(s.second);
 const line=await putDriverAvailability(env,s.driverUser,{activeVehicleId:s.vehicle.id,requestedState:'on_line',expectedRevision:3},{nowMs:time,idempotencyKey:'admission-expired-line'});assert.equal(line.code,'vehicle_classification_required');
 const idem=operation=>({operation,keyDigest:operation.endsWith('reassign')?'S'.repeat(43):'A'.repeat(43),requestDigest:'R'.repeat(43),claimId:'claim_admission_direct_'+operation.replaceAll('.','_')});
 assert.equal((await updateDriverAvailability(env,{driverId,requestedState:'on_line',activeVehicleId:s.vehicle.id,expectedRevision:3,updatedAt:time,requestId:'req_admission_sql_line',auditId:'audit_admission_sql_line',idempotency:idem('driver.availability.update')})).kind,'conflict');
 const body={driverId,vehicleId:s.vehicle.id,expectedRevision:1,reason:'Synthetic assignment'};
 assert.equal((await assignOrderByAdmin(env,s.owner,id,body,{nowMs:time,idempotencyKey:'admission-expired-assign'})).code,'vehicle_classification_required');
 const direct={actorAccountId:s.owner.id,orderId:id,driverId,vehicleId:s.vehicle.id,reason:'Synthetic direct SQL guard',expectedRevision:1,assignedAt:time,assignmentId:'assignment_admission_denied',auditId:'audit_admission_denied',requestId:'req_admission_sql_assign',idempotency:idem('admin.order.assign')};
 assert.equal((await assignOrderToDriverVehicle(env,direct)).kind,'conflict');
 assert.equal((await send('POST','/v1/admin/orders/'+id+'/assign',body,s.ownerToken,'admission-valid-assign')).status,200);
 const other={...body,vehicleId:s.second,expectedRevision:2};
 assert.equal((await reassignOrderByAdmin(env,s.owner,id,other,{nowMs:time,idempotencyKey:'admission-expired-reassign'})).code,'vehicle_classification_required');
 assert.equal((await reassignOrderToDriverVehicle(env,{...direct,vehicleId:s.second,expectedRevision:2,assignmentId:'assignment_admission_reassign_denied',auditId:'audit_admission_reassign_denied',requestId:'req_admission_sql_reassign',idempotency:idem('admin.order.reassign')})).kind,'conflict');
 const reassigned=await send('POST','/v1/admin/orders/'+id+'/reassign',other,s.ownerToken,'admission-valid-reassign');assert.equal(reassigned.status,200);
 const active=await env.DB.prepare("SELECT id,revision FROM order_assignments WHERE order_id=?1 AND state='active' AND revoked_at IS NULL").bind(id).first();assert.ok(active);
 await env.DB.prepare("UPDATE order_assignments SET phase='en_route_to_pickup' WHERE id=?1").bind(active.id).run();
 assert.equal((await changeDriverAssignmentPhase(env,s.driverUser,active.id,{phase:'arrived',expectedRevision:active.revision},{idempotencyKey:'admission-valid-phase'})).ok,true);
 assert.equal((await changeDriverAssignmentPhase(env,s.driverUser,active.id,{phase:'in_trip',expectedRevision:active.revision+1},{nowMs:time,idempotencyKey:'admission-expired-phase'})).ok,false);
 // Simulate a trip started before expiry. No public API fabricates verification.
 await env.DB.prepare("UPDATE order_assignments SET phase='in_trip' WHERE id=?1").bind(active.id).run();
 await env.DB.prepare("UPDATE orders SET status='in_progress' WHERE id=?1").bind(id).run();
 const revision=(await env.DB.prepare('SELECT revision FROM orders WHERE id=?1').bind(id).first()).revision;
 assert.equal((await transitionOrderTerminal(env,s.driverUser,id,{status:'done',expectedRevision:revision},{nowMs:time,idempotencyKey:'admission-expired-done'})).ok,false);
 assert.equal((await advanceDriverOrder(env,id,driverId,'done',time)).ok,false);
 assert.deepEqual(await state(s.vehicle.id),before);assert.deepEqual(await state(s.second),secondBefore); // expiry itself made no row mutation
 assert.equal((await env.DB.prepare('SELECT count(*) n FROM vehicle_assessment_invalidations').first()).n,0);
 assert.equal((await env.DB.prepare("SELECT expires_at FROM document_resources WHERE id='document_trusted_front'").first()).expires_at,s.expires);
 const noAssignment='order_admission_no_assignment';await s.order(noAssignment,'in_progress');
 assert.equal((await transitionOrderTerminal(env,s.driverUser,noAssignment,{status:'done',expectedRevision:1},{idempotencyKey:'admission-no-assignment-done'})).ok,false);
 assert.equal((await advanceDriverOrder(env,noAssignment,driverId,'done',Date.now())).ok,false);
 const cancel=await transitionOrderTerminal(env,s.owner,id,{status:'canceled',expectedRevision:revision},{nowMs:time,idempotencyKey:'admission-expired-manual-cancel'});assert.equal(cancel.ok,true);
 const off=await putDriverAvailability(env,s.driverUser,{activeVehicleId:s.vehicle.id,requestedState:'off_line',expectedRevision:3},{nowMs:time,idempotencyKey:'admission-expired-offline'});assert.equal(off.ok,true);
 return {vehicleAdmission:'PASS',positiveLineAssignReassignPhase:true,expiryWithoutRowMutation:true,expiredLineAssignReassignPhaseDenied:true,
  bothDonePathsDenied:true,noAssignmentCannotComplete:true,manualCancelAndOfflinePreserved:true,directSqlGuards:true,legacyWithoutProofDenied:true};
}
