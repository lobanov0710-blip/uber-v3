// D1 owns identity, MFA evidence and one-time claims. Raw seeds/tokens/codes are never bound here.
import { digest } from './ownerMfaCrypto.js';
export const MFA_TTL = 12*60*60*1000;
export const CHALLENGE_TTL = 5*60*1000;
export const BOOTSTRAP_TTL = 15*60*1000;
const p=(env,sql,...args)=>{const indices=[...sql.matchAll(/\?(\d+)/g)].map(m=>Number(m[1]));return env.DB.prepare(sql).bind(...args.slice(0,Math.max(0,...indices)));};
const changed=result=>Number(result?.meta?.changes??0);
export async function isOwnerAccount(env,id){return !!await p(env,'SELECT account_id FROM staff_owner_binding WHERE singleton=1 AND account_id=?1',id).first();}
export async function ownerSessionEvidence(env,account,session,now=Date.now()){
 if(account.role!=='admin'||!await isOwnerAccount(env,account.id))return {required:false};
 const evidence=await p(env,`SELECT e.verified_at,e.expires_at,e.method FROM admin_mfa_session_families e
 JOIN staff_sessions s ON s.family_id=e.family_id AND s.account_id=e.account_id
 JOIN admin_mfa_factors f ON f.account_id=e.account_id AND f.revision=e.factor_revision
 JOIN staff_accounts a ON a.id=e.account_id AND a.token_version=e.token_version
 WHERE s.id=?1 AND e.account_id=?2 AND e.verified_at<=?3 AND e.expires_at>?3
 AND e.expires_at<=s.expires_at AND f.enabled_at<=e.verified_at`,session.id,account.id,now).first();
 return evidence?{required:true,verified:true,expiresAt:evidence.expires_at,method:evidence.method}:{required:true,verified:false};
}
export async function quota(env,accountId,ip,now){
 const values={accountDigest:accountId?await digest('mfa-account-rate',accountId):'',ipDigest:await digest('mfa-ip-rate',ip),accountWindow:now,ipWindow:now,accountCutoff:now-900000,ipCutoff:now-60000};
 const row=await p(env,`SELECT 1 blocked WHERE
 (SELECT COALESCE(SUM(failures),0) FROM admin_mfa_limits WHERE kind='account' AND digest=?1 AND window_start>?2)>=10 OR
 (SELECT COALESCE(SUM(failures),0) FROM admin_mfa_limits WHERE kind='ip' AND digest=?3 AND window_start>?4)>=20`,values.accountDigest,values.accountCutoff,values.ipDigest,values.ipCutoff).first();
 return {...values,blocked:!!row};
}
export async function audit(env,accountId,action,outcome,requestId,now){
 await p(env,`INSERT INTO audit_events(id,actor_account_id,action,target_type,target_id,outcome,request_id,created_at)
 VALUES(?1,?2,?3,'owner_mfa',?4,?5,?6,?7)`,crypto.randomUUID(),accountId,action,accountId||'owner_mfa',outcome,requestId,now).run();
}
export async function recordFailure(env,{challengeDigest,accountId,ip,requestId,now,bootstrap=false,replay=false}){
 const q=await quota(env,accountId,ip,now),stmts=[];
 if(challengeDigest)stmts.push(p(env,`UPDATE admin_mfa_challenges SET attempts=MIN(5,attempts+1)
 WHERE digest=?1 AND consumed_at IS NULL`,challengeDigest));
 if(bootstrap&&accountId)stmts.push(p(env,`UPDATE admin_mfa_bootstrap SET attempts=MIN(3,attempts+1)
 WHERE account_id=?1 AND consumed_at IS NULL`,accountId));
 if(accountId)stmts.push(p(env,`INSERT INTO admin_mfa_limits(kind,digest,window_start,failures) VALUES('account',?1,?2,1)
 ON CONFLICT(kind,digest,window_start) DO UPDATE SET failures=MIN(10,failures+1)`,q.accountDigest,q.accountWindow));
 stmts.push(p(env,`INSERT INTO admin_mfa_limits(kind,digest,window_start,failures) VALUES('ip',?1,?2,1)
 ON CONFLICT(kind,digest,window_start) DO UPDATE SET failures=MIN(20,failures+1)`,q.ipDigest,q.ipWindow));
 stmts.push(p(env,`INSERT INTO audit_events(id,actor_account_id,action,target_type,target_id,outcome,request_id,created_at)
 VALUES(?1,?2,?3,'owner_mfa',?4,'denied',?5,?6)`,crypto.randomUUID(),accountId,replay?'admin.mfa.replay_denied':'admin.mfa.verify_failed',accountId||'owner_mfa',requestId,now));
 await env.DB.batch(stmts);
}
export async function createChallenge(env,account,hash,now,requestId){
 const row=await p(env,`SELECT revision FROM admin_mfa_factors WHERE account_id=?1`,account.id).first();
 const result=await env.DB.batch([
 p(env,`INSERT INTO admin_mfa_challenges(digest,account_id,token_version,factor_revision,created_at,expires_at)
 SELECT ?1,id,token_version,?2,?3,?4 FROM staff_accounts WHERE id=?5 AND role='admin' AND status='active'
 AND token_version=?6 AND (locked_until IS NULL OR locked_until<=?3)
 AND EXISTS(SELECT 1 FROM staff_owner_binding WHERE singleton=1 AND account_id=?5)`,hash,row?.revision??null,now,now+CHALLENGE_TTL,account.id,account.tokenVersion),
 p(env,`INSERT INTO audit_events(id,actor_account_id,action,target_type,target_id,outcome,request_id,created_at)
 SELECT ?1,account_id,'admin.mfa.challenge_created','owner_mfa',account_id,'success',?2,?3
 FROM admin_mfa_challenges WHERE digest=?4`,crypto.randomUUID(),requestId,now,hash)
 ]);
 return changed(result[0])===1?{enrollmentRequired:!row}:null;
}
export async function getChallenge(env,hash){
 return p(env,`SELECT c.*,a.display_name,a.status account_status,a.role account_role,a.token_version current_token_version,a.locked_until,
 o.account_id current_owner,f.revision current_revision,f.encrypted_seed,f.last_counter
 FROM admin_mfa_challenges c JOIN staff_accounts a ON a.id=c.account_id
 LEFT JOIN staff_owner_binding o ON o.singleton=1 AND o.account_id=c.account_id
 LEFT JOIN admin_mfa_factors f ON f.account_id=c.account_id WHERE c.digest=?1`,hash).first();
}
export function usableChallenge(c,now){return !!c&&c.current_owner===c.account_id&&c.account_role==='admin'&&c.account_status==='active'
 &&c.current_token_version===c.token_version&&(c.locked_until==null||c.locked_until<=now)
 &&c.consumed_at==null&&c.expires_at>now&&c.attempts<5&&c.factor_revision===(c.current_revision??null);}
