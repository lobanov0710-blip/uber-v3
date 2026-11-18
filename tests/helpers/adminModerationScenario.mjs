// Synthetic fixtures shared by real SQLite HTTP and native local workerd/D1.
import assert from 'node:assert/strict';
import { hashStaffPassword } from '../../src/core/staffAuthCrypto.js';
export const moderator='staff_moderator123',driverId='staff_driver123',documentId='document_fixture001';
export const fixturePassword='Synthetic-Moderator-Password-123!';
export async function seedModeration(DB,{vehicleYear,vehicleColor}={}){
 const v=await hashStaffPassword(fixturePassword);
 for(const [id,role]of [[moderator,'admin'],[driverId,'driver']])await DB.prepare(`INSERT INTO staff_accounts
 (id,login,display_name,role,status,password_algorithm,password_iterations,password_salt,password_hash,password_changed_at,created_at,updated_at)
 VALUES(?1,?1,?1,?2,'active',?3,?4,?5,?6,1,1,1)`).bind(id,role,v.passwordAlgorithm,v.passwordIterations,v.passwordSalt,v.passwordHash).run();
 for(const permission of ['drivers.read','drivers.verify_documents','drivers.verify_identity','vehicles.verify'])await DB.prepare(
 'INSERT INTO staff_permissions(account_id,permission,granted_by,created_at) VALUES(?1,?2,?1,1)').bind(moderator,permission).run();
 await DB.prepare(`INSERT INTO driver_profiles(staff_account_id,normalized_phone,full_name,region,registration_status,identity_status,created_at,updated_at)
 VALUES(?1,'+79990000000','Synthetic Driver','Test Region','submitted','pending',1,1)`).bind(driverId).run();
 await DB.prepare(`INSERT INTO vehicles(id,driver_id,vin,plate,make,model,class,capacity,status,usage_basis,created_at,updated_at${vehicleYear===undefined?'':',model_year,color'})
 VALUES('vehicle_fixture001',?1,'TESTVIN0000000001','TEST','Test','Car','comfort',4,'pending_review','owner',1,1${vehicleYear===undefined?'':',?2,?3'})`).bind(...(vehicleYear===undefined?[driverId]:[driverId,vehicleYear,vehicleColor])).run();
 for(const [id,kind,status]of [[documentId,'passport_main','pending'],['document_fixture002','driver_license_front','verified']])await DB.prepare(
 `INSERT INTO document_resources(id,owner_driver_id,kind,private_object_key,status,created_at,updated_at) VALUES(?1,?2,?3,?1,?4,1,1)`)
 .bind(id,driverId,kind,status).run();
}
export async function moderationWorkflow(DB,send){
 const login=await send('/staff/login',{login:moderator,password:fixturePassword});assert.equal(login.status,200);const token=login.body.accessToken;assert.ok(token);
 const base='/v1/admin/registrations/'+driverId;
 for(const status of ['submitted','under_review','changes_required','approved','rejected'])assert.equal((await send('/v1/admin/registrations?status='+status,undefined,token)).status,200);
 const detail=await send(base,undefined,token);assert.equal(detail.status,200);assert.equal(detail.body.registration.profile.identityStatus,'pending');
 const start=()=>send(base+'/review',{expectedRevision:1},token,'fixture-start-review');
 assert.equal((await start()).status,200);assert.equal((await start()).status,200);
 const action={decision:'changes_required',expectedRevision:1,note:'Synthetic resubmission reason'};
 const itemPath=base+'/review/items/document/'+documentId;
 const changed=await send(itemPath,action,token,'fixture-document-review');assert.equal(changed.status,200);
 const auditCount=async()=>Number((await DB.prepare('SELECT COUNT(*) n FROM audit_events').first()).n);
 const n=await auditCount();assert.deepEqual((await send(itemPath,action,token,'fixture-document-review')).body.target,changed.body.target);assert.equal(await auditCount(),n);
 assert.equal((await send(itemPath,{...action,note:'Changed request'},token,'fixture-document-review')).status,409);
 assert.equal((await send(itemPath,{...action,decision:'rejected'},token,'fixture-stale-revision')).status,409);
 const card=(await send(base,undefined,token)).body.registration;
 assert.equal(card.documents.find(x=>x.id===documentId).status,'changes_required');
 assert.equal(card.documents.find(x=>x.id==='document_fixture002').status,'verified');
 assert.ok(card.reviews.some(x=>x.targetId===documentId&&x.note===action.note));
 const identity=await send(base+'/review/items/identity/'+driverId,{decision:'verified',expectedRevision:card.profile.revision},token,'fixture-identity-denied');
 assert.equal(identity.status,409);assert.equal(identity.body.code,'identity_verification_provider_not_approved');
 const approve=await send(base+'/review/complete',{decision:'approved',expectedRevision:card.profile.revision},token,'fixture-approval-denied');
 assert.equal(approve.status,409);assert.equal(approve.body.code,'identity_verification_required');
 const finalInput={decision:'changes_required',expectedRevision:card.profile.revision,note:'Synthetic final reason'};
 assert.equal((await send(base+'/review/complete',finalInput,token,'fixture-final-review')).status,200);
 const after=await auditCount();assert.equal((await send(base+'/review/complete',finalInput,token,'fixture-final-review')).status,200);assert.equal(await auditCount(),after);
 const final=await send(base,undefined,token);assert.equal(final.body.registration.profile.registrationStatus,'changes_required');
 assert.equal((await send(base+'/resources/document/'+documentId,undefined,token)).status,403);
 await DB.prepare("DELETE FROM staff_permissions WHERE account_id=?1 AND permission='drivers.verify_documents'").bind(moderator).run();
 assert.equal((await send(itemPath,action,token,'fixture-document-review')).status,403);
 assert.equal(await auditCount(),after);
 return {token,base,auditRows:after};
}
