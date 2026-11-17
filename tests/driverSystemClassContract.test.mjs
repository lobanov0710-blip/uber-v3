import test from 'node:test';
import assert from 'node:assert/strict';
import router from '../src/router.js';
import { sqliteD1 } from './helpers/sqliteD1.mjs';
import { seedModeration, driverId, fixturePassword, moderator } from './helpers/adminModerationScenario.mjs';
import { loginStaff } from '../src/core/staffAuthService.js';
import { patchDriverVehicle } from '../src/core/driverRegistrationService.js';
import { changeDriverAssignmentPhase } from '../src/core/driverTripOperationalService.js';
import { transitionOrderTerminal } from '../src/core/orderTerminalMutationService.js';
import { advanceDriverOrder } from '../src/core/orderRepository.js';
const body = { vin: 'XW8ZZZ61ZFG000001', plate: 'SYNTHETIC', make: 'Toyota', model: 'Camry',
  modelYear: 2020, color: 'Белый', capacity: 4, baggageCapacity: 'standard', usageBasis: 'owner' };
async function setup(t) {
  const DB = sqliteD1(); t.after(() => DB.sqlite.close()); await seedModeration(DB);
  const env = { DB, JWT_SECRET: 'synthetic-driver-class-contract-jwt-01234567890123456789' };
  const session = await loginStaff(env, { login: driverId, password: fixturePassword }); assert.equal(session.ok, true);
  const send = async (method, path, value) => {
    const response = await router(new Request('https://fixture.invalid'+path, { method,
      headers: { Authorization: 'Bearer '+session.accessToken, 'Content-Type': 'application/json' },
      ...(value ? { body: JSON.stringify(value) } : {}) }), env, {});
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    return { status: response.status, body: await response.json() };
  };
  return { DB, env, send };
}
async function create(send) {
  const result = await send('POST', '/v1/driver/vehicles', body);
  assert.equal(result.status, 201); return result.body.vehicle;
}
function approve(DB, id) {
  DB.sqlite.prepare("UPDATE vehicles SET class='comfort',status='approved' WHERE id=?").run(id);
}
function active(DB, id) {
  DB.sqlite.prepare("INSERT INTO driver_availability(driver_id,active_vehicle_id,state,revision,updated_at) VALUES(?,?,'on_line',1,1)").run(driverId,id);
  DB.sqlite.prepare("INSERT INTO orders(id,name,phone,route,trip_date,status,driver_id,created_at,updated_at) VALUES('order_class_change','Synthetic','+79990000000','Synthetic','2030-01-01','taken',?,1,1)").run(driverId);
  DB.sqlite.prepare("INSERT INTO order_assignments(id,order_id,driver_id,vehicle_id,state,assigned_by,reason,created_at,phase) VALUES('assignment_class_change','order_class_change',?,?,'active',?,'Synthetic',1,'en_route_to_pickup')").run(driverId,id,moderator);
}
const audits = DB => DB.sqlite.prepare("SELECT count(*) n FROM audit_events WHERE action='driver.vehicle_reverification_required'").get().n;

