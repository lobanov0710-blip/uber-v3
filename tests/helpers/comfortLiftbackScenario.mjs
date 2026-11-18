import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { trustedScenario } from './trustedAssessmentScenario.mjs';
import { prepareVehicleApproval } from './atomicVehicleReviewScenario.mjs';
import { driverId,moderator,ownerId,ruleBody } from './adminVehicleRuleScenario.mjs';

export function liftbackMigrationStatements(){
  const sql=readFileSync(new URL('../../migrations/0025_comfort_liftback.sql',import.meta.url),'utf8');
  const triggers=[...sql.matchAll(/^CREATE TRIGGER[\s\S]*?END;/gm)].map(m=>m[0]);
  const ordinary=sql.replace(/^CREATE TRIGGER[\s\S]*?END;/gm,'').replace(/--[^\n]*/g,'').split(';').map(x=>x.trim()).filter(Boolean);
  return [...ordinary,...triggers];
}

export async function populatedLiftbackFixture(env,send){
  const s=await trustedScenario(env,send);
  await prepareVehicleApproval(env,s.vehicle.id,'photo_liftback_existing_');
  const first=await s.capture();assert.equal(first.ok,true);
  const review='/v1/admin/registrations/'+driverId+'/review/items/vehicle/'+s.vehicle.id;
  assert.equal((await send('POST',review,{decision:'approved',expectedRevision:2},s.ownerToken,'liftback-existing-approved')).status,200);
  await env.DB.prepare("UPDATE driver_profiles SET registration_status='approved',identity_status='verified' WHERE staff_account_id=?1").bind(driverId).run();
  await env.DB.prepare("INSERT INTO driver_availability VALUES(?1,?2,'on_line',1,1)").bind(driverId,s.vehicle.id).run();
  await env.DB.prepare("INSERT INTO orders(id,name,phone,route,trip_date,status,driver_id,created_at,updated_at) VALUES('order_liftback_existing','Synthetic','+79990000000','Synthetic','2030-01-01','taken',?1,1,1)").bind(driverId).run();
  await env.DB.prepare("INSERT INTO order_assignments(id,order_id,driver_id,vehicle_id,assigned_by,reason,created_at) VALUES('assignment_liftback_existing','order_liftback_existing',?1,?2,?3,'Synthetic',1)").bind(driverId,s.vehicle.id,moderator).run();
  await env.DB.prepare("UPDATE document_resources SET revision=revision+1 WHERE id='document_trusted_front'").run();
  const old=await env.DB.prepare('SELECT revision FROM vehicles WHERE id=?1').bind(s.vehicle.id).first();
  const body={...s.body,expectedRevision:old.revision,evidence:s.body.evidence.map(e=>({...e,expectedRevision:e.documentId==='document_trusted_front'?2:1}))};
  assert.equal((await s.capture(body,'liftback-existing-current')).ok,true);
  assert.equal((await env.DB.prepare('SELECT count(*) n FROM vehicle_assessment_invalidations').first()).n,1);
  assert.equal((await env.DB.prepare('SELECT count(*) n FROM vehicle_reverification_assignment_holds').first()).n,1);
  assert.equal((await env.DB.prepare('SELECT count(*) n FROM vehicle_current_trusted_assessments').first()).n,1);
  return {...s,body};
}

