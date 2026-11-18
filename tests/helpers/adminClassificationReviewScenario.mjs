import assert from 'node:assert/strict';
import { trustedScenario } from './trustedAssessmentScenario.mjs';
import { prepareVehicleApproval } from './atomicVehicleReviewScenario.mjs';
import { driverId,moderator,ruleBody } from './adminVehicleRuleScenario.mjs';

export async function classificationReviewWorkflow(env,send){
  const s=await trustedScenario(env,send),path='/v1/admin/vehicles/'+s.vehicle.id+'/classification';
  assert.equal((await send('GET',path)).status,401);
  assert.equal((await send('GET',path,undefined,s.driver)).status,403);
  const initial=await send('GET',path,undefined,s.token);assert.equal(initial.status,200);
  assert.equal(initial.body.verifiedParameters,null);assert.deepEqual(initial.body.history,[]);
  const first=await send('POST',path+'/review',s.body,s.token,'classification-public-first');assert.equal(first.status,200);
  assert.equal(first.body.classification.vehicleClass,'comfort');assert.equal(first.body.assessmentId,undefined);
  const replay=await send('POST',path+'/review',s.body,s.token,'classification-public-first');assert.equal(replay.status,200);
  assert.equal(replay.body.vehicleRevision,first.body.vehicleRevision);
  assert.equal((await send('POST',path+'/review',s.body,s.token,'classification-stale-revision')).status,409);
  assert.equal((await send('POST',path+'/review',{...s.body,reason:'Changed'},s.token,'classification-public-first')).status,409);
  const current=await send('GET',path,undefined,s.token);assert.equal(current.status,200);
  assert.deepEqual(current.body.verifiedParameters,s.body.parameters);assert.deepEqual(current.body.evidence,s.body.evidence);
  assert.equal(current.body.history.length,1);assert.equal(current.body.classification.vehicleClass,'comfort');
  assert.equal((await env.DB.prepare('SELECT class FROM vehicles WHERE id=?1').bind(s.vehicle.id).first()).class,null);
  await prepareVehicleApproval(env,s.vehicle.id);
  const approval='/v1/admin/registrations/'+driverId+'/review/items/vehicle/'+s.vehicle.id;
  assert.equal((await send('POST',approval,{decision:'approved',expectedRevision:2},s.token,'classification-separate-approval')).status,200);
  // Synthetic pre-existing identity; this is not acceptance of a D4 provider.
  await env.DB.prepare("UPDATE driver_profiles SET registration_status='approved',identity_status='verified' WHERE staff_account_id=?1").bind(driverId).run();
  await env.DB.prepare("INSERT INTO driver_availability(driver_id,active_vehicle_id,state,revision,updated_at) VALUES(?1,?2,'on_line',1,1)").bind(driverId,s.vehicle.id).run();
  await env.DB.prepare("INSERT INTO orders(id,name,phone,route,trip_date,status,driver_id,created_at,updated_at) VALUES('order_public_review','Synthetic','+79990000000','Synthetic','2030-01-01','taken',?1,1,1)").bind(driverId).run();
  await env.DB.prepare("INSERT INTO order_assignments(id,order_id,driver_id,vehicle_id,state,assigned_by,reason,created_at,phase) VALUES('assignment_public_review','order_public_review',?1,?2,'active',?3,'Synthetic',1,'en_route_to_pickup')").bind(driverId,s.vehicle.id,moderator).run();
  const newer=await send('POST','/v1/admin/vehicle-rules',{...ruleBody,vehicleClass:'business',expectedCurrentVersion:s.rule.version},s.ownerToken,'classification-current-rule');assert.equal(newer.status,201);
  let body={...s.body,expectedRevision:3,expectedRuleVersion:newer.body.rule.version,parameters:{...s.body.parameters,modelYear:2024},
    conditions:newer.body.rule.conditions.map(c=>({conditionId:c.id,result:'satisfied'}))};
  const corrected=await send('POST',path+'/review',body,s.token,'classification-public-correction');assert.equal(corrected.status,200);
  assert.equal(corrected.body.inputRevision,2);assert.equal(corrected.body.classification.vehicleClass,'business');assert.equal(corrected.body.requiresDispatcherReassignment,true);
  const vehicle=await env.DB.prepare('SELECT class,status,model_year,revision FROM vehicles WHERE id=?1').bind(s.vehicle.id).first();
  assert.equal(vehicle.class,null);assert.equal(vehicle.status,'pending_review');assert.equal(vehicle.model_year,2024);
  assert.equal((await env.DB.prepare('SELECT state FROM driver_availability WHERE driver_id=?1').bind(driverId).first()).state,'off_line');
  assert.equal((await env.DB.prepare('SELECT count(*) n FROM vehicle_reverification_assignment_holds').first()).n,1);
  assert.equal((await env.DB.prepare("SELECT count(*) n FROM order_assignments WHERE order_id='order_public_review'").first()).n,1);
  assert.equal((await env.DB.prepare("SELECT status FROM orders WHERE id='order_public_review'").first()).status,'taken');
  body={...body,expectedRevision:corrected.body.vehicleRevision,expectedInputRevision:2};
  for(let i=0;i<49;i++){
    const r=await send('POST',path+'/review',body,s.token,'classification-history-'+i);assert.equal(r.status,200);
    body={...body,expectedRevision:r.body.vehicleRevision};
  }
  const page=await send('GET',path,undefined,s.token);assert.equal(page.status,200);assert.equal(page.body.history.length,50);assert.ok(page.body.nextHistoryCursor);
  assert.equal((await send('GET',path+'?historyCursor='+page.body.nextHistoryCursor,undefined,s.ownerToken)).status,400);
  assert.equal((await send('GET','/v1/admin/vehicles/vehicle_fixture001/classification?historyCursor='+page.body.nextHistoryCursor,undefined,s.token)).status,400);
  assert.equal(page.body.pinnedRuleVersion,newer.body.rule.version);assert.equal(page.body.classification.vehicleClass,'business');
  const next=await send('GET',path+'?historyCursor='+page.body.nextHistoryCursor,undefined,s.token);assert.equal(next.status,200);
  assert.equal(next.body.history.length,1);assert.equal(next.body.nextHistoryCursor,null);assert.equal(new Set([...page.body.history,...next.body.history].map(a=>a.assessmentId)).size,51);
  const serialized=JSON.stringify(page.body);
  for(const value of ['private_object_key','Synthetic verified parameters','XW8ZZZ61ZFG000001','SYNTHETIC','actor_account_id','ownerToken'])assert.ok(!serialized.includes(value));
  const beforeAudit=await env.DB.prepare("SELECT count(*) n FROM audit_events WHERE action='admin.vehicle_assessment_recorded'").first();
  await env.DB.prepare("CREATE TRIGGER public_review_audit_failure BEFORE INSERT ON audit_events WHEN NEW.action='admin.vehicle_assessment_recorded' BEGIN SELECT RAISE(ABORT,'PRIVATE_PUBLIC_REVIEW_SQL'); END").run();
  const failed=await send('POST',path+'/review',{...body,parameters:{...body.parameters,modelYear:2025}},s.token,'classification-public-rollback');assert.equal(failed.status,500);
  assert.ok(!JSON.stringify(failed.body).includes('PRIVATE_PUBLIC_REVIEW_SQL'));
  assert.equal((await env.DB.prepare('SELECT revision FROM vehicles WHERE id=?1').bind(s.vehicle.id).first()).revision,body.expectedRevision);
  assert.deepEqual(await env.DB.prepare("SELECT count(*) n FROM audit_events WHERE action='admin.vehicle_assessment_recorded'").first(),beforeAudit);
  await env.DB.prepare('DROP TRIGGER public_review_audit_failure').run();
  await env.DB.prepare("CREATE TRIGGER public_read_audit_failure BEFORE INSERT ON audit_events WHEN NEW.action='admin.vehicle_classification_read' BEGIN SELECT RAISE(ABORT,'PRIVATE_PUBLIC_READ_SQL'); END").run();
  const readFailed=await send('GET',path,undefined,s.token);assert.equal(readFailed.status,500);assert.equal(readFailed.body.history,undefined);
  assert.ok(!JSON.stringify(readFailed.body).includes('PRIVATE_PUBLIC_READ_SQL'));await env.DB.prepare('DROP TRIGGER public_read_audit_failure').run();
  await env.DB.prepare("UPDATE vehicles SET color='Black',revision=revision+1 WHERE id=?1").bind(s.vehicle.id).run();
  assert.equal((await send('GET',path+'?historyCursor='+page.body.nextHistoryCursor,undefined,s.token)).body.code,'classification_cursor_stale');
  await env.DB.prepare("UPDATE document_resources SET private_object_key='SyntheticChanged' WHERE id='document_trusted_front'").run();
  await env.DB.prepare("UPDATE document_resources SET private_object_key=id WHERE id='document_trusted_front'").run();
  const invalid=await send('GET',path,undefined,s.token);assert.equal(invalid.status,200);assert.equal(invalid.body.verifiedParameters,null);
  assert.equal(invalid.body.classification,null);assert.deepEqual(invalid.body.evidence,[]);assert.equal(invalid.body.history.length,50);
  return {classificationReviewApi:'PASS',actualStaffAndOwnerMfa:true,publicReviewAndReplay:true,explicitCorrectionUsesCurrentRule:true,
    noAutomaticApproval:true,offlineAndManualDispatcherHold:true,historyPagesNoDuplicates:true,cursorVehicleAndActorScope:true,staleCursorDenied:true,
    permanentInvalidationRead:true,readAndWriteAuditRollback:true,minimalPrivateProjection:true};
}
