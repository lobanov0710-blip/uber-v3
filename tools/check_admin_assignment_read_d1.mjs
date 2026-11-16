// Bundled Worker + native local D1, synthetic data only; no deployment or remote bindings.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { sqliteD1 } from '../tests/helpers/sqliteD1.mjs';
import { seedModeration, moderator, fixturePassword, driverId } from '../tests/helpers/adminModerationScenario.mjs';
const bundle=await build({entryPoints:[new URL('../src/index.js',import.meta.url).pathname],bundle:true,write:false,format:'esm',target:'es2022',platform:'browser'});
const local=sqliteD1(),mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'assignment-read-audit',modules:true,script:bundle.outputFiles[0].text,bindings:{JWT_SECRET:'synthetic-assignment-worker-jwt-01234567890123456789'},d1Databases:['DB'],compatibilityDate:'2026-08-20'}]}));
try {
  const DB=await mf.getD1Database('DB','assignment-read-audit');
  for(const row of local.sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all())await DB.prepare(row.sql).run();
  for(const row of local.sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL").all())await DB.prepare(row.sql).run();
  await seedModeration(DB);await DB.prepare('DELETE FROM staff_permissions').run();
  for(const p of ['orders.read','orders.assign','drivers.read','vehicles.read'])await DB.prepare('INSERT INTO staff_permissions(account_id,permission,granted_by,created_at) VALUES(?1,?2,?1,1)').bind(moderator,p).run();
  await DB.prepare("UPDATE driver_profiles SET registration_status='approved',identity_status='verified'").run();await DB.prepare("UPDATE vehicles SET status='approved'").run();
  for(const id of ['order_native001','order_native002'])await DB.prepare(`INSERT INTO orders(id,name,phone,route,from_place,to_place,trip_date,status,created_at,updated_at)
    VALUES(?1,'SYNTHETIC_PASSENGER_PRIVATE','+79990000000','private route','Origin','Destination','2030-01-01','new',1,1)`).bind(id).run();
  const send=async(path,token,body)=>{
    const response=await mf.dispatchFetch('https://fixture.invalid'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});
    assert.equal(response.headers.get('Cache-Control'),'no-store');return {status:response.status,body:await response.json()};
  };
  const login=await send('/staff/login',null,{login:moderator,password:fixturePassword});assert.equal(login.status,200);const token=login.body.accessToken;
  const first=await send('/v1/admin/orders?limit=1',token);assert.equal(first.status,200);assert.equal(first.body.orders.length,1);assert.ok(first.body.nextCursor);
  const next=await send('/v1/admin/orders?limit=1&cursor='+first.body.nextCursor,token);assert.equal(next.status,200);assert.equal(next.body.orders[0].id,'order_native002');assert.equal(next.body.nextCursor,null);
  const path='/v1/admin/orders/order_native001/assignment-options';let choices=await send(path,token);assert.equal(choices.status,200);assert.equal(choices.body.options[0].eligible,true);
  for(const response of [first,next,choices])assert.ok(!JSON.stringify(response.body).includes('SYNTHETIC_PASSENGER_PRIVATE'));
  await DB.prepare("UPDATE staff_accounts SET status='disabled' WHERE id=?1").bind(driverId).run();
  choices=await send(path,token);assert.ok(choices.body.options[0].blockers.includes('driver_not_active'));
  await DB.prepare("DELETE FROM staff_permissions WHERE account_id=?1 AND permission='vehicles.read'").bind(moderator).run();assert.equal((await send(path,token)).status,403);
  await DB.prepare('INSERT INTO staff_owner_binding(singleton,account_id,created_at) VALUES(1,?1,1)').bind(moderator).run();assert.equal((await send('/v1/admin/orders',token)).status,401);
  const audits=await DB.prepare("SELECT count(*) n FROM audit_events WHERE action IN('admin.orders_read','admin.assignment_options_read')").first();assert.equal(Number(audits.n),4);
  console.log(JSON.stringify({engine:'local workerd HTTP/D1',minimalProjection:true,keysetPagination:true,offlineNotExcluded:true,disabledDriverBlocked:true,grantRevocation:true,ownerMfaEnforced:true,auditRows:audits.n,result:'PASS'}));
} finally { local.sqlite.close();await mf.dispose(); }