test('HTTP creation requires a numeric year and returns an unclassified draft', async t => {
  const { send } = await setup(t); const car = await create(send);
  assert.equal(car.modelYear, 2020); assert.equal(car.vehicleClass, null); assert.equal(car.status, 'draft');
  assert.equal(Object.hasOwn(car, 'yearVerified'), false);
  const me = await send('GET', '/v1/driver/me');
  assert.equal(me.body.vehicles.find(v => v.id===car.id).vehicleClass, null);
});
test('HTTP requires a nonblank textual body color on creation and editing',async t=>{
  const {DB,send}=await setup(t);const before=DB.sqlite.prepare('SELECT count(*) n FROM vehicles').get().n;
  const missing={...body};delete missing.color;
  assert.equal((await send('POST','/v1/driver/vehicles',missing)).status,400);
  for(const color of [null,'','  ','\u00a0',42,{},'x'.repeat(81),'Белый\nСерый']){
    assert.equal((await send('POST','/v1/driver/vehicles',{...body,color})).status,400);
  }
  assert.equal(DB.sqlite.prepare('SELECT count(*) n FROM vehicles').get().n,before);
  const car=await create(send);
  for(const color of [null,'','  ',42,{}])assert.equal((await send('PATCH','/v1/driver/vehicles/'+car.id,{color,expectedRevision:1})).status,400);
  assert.equal(DB.sqlite.prepare('SELECT revision FROM vehicles WHERE id=?').get(car.id).revision,1);
});
test('legacy missing color remains readable but must be filled before saving; sparse edits preserve valid color',async t=>{
  const {DB,send}=await setup(t);const car=await create(send);
  const sparse=await send('PATCH','/v1/driver/vehicles/'+car.id,{capacity:5,expectedRevision:1});
  assert.equal(sparse.status,200);assert.equal(sparse.body.vehicle.color,'Белый');
  DB.sqlite.prepare('UPDATE vehicles SET color=NULL WHERE id=?').run(car.id);
  const me=await send('GET','/v1/driver/me');assert.equal(me.status,200);
  assert.equal(me.body.vehicles.find(v=>v.id===car.id).color,null);
  assert.equal((await send('PATCH','/v1/driver/vehicles/'+car.id,{capacity:4,expectedRevision:2})).status,400);
  const fixed=await send('PATCH','/v1/driver/vehicles/'+car.id,{color:' Чёрный ',expectedRevision:2});
  assert.equal(fixed.status,200);assert.equal(fixed.body.vehicle.color,'Чёрный');
});
test('HTTP rejects driver-supplied class, verification flags, missing year and malformed year', async t => {
  const { send } = await setup(t);
  for (const patch of [{ vehicleClass: 'business' }, { yearVerified: true }, { modelYear: null },
    { modelYear: '2020' }, { modelYear: 0 }, { modelYear: 2020.5 }]) {
    assert.equal((await send('POST', '/v1/driver/vehicles', { ...body,...patch })).status, 400);
  }
  const missing = { ...body }; delete missing.modelYear;
  assert.equal((await send('POST', '/v1/driver/vehicles', missing)).status, 400);
  const car = await create(send);
  assert.equal((await send('PATCH','/v1/driver/vehicles/'+car.id,{ expectedRevision:1,vehicleClass:'business' })).status,400);
});
test('changing vehicle year atomically removes class and line admission and flags manual dispatcher reassignment', async t => {
  const { DB,env,send }=await setup(t);const car=await create(send);approve(DB,car.id);active(DB,car.id);
  const result=await send('PATCH','/v1/driver/vehicles/'+car.id,{modelYear:2021,expectedRevision:1});
  assert.equal(result.status,200);assert.equal(result.body.requiresDispatcherReassignment,true);
  assert.equal(result.body.vehicle.vehicleClass,null);assert.equal(result.body.vehicle.status,'pending_review');
  assert.equal(result.body.vehicle.modelYear,2021);assert.equal(audits(DB),1);
  assert.equal(DB.sqlite.prepare('SELECT state FROM driver_availability WHERE driver_id=?').get(driverId).state,'off_line');
  const phase=await changeDriverAssignmentPhase(env,{id:driverId,role:'driver'},'assignment_class_change',
    {phase:'arrived',expectedRevision:1},{idempotencyKey:'class-change-phase'});
  assert.equal(phase.ok,false);assert.equal(phase.status,409);
  assert.equal(DB.sqlite.prepare("SELECT phase FROM order_assignments WHERE id='assignment_class_change'").get().phase,'en_route_to_pickup');
  assert.equal(DB.sqlite.prepare("SELECT state FROM order_assignments WHERE id='assignment_class_change'").get().state,'active');
  assert.equal(DB.sqlite.prepare("SELECT status FROM orders WHERE id='order_class_change'").get().status,'taken');
});
test('make and model changes require review while unrelated edits preserve class',async t=>{
  const {DB,send}=await setup(t);const car=await create(send);approve(DB,car.id);
  const unrelated=await send('PATCH','/v1/driver/vehicles/'+car.id,{color:'Blue',expectedRevision:1});
  assert.equal(unrelated.status,200);assert.equal(unrelated.body.vehicle.vehicleClass,'comfort');assert.equal(audits(DB),0);
  const changed=await send('PATCH','/v1/driver/vehicles/'+car.id,{make:'Other',model:'Other',expectedRevision:2});
  assert.equal(changed.status,200);assert.equal(changed.body.vehicle.vehicleClass,null);assert.equal(changed.body.vehicle.status,'pending_review');
});
test('stale revision and foreign owner cannot clear another vehicle or change availability',async t=>{
  const {DB,env,send}=await setup(t);const car=await create(send);approve(DB,car.id);active(DB,car.id);
  assert.equal((await send('PATCH','/v1/driver/vehicles/'+car.id,{modelYear:2021,expectedRevision:99})).status,409);
  const foreign=await patchDriverVehicle(env,{id:'staff_otherdriver001',role:'driver'},car.id,{modelYear:2021,expectedRevision:1});
  assert.equal(foreign.status,404);assert.equal(audits(DB),0);
  assert.equal(DB.sqlite.prepare('SELECT state FROM driver_availability WHERE driver_id=?').get(driverId).state,'on_line');
});
test('audit failure rolls back classification invalidation and availability together without provider disclosure',async t=>{
  const {DB,send}=await setup(t);const car=await create(send);approve(DB,car.id);active(DB,car.id);
  DB.sqlite.exec("CREATE TRIGGER fail_classification_audit BEFORE INSERT ON audit_events WHEN NEW.action='driver.vehicle_reverification_required' BEGIN SELECT RAISE(ABORT,'PRIVATE_SQL_FIXTURE'); END");
  const result=await send('PATCH','/v1/driver/vehicles/'+car.id,{modelYear:2021,expectedRevision:1});
  assert.equal(result.status,500);assert.ok(!JSON.stringify(result.body).includes('PRIVATE_SQL_FIXTURE'));
  const row=DB.sqlite.prepare('SELECT class,model_year,revision FROM vehicles WHERE id=?').get(car.id);
  assert.equal(row.class,'comfort');assert.equal(row.model_year,2020);assert.equal(row.revision,1);
  assert.equal(DB.sqlite.prepare('SELECT state FROM driver_availability WHERE driver_id=?').get(driverId).state,'on_line');
});
test('account suspension after service read blocks the atomic update',async t=>{
  const {DB,env,send}=await setup(t);const car=await create(send);approve(DB,car.id);
  const batch=DB.batch.bind(DB);DB.batch=async statements=>{
    DB.sqlite.prepare("UPDATE staff_accounts SET status='suspended' WHERE id=?").run(driverId);return batch(statements);
  };
  const result=await patchDriverVehicle(env,{id:driverId,role:'driver'},car.id,{modelYear:2021,expectedRevision:1});
  assert.equal(result.ok,false);assert.equal(audits(DB),0);
  assert.equal(DB.sqlite.prepare('SELECT revision FROM vehicles WHERE id=?').get(car.id).revision,1);
});
test('a stopped assignment cannot be falsely completed through guarded or legacy order paths',async t=>{
  const {DB,env,send}=await setup(t);const car=await create(send);approve(DB,car.id);active(DB,car.id);
  DB.sqlite.exec("UPDATE orders SET status='in_progress' WHERE id='order_class_change'; UPDATE order_assignments SET phase='in_trip' WHERE id='assignment_class_change'");
  assert.equal((await send('PATCH','/v1/driver/vehicles/'+car.id,{modelYear:2021,expectedRevision:1})).status,200);
  const guarded=await transitionOrderTerminal(env,{id:driverId,role:'driver'},'order_class_change',
    {status:'done',expectedRevision:1},{idempotencyKey:'stopped-trip-complete'});
  assert.equal(guarded.ok,false);
  const legacy=await advanceDriverOrder(env,'order_class_change',driverId,'done',Date.now());
  assert.equal(legacy.ok,false);
  assert.equal(DB.sqlite.prepare("SELECT status FROM orders WHERE id='order_class_change'").get().status,'in_progress');
});
