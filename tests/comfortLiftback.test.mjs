import test from 'node:test';
import assert from 'node:assert/strict';
import router from '../src/router.js';
import { sqliteD1 } from './helpers/sqliteD1.mjs';
import { seedRuleActors,ruleSecrets } from './helpers/adminVehicleRuleScenario.mjs';
import { decideTrustedVehicle } from '../src/core/trustedVehicleDecision.js';
import { populatedLiftbackFixture,verifyLiftbackUpgrade,comfortLiftbackWorkflow } from './helpers/comfortLiftbackScenario.mjs';

test('liftback is comfort-only even with a forged rule or explicit OWNER exception',()=>{
 const p={make:'Toyota',model:'Camry',modelYear:2023,powertrain:'hybrid',bodyType:'liftback'};
 const r={version:'rule_liftback',make:'Toyota',model:'Camry',minYear:2020,vehicleClass:'comfort',allowedBodyTypes:['liftback'],conditions:[]};
 const exception={basisRuleVersion:r.version,yearBelowMinimum:true,waivedConditionIds:[]};
 for(const x of [null,exception]){
  assert.equal(decideTrustedVehicle(p,r,[],x).vehicleClass,'comfort');
  for(const vehicleClass of ['business','minivan'])for(const allowedBodyTypes of [null,['liftback']])assert.equal(decideTrustedVehicle(p,{...r,vehicleClass,allowedBodyTypes},[],x).outcome,'excluded');
  assert.equal(decideTrustedVehicle({...p,powertrain:'battery_electric'},r,[],x).reasonCodes[0],'battery_electric');
 }
 assert.equal(decideTrustedVehicle(p,{...r,allowedBodyTypes:['sedan','crossover']},[]).outcome,'excluded');
 for(const model of ['L7','L9']){
  const rule={...r,make:'Li Auto',model,vehicleClass:'business',allowedBodyTypes:['crossover']};
  assert.equal(decideTrustedVehicle({...p,make:'Li Auto',model},rule,[]).outcome,'excluded');
  assert.equal(decideTrustedVehicle({...p,make:'Li Auto',model,bodyType:'crossover'},rule,[]).vehicleClass,'business');
 }
});

test('populated24 to25 preserves immutable graph, rolls back failures, and enforces liftback APIs/SQL',async t=>{
 const DB=sqliteD1({throughMigration:24});t.after(()=>DB.sqlite.close());await seedRuleActors(DB);const env={DB,...ruleSecrets};
 const send=async(method,path,body,token,key)=>{const r=await router(new Request('https://fixture.invalid'+path,{method,
  headers:{'Content-Type':'application/json','CF-Connecting-IP':'203.0.113.10',...(token?{Authorization:'Bearer '+token}:{}),...(key?{'Idempotency-Key':key}:{})},
  ...(body===undefined?{}:{body:JSON.stringify(body)})}),env,{});return{status:r.status,body:await r.json()};};
 const fixture=await populatedLiftbackFixture(env,send);await verifyLiftbackUpgrade(env,fixture);await comfortLiftbackWorkflow(env,send,fixture);
});
