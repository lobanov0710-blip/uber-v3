// Bundled Worker HTTP + real local D1; only synthetic users, no remote bindings.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { sqliteD1 } from '../tests/helpers/sqliteD1.mjs';
import { seedModeration, driverId, moderator, fixturePassword } from '../tests/helpers/adminModerationScenario.mjs';
import { changeDriverAssignmentPhase } from '../src/core/driverTripOperationalService.js';
const bundle = await build({ entryPoints: [new URL('../src/index.js',import.meta.url).pathname], bundle: true,
  write: false, format: 'esm', target: 'es2022', platform: 'browser' });
const local = sqliteD1(), mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name:'driver-class-contract', modules:true,
  script:bundle.outputFiles[0].text, bindings:{JWT_SECRET:'synthetic-driver-class-contract-jwt-01234567890123456789'},
  d1Databases:['DB'], compatibilityDate:'2026-08-20' }] }));
try {
  const DB=await mf.getD1Database('DB','driver-class-contract');
  for(const type of ['table','index','trigger'])for(const row of local.sqlite.prepare("SELECT sql FROM sqlite_master WHERE type=? AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all(type))await DB.prepare(row.sql).run();
  await seedModeration(DB);
  const send=async(method,path,body,token)=>{
    const response=await mf.dispatchFetch('https://fixture.invalid'+path,{method,
      headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});
    return {status:response.status,body:await response.json()};
  };
  const session=await send('POST','/staff/login',{login:driverId,password:fixturePassword});assert.equal(session.status,200);
  const token=session.body.accessToken,body={vin:'XW8ZZZ61ZFG000001',plate:'SYNTHETIC',make:'Toyota',model:'Camry',modelYear:2020,color:'Белый',capacity:4,baggageCapacity:'standard',usageBasis:'owner'};
  assert.equal((await send('POST','/v1/driver/vehicles',body)).status,401);
  assert.equal((await send('POST','/v1/driver/vehicles',{...body,vehicleClass:'business'},token)).status,400);
  const missingColor={...body};delete missingColor.color;
  assert.equal((await send('POST','/v1/driver/vehicles',missingColor,token)).status,400);
  for(const color of [null,'','  ',42])assert.equal((await send('POST','/v1/driver/vehicles',{...body,color},token)).status,400);
  const created=await send('POST','/v1/driver/vehicles',body,token);assert.equal(created.status,201);
  const car=created.body.vehicle;assert.equal(car.vehicleClass,null);assert.equal(car.modelYear,2020);
  assert.equal(car.color,'Белый');
  assert.equal((await send('PATCH','/v1/driver/vehicles/'+car.id,{color:' ',expectedRevision:1},token)).status,400);
  await DB.prepare("UPDATE vehicles SET class='comfort',status='approved' WHERE id=?1").bind(car.id).run();
  await DB.prepare("INSERT INTO driver_availability(driver_id,active_vehicle_id,state,revision,updated_at) VALUES(?1,?2,'on_line',1,1)").bind(driverId,car.id).run();
  await DB.prepare("INSERT INTO orders(id,name,phone,route,trip_date,status,driver_id,created_at,updated_at) VALUES('order_native_class','Synthetic','+79990000000','Synthetic','2030-01-01','taken',?1,1,1)").bind(driverId).run();
  await DB.prepare("INSERT INTO order_assignments(id,order_id,driver_id,vehicle_id,state,assigned_by,reason,created_at,phase) VALUES('assignment_native_class','order_native_class',?1,?2,'active',?3,'Synthetic',1,'en_route_to_pickup')").bind(driverId,car.id,moderator).run();
  const changed=await send('PATCH','/v1/driver/vehicles/'+car.id,{modelYear:2021,expectedRevision:1},token);
  assert.equal(changed.status,200);assert.equal(changed.body.vehicle.vehicleClass,null);assert.equal(changed.body.vehicle.status,'pending_review');
  assert.equal(changed.body.requiresDispatcherReassignment,true);
  assert.equal((await DB.prepare('SELECT state FROM driver_availability WHERE driver_id=?1').bind(driverId).first()).state,'off_line');
  assert.equal((await DB.prepare("SELECT count(*) n FROM audit_events WHERE action='driver.vehicle_reverification_required'").first()).n,1);
  const phase=await changeDriverAssignmentPhase({DB},{id:driverId,role:'driver'},'assignment_native_class',{phase:'arrived',expectedRevision:1},{idempotencyKey:'native-class-phase'});
  assert.equal(phase.ok,false);
  await DB.prepare("UPDATE vehicles SET class='comfort',status='approved' WHERE id=?1").bind(car.id).run();
  await DB.prepare("CREATE TRIGGER fail_contract_audit BEFORE INSERT ON audit_events WHEN NEW.action='driver.vehicle_reverification_required' BEGIN SELECT RAISE(ABORT,'PRIVATE_SQL_FIXTURE'); END").run();
  const failed=await send('PATCH','/v1/driver/vehicles/'+car.id,{modelYear:2022,expectedRevision:2},token);
  assert.equal(failed.status,500);assert.ok(!JSON.stringify(failed.body).includes('PRIVATE_SQL_FIXTURE'));
  const preserved=await DB.prepare('SELECT class,model_year,revision FROM vehicles WHERE id=?1').bind(car.id).first();
  assert.equal(preserved.class,'comfort');assert.equal(preserved.model_year,2021);assert.equal(preserved.revision,2);
  console.log(JSON.stringify({engine:'native local workerd HTTP/D1',driverSystemClassContract:'PASS',
    driverClassRejected:true,requiredColor:true,yearPersisted:true,activeVehicleInvalidated:true,lineDisabled:true,manualDispatcherFlag:true,auditRollback:true}));
} finally {local.sqlite.close();await mf.dispose();}
