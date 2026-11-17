// Explicit synthetic reviewed state for positive operational tests only.
// Never imported by application code or used to repair legacy/negative cases.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const digest=value=>createHash('sha256').update(value).digest('hex').slice(0,24);
export function seedAdmissionReference(DB,make='Test',model='Car',vehicleClass='comfort'){
 const version='rule_fixture_admission_'+digest(make+'\0'+model+'\0'+vehicleClass);
 if(!DB.sqlite.prepare('SELECT version FROM vehicle_classification_rules WHERE version=?').get(version)){
  const revision=DB.sqlite.prepare('SELECT COALESCE(MAX(revision),0)+1 n FROM vehicle_classification_rules WHERE make=? AND model=?').get(make,model).n;
  DB.sqlite.prepare("INSERT INTO vehicle_classification_rules VALUES(?,?,?,?,2020,?,'',1)").run(version,make,model,revision,vehicleClass);
 }
 DB.sqlite.prepare('INSERT INTO vehicle_classification_current_rules VALUES(?,?,?) ON CONFLICT(make,model) DO UPDATE SET rule_version=excluded.rule_version').run(make,model,version);
 return version;
}
export function seedAdmissionProof(DB,vehicleId){
 const v=DB.sqlite.prepare('SELECT * FROM vehicles WHERE id=?').get(vehicleId);assert.ok(v,'fixture vehicle exists');
 const b=DB.sqlite.prepare('SELECT * FROM vehicle_classification_bindings WHERE vehicle_id=? ORDER BY input_revision DESC').get(vehicleId);
 assert.ok(b?.rule_version&&v.model_year>=2020&&typeof v.color==='string'&&v.color.trim(),'positive fixture requires explicit first-save rule/year/color');
 const r=DB.sqlite.prepare('SELECT * FROM vehicle_classification_rules WHERE version=?').get(b.rule_version);assert.equal(r.class,v.class);assert.equal(r.notes,'');
 const actor='staff_admission_fixture';
 DB.sqlite.prepare("INSERT INTO staff_accounts(id,login,display_name,role,status,password_algorithm,password_iterations,password_salt,password_hash,password_changed_at,created_at,updated_at) VALUES(?,'admission-fixture','Synthetic admission reviewer','admin','active','pbkdf2-sha256',100000,?,?,1,1,1) ON CONFLICT(id) DO NOTHING").run(actor,'A'.repeat(32),'B'.repeat(43));
 DB.sqlite.prepare("INSERT INTO staff_permissions VALUES(?,'vehicles.verify',?,1) ON CONFLICT(account_id,permission) DO NOTHING").run(actor,actor);
 const key=digest(vehicleId),evidence=[];
 for(const kind of ['sts_front','sts_back']){
  const id='document_fixture_admission_'+kind+'_'+key;
  DB.sqlite.prepare("INSERT INTO document_resources(id,owner_driver_id,vehicle_id,kind,private_object_key,status,created_at,updated_at) VALUES(?,?,?,?,?,'verified',1,1)").run(id,v.driver_id,v.id,kind,id);
  evidence.push({documentId:id,expectedRevision:1});
 }
 const audit='audit_fixture_admission_'+key;
 DB.sqlite.prepare("INSERT INTO audit_events VALUES(?,?,'admin.vehicle_assessment_recorded','vehicle',?,'success',NULL,1)").run(audit,actor,v.id);
 DB.sqlite.prepare(`INSERT INTO vehicle_trusted_assessments(id,vehicle_id,sequence,vehicle_revision,input_revision,pinned_rule_version,rule_version,make,model,model_year,declared_powertrain,powertrain,body_type,mode,exception_json,evidence_json,conditions_json,outcome,class,reason_codes_json,reason,actor_account_id,audit_event_id,created_at)
  VALUES(?,?,1,?,?,?,?,?,?,?,?, 'hybrid','sedan','standard',NULL,?,'[]','candidate',?,'[]','Synthetic pre-existing reviewed state',?,?,1)`)
  .run('assessment_fixture_'+key,v.id,v.revision,b.input_revision,b.rule_version,b.rule_version,v.make,v.model,v.model_year,v.powertrain,JSON.stringify(evidence),r.class,actor,audit);
}
export function operationAudits(DB){return DB.sqlite.prepare("SELECT count(*) n FROM audit_events WHERE id NOT LIKE 'audit_fixture_admission_%'").get().n;}

