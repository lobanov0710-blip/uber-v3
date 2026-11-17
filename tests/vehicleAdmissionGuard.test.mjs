import test from 'node:test';
import assert from 'node:assert/strict';
import router from '../src/router.js';
import { sqliteD1 } from './helpers/sqliteD1.mjs';
import { seedRuleActors,ruleSecrets,driverId,ruleBody } from './helpers/adminVehicleRuleScenario.mjs';
import { admissionScenario,admissionWorkflow } from './helpers/vehicleAdmissionScenario.mjs';
import { putDriverAvailability } from '../src/core/driverAvailabilityService.js';
import { assignOrderByAdmin } from '../src/core/orderAssignmentService.js';
import { updateDriverAvailability } from '../src/core/driverAvailabilityRepository.js';
async function setup(t){
 const DB=sqliteD1();t.after(()=>DB.sqlite.close());await seedRuleActors(DB);const env={DB,...ruleSecrets};
 const send=async(method,path,body,token,key)=>{const r=await router(new Request('https://fixture.invalid'+path,{method,
  headers:{'Content-Type':'application/json','CF-Connecting-IP':'203.0.113.10',...(token?{Authorization:'Bearer '+token}:{}),...(key?{'Idempotency-Key':key}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})}),env,{});
  assert.equal(r.headers.get('Cache-Control'),'no-store');return {status:r.status,body:await r.json()};};return {DB,env,send};
}
test('shared guard covers positive flow and expiry without mutations in line/assign/reassign/phase/both done paths',async t=>{
 const {env,send}=await setup(t);await admissionWorkflow(env,send);
});
test('approved legacy class with no proof or no verified year is ineligible in real HTTP and advisory results',async t=>{
 const {DB,env,send}=await setup(t),s=await admissionScenario(env,send);await s.order('order_admission_legacy');
 DB.sqlite.exec("UPDATE vehicles SET status='approved',color='White' WHERE id='vehicle_fixture001'");
 const legacy='vehicle_fixture001';
 for(const year of [null,2023]){
  DB.sqlite.prepare('UPDATE vehicles SET model_year=? WHERE id=?').run(year,legacy);
  const r=await send('PUT','/v1/driver/availability',{activeVehicleId:legacy,requestedState:'on_line',expectedRevision:1},s.driver,'admission-legacy-line-'+year);assert.equal(r.status,422);assert.equal(r.body.code,'vehicle_classification_required');
  assert.equal((await assignOrderByAdmin(env,s.owner,'order_admission_legacy',{driverId,vehicleId:legacy,expectedRevision:1,reason:'Synthetic'},{idempotencyKey:'admission-legacy-assign-'+year})).code,'vehicle_classification_required');
 }
 const options=await send('GET','/v1/admin/orders/order_admission_legacy/assignment-options',undefined,s.ownerToken),legacyRow=options.body.options.find(r=>r.vehicleId===legacy);
 assert.equal(legacyRow.eligible,false);assert.ok(legacyRow.blockers.includes('vehicle_classification_required'));
});
test('a forged projection class or empty legacy color cannot substitute for the current assessment',async t=>{
 const {DB,env,send}=await setup(t),s=await admissionScenario(env,send);
 for(const values of [{class:'business',color:'White'},{class:'comfort',color:null},{class:'comfort',color:' '}]){
  DB.sqlite.prepare('UPDATE vehicles SET class=?,color=? WHERE id=?').run(values.class,values.color,s.vehicle.id);
  assert.equal((await putDriverAvailability(env,s.driverUser,{activeVehicleId:s.vehicle.id,requestedState:'on_line',expectedRevision:1},{idempotencyKey:'admission-forged-'+crypto.randomUUID()})).code,'vehicle_classification_required');
 }
});
test('evidence expiry equality is closed while unrelated revision/color and a new head preserve the pin',async t=>{
 const {DB,env,send}=await setup(t),s=await admissionScenario(env,send);
 DB.sqlite.prepare("UPDATE vehicles SET color='Black',revision=revision+1 WHERE id=?").run(s.vehicle.id);
 assert.equal((await send('POST','/v1/admin/vehicle-rules',{...ruleBody,minYear:2024,vehicleClass:'business',expectedCurrentVersion:s.rule.version},s.ownerToken,'admission-new-head')).status,201);
 const r=await putDriverAvailability(env,s.driverUser,{activeVehicleId:s.vehicle.id,requestedState:'on_line',expectedRevision:1},{nowMs:s.expires,idempotencyKey:'admission-exact-expiry'});assert.equal(r.code,'vehicle_classification_required');
 const nowValid=await putDriverAvailability(env,s.driverUser,{activeVehicleId:s.vehicle.id,requestedState:'on_line',expectedRevision:1},{nowMs:s.expires-1,idempotencyKey:'admission-before-expiry'});assert.equal(nowValid.ok,true);
});
test('SQL denies proof loss after the precheck without committing line state or success audit',async t=>{
 const {DB,env,send}=await setup(t),s=await admissionScenario(env,send),batch=DB.batch.bind(DB);let once=false;
 DB.batch=async statements=>{if(!once){once=true;DB.sqlite.exec("UPDATE document_resources SET status='rejected' WHERE id='document_trusted_front'");}return batch(statements);};
 const r=await putDriverAvailability(env,s.driverUser,{activeVehicleId:s.vehicle.id,requestedState:'on_line',expectedRevision:1},{idempotencyKey:'admission-late-proof-loss'});assert.equal(r.ok,false);
 assert.equal(DB.sqlite.prepare('SELECT state FROM driver_availability WHERE driver_id=?').get(driverId).state,'off_line');
 assert.equal(DB.sqlite.prepare("SELECT count(*) n FROM audit_events WHERE action='driver.availability_updated'").get().n,0);
});
test('direct availability repository call has the same expiry guard as the service',async t=>{
 const {DB,env,send}=await setup(t),s=await admissionScenario(env,send);
 const r=await updateDriverAvailability(env,{driverId,requestedState:'on_line',activeVehicleId:s.vehicle.id,expectedRevision:1,updatedAt:s.expires+1,requestId:'req_admission_direct',auditId:'audit_admission_direct',
  idempotency:{operation:'driver.availability.update',keyDigest:'D'.repeat(43),requestDigest:'R'.repeat(43),claimId:'claim_admission_direct'}});
 assert.equal(r.kind,'conflict');assert.equal(DB.sqlite.prepare('SELECT state FROM driver_availability WHERE driver_id=?').get(driverId).state,'off_line');
});
test('a newer excluded or manual result cannot be bypassed by restoring a legacy approved projection',async t=>{
 for(const mode of ['excluded','manual_review']){
  const {DB,env,send}=await setup(t),s=await admissionScenario(env,send);
  const parameters={...s.body.parameters,...(mode==='excluded'?{powertrain:'battery_electric'}:{modelYear:2019})};
  const r=await s.capture({...s.body,expectedRevision:3,parameters},'admission-newer-'+mode);assert.equal(r.ok,true);assert.equal(r.classification.outcome,mode);
  DB.sqlite.prepare("UPDATE vehicles SET class='comfort',status='approved' WHERE id=?").run(s.vehicle.id);
  assert.equal((await putDriverAvailability(env,s.driverUser,{activeVehicleId:s.vehicle.id,requestedState:'on_line',expectedRevision:1},{idempotencyKey:'admission-stale-projection-'+mode})).code,'vehicle_classification_required');
 }
});
test('SQL reevaluates time-only expiry between candidate precheck and assign, with no evidence mutation',async t=>{
 const {DB,env,send}=await setup(t),s=await admissionScenario(env,send);await s.order('order_admission_clock_race');
 let clock=Date.now();DB.sqlite.function('julianday',_now=>clock/86400000+2440587.5);
 const batch=DB.batch.bind(DB);DB.batch=async statements=>{clock=s.expires+1000;return batch(statements);};
 const r=await assignOrderByAdmin(env,s.owner,'order_admission_clock_race',{driverId,vehicleId:s.vehicle.id,expectedRevision:1,reason:'Synthetic'},{idempotencyKey:'admission-clock-race'});assert.equal(r.ok,false);assert.equal(r.status,409);
 assert.equal(DB.sqlite.prepare('SELECT count(*) n FROM vehicle_assessment_invalidations').get().n,0);
 assert.equal(DB.sqlite.prepare('SELECT class,status FROM vehicles WHERE id=?').get(s.vehicle.id).status,'approved');
 assert.equal(DB.sqlite.prepare("SELECT count(*) n FROM order_assignments WHERE order_id='order_admission_clock_race'").get().n,0);
});
test('old0019 candidate and its verification flag do not replace a trusted assessment',async t=>{
 const {DB,env,send}=await setup(t),s=await admissionScenario(env,send),legacy='vehicle_fixture001';
 DB.sqlite.prepare("UPDATE vehicles SET make='Toyota',model='Camry',model_year=2023,color='White',class='comfort',status='approved' WHERE id=?").run(legacy);
 const {captureCurrentVehicleClassification}=await import('../src/core/vehicleClassificationRepository.js');
 const old=await captureCurrentVehicleClassification(env,{vehicleId:legacy,expectedVehicleRevision:1,year:2023,powertrain:'hybrid',powertrainVerified:true,now:Date.now()});assert.equal(old.outcome,'candidate');
 assert.equal((await putDriverAvailability(env,s.driverUser,{activeVehicleId:legacy,requestedState:'on_line',expectedRevision:1},{idempotencyKey:'admission-old-snapshot-denied'})).code,'vehicle_classification_required');
});