export async function verifyLiftbackUpgrade(env,fixture){
  const names=(await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()).results.map(r=>r.name);
  const snapshot=async()=>{
    const result={};for(const name of names)result[name]=(await env.DB.prepare('SELECT rowid AS fixture_rowid,* FROM "'+name+'" ORDER BY rowid').all()).results;
    return result;
  };
  const before=await snapshot(),schema=(await env.DB.prepare("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all()).results;
  const statements=liftbackMigrationStatements();
  await assert.rejects(env.DB.batch([...statements.map(s=>env.DB.prepare(s)),env.DB.prepare('SELECT * FROM missing_liftback_rollback_fixture')]));
  assert.deepEqual(await snapshot(),before);
  assert.deepEqual((await env.DB.prepare("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all()).results,schema);
  await env.DB.batch(statements.map(s=>env.DB.prepare(s)));
  assert.deepEqual(await snapshot(),before);
  assert.equal((await env.DB.prepare("SELECT count(*) n FROM sqlite_master WHERE name LIKE '%liftback_migration%'").first()).n,0);
  assert.deepEqual((await env.DB.prepare('PRAGMA foreign_key_check').all()).results,[]);
  assert.equal((await env.DB.prepare('PRAGMA quick_check').first()).quick_check,'ok');
  for(const sql of ["UPDATE vehicle_trusted_assessments SET body_type='crossover'",'DELETE FROM vehicle_trusted_assessments',
    'DELETE FROM vehicle_assessment_invalidations','DELETE FROM vehicle_reverification_assignment_holds'])await assert.rejects(env.DB.prepare(sql).run());
  assert.equal((await env.DB.prepare('SELECT state FROM driver_availability WHERE driver_id=?1').bind(driverId).first()).state,'off_line');
  assert.equal((await env.DB.prepare('SELECT rule_version FROM vehicle_classification_bindings WHERE vehicle_id=?1 ORDER BY input_revision DESC').bind(fixture.vehicle.id).first()).rule_version,fixture.rule.version);
  return {populatedGraphPreserved:true,rowidsAndPinsPreserved:true,failedUpgradeRolledBack:true,historyStillImmutable:true};
}

export async function comfortLiftbackWorkflow(env,send,s){
  const path='/v1/admin/vehicle-rules',oldPin=s.rule.version;
  const definitions=(vehicleClass,model,allowedBodyTypes)=>({...ruleBody,vehicleClass,model,allowedBodyTypes});
  const allowed={...ruleBody,allowedBodyTypes:['sedan','crossover','liftback'],expectedCurrentVersion:oldPin};
  assert.equal((await send('POST',path,allowed,s.token,'liftback-dispatcher-denied')).status,403);
  for(const c of ['business','minivan'])assert.equal((await send('POST',path,definitions(c,'Synthetic '+c,['liftback']),s.ownerToken,'liftback-rule-denied-'+c)).status,400);
  const published=await send('POST',path,allowed,s.ownerToken,'liftback-comfort-rule');assert.equal(published.status,201);const rule=published.body.rule;
  assert.deepEqual(rule.allowedBodyTypes,['sedan','crossover','liftback']);
  assert.deepEqual((await send('GET',path+'/versions/'+oldPin,undefined,s.ownerToken)).body.rule.allowedBodyTypes,['sedan']);
  const revision=async id=>(await env.DB.prepare('SELECT revision FROM vehicles WHERE id=?1').bind(id).first()).revision;
  const oldBody={...s.body,expectedRevision:await revision(s.vehicle.id),parameters:{...s.body.parameters,bodyType:'liftback'}};
  const oldResult=await s.capture(oldBody,'liftback-old-pin');assert.equal(oldResult.ok,true);assert.equal(oldResult.classification.outcome,'excluded');
  const exception={...oldBody,expectedRevision:await revision(s.vehicle.id),mode:'exception',
    conditions:rule.conditions.map(c=>({conditionId:c.id,result:'satisfied'})),
    exception:{basisRuleVersion:rule.version,yearBelowMinimum:false,waivedConditionIds:[]}};
  const revised=await s.capture(exception,'liftback-explicit-new-basis',s.ownerToken);assert.equal(revised.ok,true);assert.equal(revised.classification.vehicleClass,'comfort');
  const pinned=await env.DB.prepare('SELECT pinned_rule_version,rule_version FROM vehicle_trusted_assessments WHERE id=?1').bind(revised.assessmentId).first();
  assert.equal(pinned.pinned_rule_version,oldPin);assert.equal(pinned.rule_version,rule.version);
  assert.equal((await env.DB.prepare('SELECT count(*) n FROM vehicle_reverification_assignment_holds').first()).n,1);
  const made=await send('POST','/v1/driver/vehicles',{vin:'XW8ZZZ61ZFG000003',plate:'SYNTHETIC-LIFTBACK',make:'Toyota',model:'Camry',modelYear:2023,color:'White',capacity:4,baggageCapacity:'standard',usageBasis:'owner'},s.driver);
  assert.equal(made.status,201);const vehicle=made.body.vehicle,evidence=[];
  for(const[id,kind]of[['document_liftback_front','sts_front'],['document_liftback_back','sts_back']]){
    await env.DB.prepare("INSERT INTO document_resources(id,owner_driver_id,vehicle_id,kind,private_object_key,status,created_at,updated_at) VALUES(?1,?2,?3,?4,?1,'verified',1,1)").bind(id,driverId,vehicle.id,kind).run();evidence.push({documentId:id,expectedRevision:1});
  }
  const review='/v1/admin/vehicles/'+vehicle.id+'/classification/review';
  const request={expectedRevision:1,expectedInputRevision:1,expectedRuleVersion:rule.version,mode:'standard',parameters:{make:'Toyota',model:'Camry',modelYear:2023,powertrain:'hybrid',bodyType:'liftback'},evidence,conditions:rule.conditions.map(c=>({conditionId:c.id,result:'satisfied'})),exception:null,reason:'Synthetic verified liftback'};
  const saved=await send('POST',review,request,s.token,'liftback-standard');assert.equal(saved.status,200);assert.equal(saved.body.classification.vehicleClass,'comfort');
  const replay=await send('POST',review,request,s.token,'liftback-standard');assert.equal(replay.status,200);
  const {requestId:firstRequest,...firstReceipt}=saved.body,{requestId:nextRequest,...replayReceipt}=replay.body;
  assert.notEqual(firstRequest,nextRequest);assert.deepEqual(replayReceipt,firstReceipt);
  const page=await send('GET','/v1/admin/vehicles/'+vehicle.id+'/classification',undefined,s.token);assert.equal(page.status,200);assert.equal(page.body.verifiedParameters.bodyType,'liftback');
  const state=await env.DB.prepare('SELECT status,class FROM vehicles WHERE id=?1').bind(vehicle.id).first();assert.equal(state.status,'draft');assert.equal(state.class,null);
  const invalid=await send('POST',review,{...request,expectedRevision:saved.body.vehicleRevision,parameters:{...request.parameters,bodyType:'hatchback'}},s.ownerToken,'liftback-unapproved-body');assert.equal(invalid.status,400);
  assert.ok(!JSON.stringify(saved.body).includes('document_liftback'));assert.ok(!JSON.stringify(saved.body).includes(request.reason));
  const last=async()=>env.DB.prepare('SELECT * FROM vehicle_trusted_assessments WHERE vehicle_id=?1 ORDER BY sequence DESC LIMIT 1').bind(vehicle.id).first();
  const forge=async changes=>{
    const prior=await last(),id='assessment_liftback_forge_'+crypto.randomUUID(),audit='audit_liftback_'+crypto.randomUUID();
    await env.DB.prepare("INSERT INTO audit_events VALUES(?1,?2,'admin.vehicle_assessment_recorded','vehicle',?3,'success',NULL,1)").bind(audit,ownerId,vehicle.id).run();
    const row={...prior,id,sequence:prior.sequence+1,vehicle_revision:await revision(vehicle.id),actor_account_id:ownerId,audit_event_id:audit,...changes};
    await assert.rejects(env.DB.prepare('INSERT INTO vehicle_trusted_assessments('+Object.keys(row).join(',')+') VALUES('+Object.keys(row).map((_,i)=>'?'+(i+1)).join(',')+')').bind(...Object.values(row)).run());
  };
  for(const body_type of [null,'hatchback'])await forge({body_type});
  await env.DB.prepare("INSERT INTO vehicle_classification_rules VALUES('rule_liftback_legacy','Toyota','Camry',99,2020,'comfort','',1)").run();
  await forge({mode:'exception',rule_version:'rule_liftback_legacy',exception_json:JSON.stringify({basisRuleVersion:'rule_liftback_legacy',yearBelowMinimum:false,waivedConditionIds:[]}),conditions_json:'[]'});
  for(const c of ['business','minivan']){
    const made=await send('POST',path,definitions(c,'Synthetic '+c,c==='minivan'?null:['sedan']),s.ownerToken,'liftback-basis-'+c);assert.equal(made.status,201);
    const basis=made.body.rule,conditions=basis.conditions.map(x=>({conditionId:x.id,result:'satisfied'}));
    const x={...request,expectedRevision:await revision(vehicle.id),mode:'exception',conditions,exception:{basisRuleVersion:basis.version,yearBelowMinimum:false,waivedConditionIds:[]}};
    const denied=await send('POST',review,x,s.ownerToken,'liftback-exception-denied-'+c);assert.equal(denied.status,200);assert.equal(denied.body.classification.outcome,'excluded');assert.deepEqual(denied.body.classification.reasonCodes,['body_type_not_allowed']);
    await forge({outcome:'candidate',class:c,reason_codes_json:'[]'});
    const raw={version:'rule_liftback_raw_'+c,make:'Toyota',model:'Invalid '+c,revision:1,min_year:2020,class:c,notes:'',created_at:1};
    await env.DB.prepare('INSERT INTO vehicle_classification_rules('+Object.keys(raw).join(',')+') VALUES('+Object.keys(raw).map((_,i)=>'?'+(i+1)).join(',')+')').bind(...Object.values(raw)).run();
    await assert.rejects(env.DB.prepare("INSERT INTO vehicle_classification_rule_definitions VALUES(?1,'[\"liftback\"]','[]',?2,'Synthetic',1)").bind(raw.version,ownerId).run());
  }
  for(const mode of ['standard','exception']){
    const x={...request,expectedRevision:await revision(vehicle.id),mode,parameters:{...request.parameters,powertrain:'battery_electric'},exception:mode==='exception'?{basisRuleVersion:rule.version,yearBelowMinimum:false,waivedConditionIds:[]}:null};
    const excluded=await send('POST',review,x,s.ownerToken,'liftback-bev-'+mode);assert.equal(excluded.status,200);assert.equal(excluded.body.classification.reasonCodes[0],'battery_electric');
  }
  const tooOld=await send('POST',review,{...request,expectedRevision:await revision(vehicle.id),parameters:{...request.parameters,modelYear:2019}},s.ownerToken,'liftback-year');
  assert.equal(tooOld.status,200);assert.equal(tooOld.body.classification.outcome,'manual_review');assert.equal(tooOld.body.classification.reasonCodes[0],'year_below_minimum');
  assert.deepEqual((await env.DB.prepare('PRAGMA foreign_key_check').all()).results,[]);
  return {comfortLiftback:'PASS',ownerMfaAndDispatcherBoundaries:true,explicitNewRuleOnly:true,oldPinAndLegacyFallbackPreserved:true,
    standardAndExplicitException:true,noAutomaticAdmission:true,businessAndNullableMinivanExcluded:true,directSqlForgeryDenied:true,
    bevAndYearGuards:true,strictBodyEnum:true,heldTripNotResumed:true};
}