export async function seedAdmissionReferenceD1(DB,make='Test',model='Car',vehicleClass='comfort'){
 const version='rule_fixture_admission_'+digest(make+'\0'+model+'\0'+vehicleClass);
 await DB.prepare("INSERT INTO vehicle_classification_rules(version,make,model,revision,min_year,class,notes,created_at) SELECT ?1,?2,?3,COALESCE((SELECT MAX(revision) FROM vehicle_classification_rules WHERE make=?2 AND model=?3),0)+1,2020,?4,'',1 WHERE NOT EXISTS(SELECT 1 FROM vehicle_classification_rules WHERE version=?1)").bind(version,make,model,vehicleClass).run();
 await DB.prepare('INSERT INTO vehicle_classification_current_rules VALUES(?1,?2,?3) ON CONFLICT(make,model) DO UPDATE SET rule_version=excluded.rule_version').bind(make,model,version).run();
 return version;
}
export async function seedAdmissionProofD1(DB,vehicleId){
 const v=await DB.prepare('SELECT * FROM vehicles WHERE id=?1').bind(vehicleId).first();
 const b=await DB.prepare('SELECT * FROM vehicle_classification_bindings WHERE vehicle_id=?1 ORDER BY input_revision DESC LIMIT 1').bind(vehicleId).first();
 assert.ok(b?.rule_version&&v.model_year>=2020&&v.color?.trim(),'positive D1 fixture requires explicit first-save rule/year/color');
 const r=await DB.prepare('SELECT * FROM vehicle_classification_rules WHERE version=?1').bind(b.rule_version).first();assert.equal(r.class,v.class);assert.equal(r.notes,'');
 const actor='staff_admission_fixture',key=digest(vehicleId),evidence=[];
 await DB.prepare("INSERT INTO staff_accounts(id,login,display_name,role,status,password_algorithm,password_iterations,password_salt,password_hash,password_changed_at,created_at,updated_at) VALUES(?1,'admission-fixture','Synthetic admission reviewer','admin','active','pbkdf2-sha256',100000,?2,?3,1,1,1) ON CONFLICT(id) DO NOTHING").bind(actor,'A'.repeat(32),'B'.repeat(43)).run();
 await DB.prepare("INSERT INTO staff_permissions VALUES(?1,'vehicles.verify',?1,1) ON CONFLICT(account_id,permission) DO NOTHING").bind(actor).run();
 for(const kind of ['sts_front','sts_back']){
  const id='document_fixture_admission_'+kind+'_'+key;
  await DB.prepare("INSERT INTO document_resources(id,owner_driver_id,vehicle_id,kind,private_object_key,status,created_at,updated_at) VALUES(?1,?2,?3,?4,?1,'verified',1,1)").bind(id,v.driver_id,v.id,kind).run();evidence.push({documentId:id,expectedRevision:1});
 }
 const audit='audit_fixture_admission_'+key;
 await DB.prepare("INSERT INTO audit_events VALUES(?1,?2,'admin.vehicle_assessment_recorded','vehicle',?3,'success',NULL,1)").bind(audit,actor,v.id).run();
 await DB.prepare("INSERT INTO vehicle_trusted_assessments(id,vehicle_id,sequence,vehicle_revision,input_revision,pinned_rule_version,rule_version,make,model,model_year,declared_powertrain,powertrain,body_type,mode,exception_json,evidence_json,conditions_json,outcome,class,reason_codes_json,reason,actor_account_id,audit_event_id,created_at) VALUES(?1,?2,1,?3,?4,?5,?5,?6,?7,?8,?9,'hybrid','sedan','standard',NULL,?10,'[]','candidate',?11,'[]','Synthetic pre-existing reviewed state',?12,?13,1)").bind('assessment_fixture_'+key,v.id,v.revision,b.input_revision,b.rule_version,v.make,v.model,v.model_year,v.powertrain,JSON.stringify(evidence),r.class,actor,audit).run();
}
