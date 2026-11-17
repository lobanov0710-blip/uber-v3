import assert from 'node:assert/strict';
import { seedModeration,moderator,driverId,fixturePassword } from './adminModerationScenario.mjs';
import { hashStaffPassword } from '../../src/core/staffAuthCrypto.js';
import { provisionOwnerBootstrap } from '../../src/core/ownerMfaControlPlane.js';
import { unbase32,totp } from '../../src/core/ownerMfaCrypto.js';
export {moderator,driverId,fixturePassword};
export const ownerId='staff_rule_owner123';
export const ruleSecrets={JWT_SECRET:'synthetic-rule-jwt-012345678901234567890123',ADMIN_MFA_ENCRYPTION_KEY:Buffer.alloc(32,11).toString('base64')};
export const ruleBody={make:'Toyota',model:'Camry',minYear:2020,vehicleClass:'comfort',allowedBodyTypes:['sedan'],
  conditions:['Synthetic condition'],expectedCurrentVersion:null,reason:'Synthetic rule reason'};
export async function seedRuleActors(DB){
  await seedModeration(DB);const p=await hashStaffPassword(fixturePassword);
  await DB.prepare(`INSERT INTO staff_accounts(id,login,display_name,role,status,password_algorithm,password_iterations,password_salt,password_hash,password_changed_at,created_at,updated_at)
    VALUES(?1,?1,'Synthetic OWNER','admin','active',?2,?3,?4,?5,1,1,1)`)
    .bind(ownerId,p.passwordAlgorithm,p.passwordIterations,p.passwordSalt,p.passwordHash).run();
  await DB.prepare('INSERT INTO staff_owner_binding VALUES(1,?1,1)').bind(ownerId).run();
  await DB.prepare("INSERT INTO staff_permissions VALUES(?1,'vehicles.read',?1,1)").bind(moderator).run();
}
export async function ruleOwnerLogin(env,send){
  const boot=await provisionOwnerBootstrap(env,ownerId);
  const login=await send('POST','/staff/login',{login:ownerId,password:fixturePassword});assert.equal(login.status,200);assert.equal(login.body.accessToken,undefined);
  const start=await send('POST','/v1/admin/mfa/enrollment/start',{challengeId:login.body.challengeId,bootstrapCode:boot.bootstrapCode});assert.equal(start.status,200);
  const confirm=await send('POST','/v1/admin/mfa/enrollment/confirm',{enrollmentId:start.body.enrollmentId,code:await totp(unbase32(start.body.secret),Math.floor(Date.now()/30000))});assert.equal(confirm.status,200);
  const challenge=await send('POST','/staff/login',{login:ownerId,password:fixturePassword});assert.equal(challenge.status,200);
  const verified=await send('POST','/v1/admin/mfa/recovery/verify',{challengeId:challenge.body.challengeId,recoveryCode:confirm.body.recoveryCodes[0]});assert.equal(verified.status,200);
  assert.ok(verified.body.accessToken);return verified.body.accessToken;
}
export async function ruleApiWorkflow(env,send){
  const token=await ruleOwnerLogin(env,send),path='/v1/admin/vehicle-rules';
  assert.equal((await send('GET',path)).status,401);
  const dispatcher=(await send('POST','/staff/login',{login:moderator,password:fixturePassword})).body.accessToken;
  assert.equal((await send('POST',path,ruleBody,dispatcher,'native-rules-dispatcher')).status,403);
  const first=await send('POST',path,ruleBody,token,'native-rules-create');assert.equal(first.status,201);
  const rule=first.body.rule;assert.equal(rule.revision,1);assert.equal(rule.conditions[0].text,'Synthetic condition');
  assert.deepEqual((await send('POST',path,ruleBody,token,'native-rules-create')).body.rule,rule);
  const second=await send('POST',path,{...ruleBody,minYear:2023,expectedCurrentVersion:rule.version},token,'native-rules-update');assert.equal(second.status,201);
  assert.equal(second.body.rule.revision,2);assert.equal((await send('GET',path+'/versions/'+rule.version,undefined,token)).body.rule.minYear,2020);
  const list=await send('GET',path+'?make=Toyota',undefined,dispatcher);assert.equal(list.status,200);assert.equal(list.body.rules[0].version,second.body.rule.version);
  const vehicle=await send('GET','/v1/admin/vehicles/vehicle_fixture001/classification',undefined,dispatcher);
  assert.equal(vehicle.status,200);assert.equal(vehicle.body.classification,null);assert.equal(vehicle.body.verifiedParameters,null);
  assert.ok(!JSON.stringify(vehicle.body).includes('TESTVIN'));
  await env.DB.prepare("CREATE TRIGGER rule_fixture_audit_failure BEFORE INSERT ON audit_events WHEN NEW.action='admin.vehicle_rule_created' BEGIN SELECT RAISE(ABORT,'PRIVATE_RULE_PROVIDER_FAILURE'); END").run();
  const failed=await send('POST',path,{...ruleBody,model:'Synthetic rollback'},token,'native-rule-rollback');assert.equal(failed.status,500);
  assert.ok(!JSON.stringify(failed.body).includes('PRIVATE_RULE_PROVIDER_FAILURE'));
  assert.equal((await env.DB.prepare("SELECT count(*) n FROM vehicle_classification_rules WHERE model='Synthetic rollback'").first()).n,0);
  assert.equal((await send('GET',path+'?limit=1',undefined,token)).status,200);
  return {ruleApi:'PASS',ownerMfa:true,dispatcherWriteDenied:true,immutableVersionRead:true,idempotentReplay:true,atomicAuditRollback:true,untrustedVehicleProjection:true};
}
