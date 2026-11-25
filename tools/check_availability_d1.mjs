// Offline local workerd/D1 regression. Uses only synthetic fixtures and ephemeral storage.
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { fixture, driver, vehicle, time } from '../tests/helpers/driverPlatformFixture.mjs';
import { updateDriverAvailability } from '../src/core/driverAvailabilityRepository.js';
const local = fixture({after() {}});
const mf = new Miniflare(convertV4MiniflareOptions({workers:[{name:'audit',modules:true,script:'export default {fetch(){return new Response("ok")}}',d1Databases:['DB'],compatibilityDate:'2026-08-20'}]}));
try {
 const DB = await mf.getD1Database('DB', 'audit');
 const tables = local.sqlite.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all();
 for (const table of tables) await DB.prepare(table.sql).run();
 for (const index of local.sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL").all()) await DB.prepare(index.sql).run();
 for (const table of tables) {
  for (const row of local.sqlite.prepare('SELECT * FROM '+table.name).all()) {
   const columns=Object.keys(row);
   await DB.prepare('INSERT INTO '+table.name+'('+columns.join(',')+') VALUES('+columns.map(()=>'?').join(',')+')').bind(...Object.values(row)).run();
  }
 }
 const args={driverId:driver.id,requestedState:'on_line',activeVehicleId:vehicle,expectedRevision:1,updatedAt:time,requestId:'req_test',auditId:'audit_first',idempotency:{operation:'driver.availability.update',keyDigest:'A'.repeat(43),requestDigest:'B'.repeat(43),claimId:'claim_first'}};
 const first=await updateDriverAvailability({DB},args);
 const loser=await updateDriverAvailability({DB},{...args,auditId:'audit_loser',idempotency:{...args.idempotency,claimId:'claim_loser'}});
 const stale=await updateDriverAvailability({DB},{...args,auditId:'audit_stale',idempotency:{...args.idempotency,keyDigest:'C'.repeat(43),claimId:'claim_stale'}});
 const audit=await DB.prepare('SELECT count(*) n FROM audit_events').first();
 if(first.kind!=='success'||loser.kind!=='existing_idempotency'||stale.kind!=='conflict'||audit.n!==1)throw Error('D1 audit invariant failure');
 console.log(JSON.stringify({engine:'local workerd/D1',first:first.kind,loser:loser.kind,stale:stale.kind,auditRows:audit.n,result:'PASS'}));
} finally {local.sqlite.close();await mf.dispose();}
