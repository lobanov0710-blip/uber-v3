// Trusted local control-plane only. This module is never exposed as an HTTP reset endpoint.
import { randomToken, digest } from './ownerMfaCrypto.js';
import { BOOTSTRAP_TTL } from './ownerMfaRepository.js';
export async function provisionOwnerBootstrap(env,accountId,{reset=false}={}){
 const now=Date.now(),owner=await env.DB.prepare(`SELECT a.id FROM staff_accounts a
 JOIN staff_owner_binding o ON o.account_id=a.id AND o.singleton=1
 WHERE a.id=?1 AND a.role='admin' AND a.status='active'`).bind(accountId).first();
 if(!owner)throw new Error('Current active OWNER required');
 const factor=await env.DB.prepare('SELECT account_id FROM admin_mfa_factors WHERE account_id=?1').bind(accountId).first();
 if(factor&&!reset)throw new Error('MFA already enrolled; explicit protected reset required');
 const code=randomToken('bootstrap'),hash=await digest('mfa-bootstrap',code),statements=[];
 if(reset){
  statements.push(env.DB.prepare('UPDATE staff_accounts SET token_version=token_version+1,updated_at=?1 WHERE id=?2').bind(now,accountId));
  statements.push(env.DB.prepare('DELETE FROM admin_mfa_factors WHERE account_id=?1').bind(accountId));
  statements.push(env.DB.prepare('DELETE FROM admin_mfa_recovery WHERE account_id=?1').bind(accountId));
 }
 statements.push(env.DB.prepare('UPDATE staff_sessions SET revoked_at=COALESCE(revoked_at,?1) WHERE account_id=?2').bind(now,accountId));
 statements.push(env.DB.prepare('DELETE FROM admin_mfa_challenges WHERE account_id=?1').bind(accountId));
 statements.push(env.DB.prepare(`INSERT INTO admin_mfa_bootstrap(account_id,digest,expires_at) VALUES(?1,?2,?3)
 ON CONFLICT(account_id) DO UPDATE SET digest=excluded.digest,expires_at=excluded.expires_at,attempts=0,enrollment_digest=NULL,consumed_at=NULL`).bind(accountId,hash,now+BOOTSTRAP_TTL));
 statements.push(env.DB.prepare(`INSERT INTO audit_events(id,actor_account_id,action,target_type,target_id,outcome,created_at)
 VALUES(?1,?2,?3,'owner_mfa',?2,'success',?4)`).bind(crypto.randomUUID(),accountId,reset?'admin.mfa.control_plane_reset':'admin.mfa.bootstrap_created',now));
 await env.DB.batch(statements);
 return {bootstrapCode:code,expiresAt:now+BOOTSTRAP_TTL};
}
