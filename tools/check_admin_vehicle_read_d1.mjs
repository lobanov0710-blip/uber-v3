// Bundled Worker + native local D1, synthetic data only; no deployment or remote bindings.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { sqliteD1 } from '../tests/helpers/sqliteD1.mjs';
import { changeDriverAssignmentPhase } from '../src/core/driverTripOperationalService.js';
import { moderator,driverId } from '../tests/helpers/adminModerationScenario.mjs';
import { seedVehicleReads,vehicleReadWorkflow } from '../tests/helpers/adminVehicleReadScenario.mjs';
const bundle=await build({entryPoints:[new URL('../src/index.js',import.meta.url).pathname],bundle:true,write:false,format:'esm',target:'es2022',platform:'browser'});
const local=sqliteD1(),mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'assignment-read-audit',modules:true,script:bundle.outputFiles[0].text,bindings:{JWT_SECRET:'synthetic-assignment-worker-jwt-01234567890123456789'},d1Databases:['DB'],compatibilityDate:'2026-08-20'}]}));
try {
  const DB=await mf.getD1Database('DB','assignment-read-audit');
  for(const row of local.sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all())await DB.prepare(row.sql).run();
  for(const row of local.sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL").all())await DB.prepare(row.sql).run();
  for (const type of ['view','trigger']) for (const row of local.sqlite.prepare("SELECT sql FROM sqlite_master WHERE type=? AND sql IS NOT NULL ORDER BY rowid").all(type)) await DB.prepare(row.sql).run();
  await seedVehicleReads(DB);
  const send=async(path,token,body,key)=>{
    const response=await mf.dispatchFetch('https://fixture.invalid'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...(key?{'Idempotency-Key':key}:{})},...(body?{body:JSON.stringify(body)}:{})});
    assert.equal(response.headers.get('Cache-Control'),'no-store');return {status:response.status,body:await response.json()};
  };
  for(const mode of ['after_current_trip','immediate']) {
    await DB.prepare("INSERT INTO orders(id,name,phone,route,trip_date,status,driver_id,created_at,updated_at) VALUES('order_native_photo_phase','Test','+79990000000','Test','2030-01-01','taken',?1,1,1)").bind(driverId).run();
    await DB.prepare("INSERT INTO order_assignments(id,order_id,driver_id,vehicle_id,state,assigned_by,reason,created_at,phase) VALUES('assignment_native_photo_phase','order_native_photo_phase',?1,'vehicle_fixture001','active',?2,'Synthetic',1,'en_route_to_pickup')").bind(driverId,moderator).run();
    await DB.prepare("INSERT INTO vehicle_photo_checks(id,vehicle_id,kind,reason,due_at,grace_until,result,created_at,updated_at,restriction_mode) VALUES('photo-check_native_phase','vehicle_fixture001','manual','Synthetic',1,1,'pending',1,1,?1)").bind(mode).run();
    const phase=await changeDriverAssignmentPhase({DB},{id:driverId,role:'driver'},'assignment_native_photo_phase',{phase:'arrived',expectedRevision:1},{idempotencyKey:'native-phase-'+mode});
    assert.equal(phase.ok,mode==='after_current_trip');
    await DB.prepare("DELETE FROM vehicle_photo_checks WHERE id='photo-check_native_phase'").run();
    await DB.prepare("DELETE FROM order_assignments WHERE id='assignment_native_photo_phase'").run();
    await DB.prepare("DELETE FROM orders WHERE id='order_native_photo_phase'").run();
  }
  const result=await vehicleReadWorkflow(DB,send);
  console.log(JSON.stringify({engine:'local workerd HTTP/D1',vehicleReadWorkflow:'PASS',auditRows:result.auditRows,privateProjectionAbsent:true,scopedPagination:true,currentPermissionRevocation:true}));
} finally { local.sqlite.close();await mf.dispose(); }