export async function reserveEnrollment(env,{c,bootstrapDigest,enrollmentDigest,encryptedSeed,now,requestId,ip}){
 const q=await quota(env,c.account_id,ip,now);
 const expires=Math.min(c.expires_at,now+BOOTSTRAP_TTL);
 const result=await env.DB.batch([
 p(env,`UPDATE admin_mfa_bootstrap SET enrollment_digest=?1 WHERE account_id=?2 AND digest=?3 AND attempts<3
 AND expires_at>?4 AND consumed_at IS NULL AND enrollment_digest IS NULL
 AND NOT EXISTS(SELECT 1 FROM admin_mfa_factors WHERE account_id=?2)
 AND EXISTS(SELECT 1 FROM admin_mfa_challenges c JOIN staff_accounts a ON a.id=c.account_id
 JOIN staff_owner_binding o ON o.account_id=a.id AND o.singleton=1 WHERE c.digest=?5 AND c.account_id=?2
 AND c.consumed_at IS NULL AND c.attempts<5 AND c.expires_at>?4 AND c.token_version=a.token_version
 AND c.factor_revision IS NULL AND a.role='admin' AND a.status='active' AND (a.locked_until IS NULL OR a.locked_until<=?4))
 AND (SELECT COALESCE(SUM(failures),0) FROM admin_mfa_limits WHERE kind='account' AND digest=?6 AND window_start>?7)<10 AND (SELECT COALESCE(SUM(failures),0) FROM admin_mfa_limits WHERE kind='ip' AND digest=?8 AND window_start>?9)<20`,enrollmentDigest,c.account_id,bootstrapDigest,now,c.digest,q.accountDigest,q.accountCutoff,q.ipDigest,q.ipCutoff),
 p(env,`INSERT INTO admin_mfa_enrollments(digest,account_id,challenge_digest,encrypted_seed,expires_at)
 SELECT ?1,account_id,?2,?3,MIN(expires_at,?4) FROM admin_mfa_bootstrap
 WHERE account_id=?5 AND enrollment_digest=?1 AND consumed_at IS NULL`,enrollmentDigest,c.digest,encryptedSeed,expires,c.account_id),
 p(env,`INSERT INTO audit_events(id,actor_account_id,action,target_type,target_id,outcome,request_id,created_at)
 SELECT ?1,account_id,'admin.mfa.enrollment_started','owner_mfa',account_id,'success',?2,?3
 FROM admin_mfa_enrollments WHERE digest=?4`,crypto.randomUUID(),requestId,now,enrollmentDigest)
 ]);
 return changed(result[0])===1&&changed(result[1])===1;
}
export async function getEnrollment(env,hash){return p(env,'SELECT * FROM admin_mfa_enrollments WHERE digest=?1',hash).first();}
export async function activateEnrollment(env,{e,c,counter,revision,recoveryDigests,now,requestId,ip}){
 const q=await quota(env,c.account_id,ip,now);
 const claim=crypto.randomUUID();
 const result=await env.DB.batch([
 p(env,`UPDATE admin_mfa_enrollments SET consumed_at=?1,claim_id=?2 WHERE digest=?3 AND consumed_at IS NULL AND expires_at>?1
 AND NOT EXISTS(SELECT 1 FROM admin_mfa_factors WHERE account_id=?4)
 AND EXISTS(SELECT 1 FROM admin_mfa_bootstrap b WHERE b.account_id=?4 AND b.enrollment_digest=?3 AND b.attempts<3 AND b.expires_at>?1 AND b.consumed_at IS NULL)
 AND EXISTS(SELECT 1 FROM admin_mfa_challenges c JOIN staff_accounts a ON a.id=c.account_id JOIN staff_owner_binding o ON o.account_id=a.id AND o.singleton=1
 WHERE c.digest=?5 AND c.account_id=?4 AND c.consumed_at IS NULL AND c.expires_at>?1 AND c.attempts<5
 AND a.status='active' AND a.role='admin' AND a.token_version=c.token_version AND (a.locked_until IS NULL OR a.locked_until<=?1))
 AND (SELECT COALESCE(SUM(failures),0) FROM admin_mfa_limits WHERE kind='account' AND digest=?6 AND window_start>?7)<10 AND (SELECT COALESCE(SUM(failures),0) FROM admin_mfa_limits WHERE kind='ip' AND digest=?8 AND window_start>?9)<20`,now,claim,e.digest,c.account_id,c.digest,q.accountDigest,q.accountCutoff,q.ipDigest,q.ipCutoff),
 p(env,`INSERT INTO admin_mfa_factors(account_id,encrypted_seed,revision,last_counter,enabled_at)
 SELECT account_id,encrypted_seed,?1,?2,?3 FROM admin_mfa_enrollments WHERE digest=?4 AND claim_id=?5`,revision,counter,now,e.digest,claim),
 p(env,`UPDATE admin_mfa_bootstrap SET consumed_at=?1 WHERE account_id=?2 AND enrollment_digest=?3
 AND EXISTS(SELECT 1 FROM admin_mfa_enrollments WHERE digest=?3 AND claim_id=?4)`,now,c.account_id,e.digest,claim),
 p(env,`UPDATE admin_mfa_challenges SET consumed_at=?1,claim_id=?2 WHERE digest=?3
 AND EXISTS(SELECT 1 FROM admin_mfa_enrollments WHERE digest=?4 AND claim_id=?2)`,now,claim,c.digest,e.digest),
 p(env,`UPDATE staff_sessions SET revoked_at=COALESCE(revoked_at,?1) WHERE account_id=?2
 AND EXISTS(SELECT 1 FROM admin_mfa_enrollments WHERE digest=?3 AND claim_id=?4)`,now,c.account_id,e.digest,claim),
 ...recoveryDigests.map(hash=>p(env,`INSERT INTO admin_mfa_recovery(digest,account_id,factor_revision)
 SELECT ?1,account_id,revision FROM admin_mfa_factors WHERE account_id=?2 AND revision=?3
 AND EXISTS(SELECT 1 FROM admin_mfa_enrollments WHERE digest=?4 AND claim_id=?5)`,hash,c.account_id,revision,e.digest,claim)),
 p(env,`INSERT INTO audit_events(id,actor_account_id,action,target_type,target_id,outcome,request_id,created_at)
 SELECT ?1,account_id,'admin.mfa.enrolled','owner_mfa',account_id,'success',?2,?3 FROM admin_mfa_enrollments WHERE digest=?4 AND claim_id=?5`,crypto.randomUUID(),requestId,now,e.digest,claim)
 ]);
 return changed(result[0])===1;
}
export async function consumeProofAndCreateSession(env,{c,counter,recoveryDigest,session,now,method,requestId,ip}){
 const q=await quota(env,c.account_id,ip,now),claim=crypto.randomUUID();
 // All statements share numbered bindings; only the SQLite transaction can consume a proof and issue its family.
 const args=[c.digest,claim,now,c.account_id,c.factor_revision,c.token_version,counter??-1,recoveryDigest??'',session.id,session.familyId,session.refreshTokenHash,session.expiresAt,Math.min(now+MFA_TTL,session.expiresAt),method,requestId,q.accountDigest,q.accountCutoff,q.ipDigest,q.ipCutoff];
 const proof=method==='totp'?`EXISTS(SELECT 1 FROM admin_mfa_factors WHERE account_id=?4 AND revision=?5 AND last_counter<?7)`:
 `EXISTS(SELECT 1 FROM admin_mfa_recovery WHERE digest=?8 AND account_id=?4 AND factor_revision=?5 AND used_at IS NULL)`;
 const consumed=method==='totp'?`EXISTS(SELECT 1 FROM admin_mfa_factors WHERE account_id=?4 AND revision=?5 AND last_counter=?7)`:
 `EXISTS(SELECT 1 FROM admin_mfa_recovery WHERE digest=?8 AND account_id=?4 AND used_claim=?2)`;
 const statements=[
 `UPDATE admin_mfa_challenges AS c SET consumed_at=?3,claim_id=?2 WHERE c.digest=?1 AND c.account_id=?4 AND c.factor_revision=?5 AND c.token_version=?6
 AND c.consumed_at IS NULL AND c.expires_at>?3 AND c.attempts<5 AND ${proof}
 AND EXISTS(SELECT 1 FROM staff_accounts a JOIN staff_owner_binding o ON o.account_id=a.id AND o.singleton=1 WHERE a.id=?4 AND a.status='active' AND a.role='admin' AND a.token_version=?6 AND (a.locked_until IS NULL OR a.locked_until<=?3))
 AND (SELECT COALESCE(SUM(failures),0) FROM admin_mfa_limits WHERE kind='account' AND digest=?16 AND window_start>?17)<10 AND (SELECT COALESCE(SUM(failures),0) FROM admin_mfa_limits WHERE kind='ip' AND digest=?18 AND window_start>?19)<20`,
 method==='totp'?`UPDATE admin_mfa_factors SET last_counter=?7 WHERE account_id=?4 AND revision=?5 AND last_counter<?7 AND EXISTS(SELECT 1 FROM admin_mfa_challenges WHERE digest=?1 AND claim_id=?2)`:
 `UPDATE admin_mfa_recovery SET used_at=?3,used_claim=?2 WHERE digest=?8 AND account_id=?4 AND factor_revision=?5 AND used_at IS NULL AND EXISTS(SELECT 1 FROM admin_mfa_challenges WHERE digest=?1 AND claim_id=?2)`,
 `INSERT INTO staff_sessions(id,account_id,family_id,refresh_token_hash,created_at,expires_at) SELECT ?9,?4,?10,?11,?3,?12 FROM admin_mfa_challenges WHERE digest=?1 AND claim_id=?2 AND ${consumed}`,
 `INSERT INTO admin_mfa_session_families(family_id,account_id,factor_revision,token_version,verified_at,expires_at,method)
 SELECT ?10,?4,?5,?6,?3,?13,?14 FROM staff_sessions WHERE id=?9 AND account_id=?4`,
 `INSERT INTO audit_events(id,actor_account_id,action,target_type,target_id,outcome,request_id,created_at)
 SELECT ?2,?4,CASE WHEN ?14='recovery' THEN 'admin.mfa.recovery_used' ELSE 'admin.mfa.verified' END,'owner_mfa',?4,'success',?15,?3 FROM staff_sessions WHERE id=?9 AND account_id=?4`
 ];
 const results=await env.DB.batch(statements.map(sql=>p(env,sql,...args)));
 if(changed(results[0])===0)return false;
 if(results.some(row=>changed(row)!==1))throw new Error('MFA transaction invariant failed');
 return true;
}
export async function purgeOwnerMfaEphemera(env,now=Date.now()){
 await env.DB.batch([
 p(env,'DELETE FROM admin_mfa_challenges WHERE expires_at<=?1',now),
 p(env,'DELETE FROM admin_mfa_bootstrap WHERE expires_at<=?1',now),
 p(env,"DELETE FROM admin_mfa_limits WHERE (kind='account' AND window_start+900000<=?1) OR (kind='ip' AND window_start+60000<=?1)",now),
 p(env,'DELETE FROM admin_mfa_session_families WHERE expires_at<=?1',now)
 ]);
}
