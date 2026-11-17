import { seedAdmissionReferenceD1,seedAdmissionProofD1 } from './admissionFixture.mjs';
import assert from 'node:assert/strict';
import { seedModeration,moderator,fixturePassword,driverId } from './adminModerationScenario.mjs';
export const car='vehicle_fixture001',car2='vehicle_fixture002';
export async function seedVehicleReads(DB){
  await seedAdmissionReferenceD1(DB);
  await seedAdmissionReferenceD1(DB,'Test','Car2');
  await seedModeration(DB,{vehicleYear:2023,vehicleColor:'White'});
  await DB.prepare('DELETE FROM staff_permissions').run();
  for(const permission of ['vehicles.read','vehicles.verify'])await DB.prepare('INSERT INTO staff_permissions(account_id,permission,granted_by,created_at) VALUES(?1,?2,?1,1)').bind(moderator,permission).run();
  await DB.prepare("UPDATE vehicles SET status='approved'").run();
  await DB.prepare(`INSERT INTO vehicles(id,driver_id,vin,plate,make,model,class,capacity,status,model_year,color,created_at,updated_at)
    VALUES(?1,?2,'TESTVIN0000000002','TEST2','Test','Car2','comfort',4,'approved',2023,'White',1,1)`).bind(car2,driverId).run();
  await seedAdmissionProofD1(DB,car);await seedAdmissionProofD1(DB,car2);
}
export function minimal(value){for(const secret of ['TESTVIN','+79990000000','Synthetic Driver','PRIVATE_REASON','private_object_key','photos','reviewedBy','reason'])assert.ok(!JSON.stringify(value).includes(secret),secret);}
export async function vehicleReadWorkflow(DB,send){
  const login=await send('/staff/login',null,{login:moderator,password:fixturePassword});assert.equal(login.status,200);const token=login.body.accessToken;
  const list='/v1/admin/vehicles',checks=list+'/'+car+'/photo-checks';
  assert.equal((await send(list)).status,401);assert.equal((await send(checks)).status,401);
  const first=await send(list+'?limit=1',token);assert.equal(first.status,200);assert.equal(first.body.vehicles[0].id,car);assert.ok(first.body.nextCursor);minimal(first.body);
  assert.deepEqual(Object.keys(first.body.vehicles[0]).sort(),['id','driverId','make','model','plate','status','revision','lastPhotoCheckPassedAt','nextPhotoCheckDueAt'].sort());
  const next=await send(list+'?limit=1&cursor='+first.body.nextCursor,token);assert.equal(next.body.vehicles[0].id,car2);assert.equal(next.body.nextCursor,null);
  assert.equal((await send(list+'?status=draft',token)).body.vehicles.length,0);
  const before=await send(checks,token);assert.equal(before.status,200);assert.equal(before.body.vehicleRevision,1);assert.deepEqual(before.body.checks,[]);
  assert.equal((await send(checks+'?cursor='+first.body.nextCursor,token)).status,400);
  let revision=1;
  for(let n=0;n<2;n++){
    const ack=await send(checks,token,{kind:'manual',reason:'PRIVATE_REASON',restrictionMode:n?'immediate':'after_current_trip',expectedRevision:revision},'synthetic-photo-read-'+n);
    assert.equal(ack.status,201);revision=ack.body.photoCheck.vehicleRevision;
  }
  const page=await send(checks+'?limit=1',token);assert.equal(page.status,200);assert.equal(page.body.vehicleRevision,3);assert.equal(page.body.checks.length,1);assert.ok(page.body.nextCursor);minimal(page.body);
  assert.deepEqual(Object.keys(page.body.checks[0]).sort(),['id','vehicleId','kind','restrictionMode','result','revision','dueAt','graceUntil','createdAt','updatedAt'].sort());
  const rest=await send(checks+'?limit=1&cursor='+page.body.nextCursor,token);assert.equal(rest.body.checks.length,1);assert.equal(rest.body.nextCursor,null);assert.notEqual(page.body.checks[0].id,rest.body.checks[0].id);
  assert.equal((await send(list+'/'+car2+'/photo-checks?cursor='+page.body.nextCursor,token)).status,400);
  assert.equal((await send(list+'?status=approved&cursor='+first.body.nextCursor,token)).status,400);
  await DB.prepare("DELETE FROM staff_permissions WHERE account_id=?1 AND permission='vehicles.verify'").bind(moderator).run();
  assert.equal((await send(checks,token)).status,403);assert.equal((await send(list,token)).status,200);
  await DB.prepare("DELETE FROM staff_permissions WHERE account_id=?1 AND permission='vehicles.read'").bind(moderator).run();
  assert.equal((await send(list,token)).status,403);
  const audits=await DB.prepare("SELECT action,target_type,target_id,request_id FROM audit_events WHERE action IN ('admin.vehicles_read','admin.vehicle_photo_checks_read')").all();
  assert.ok(audits.results.length>=6);minimal(audits.results);assert.ok(audits.results.every(r=>r.target_type==='vehicle'&&/^req_/.test(r.request_id)));
  return {token,auditRows:audits.results.length};
}
