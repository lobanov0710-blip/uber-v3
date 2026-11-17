import { adminCan,resolveAdminAccess } from './adminAuthorization.js';
const positive=v=>Number.isSafeInteger(v)&&v>0;
const fail=(status,code)=>({ok:false,status,error:'forbidden',code});
const ownerExists=`EXISTS(SELECT 1 FROM staff_owner_binding o WHERE o.singleton=1 AND o.account_id=a.id)`;
const sqlNow=`MAX(?4,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))`;
// Fixed, server-owned SQL. The first six bindings always describe the current
// authenticated principal; payload role, permission and MFA booleans are ignored.
export const authorized=`EXISTS(SELECT 1 FROM staff_accounts a JOIN staff_sessions s ON s.account_id=a.id
 WHERE a.id=?1 AND s.id=?2 AND a.role='admin' AND a.status='active' AND a.token_version=?3
 AND (a.locked_until IS NULL OR a.locked_until<=?4) AND s.revoked_at IS NULL
 AND s.replaced_by_session_id IS NULL AND s.expires_at>${sqlNow}
 AND ((${ownerExists} AND EXISTS(SELECT 1 FROM admin_mfa_session_families e
   JOIN admin_mfa_factors f ON f.account_id=e.account_id AND f.revision=e.factor_revision
   WHERE e.account_id=a.id AND e.family_id=s.family_id AND e.token_version=a.token_version
   AND e.verified_at<=?4 AND f.enabled_at<=e.verified_at AND e.expires_at>${sqlNow} AND e.expires_at<=s.expires_at))
 OR (?6=0 AND NOT ${ownerExists} AND EXISTS(SELECT 1 FROM staff_permissions p
   WHERE p.account_id=a.id AND lower(trim(p.permission))=?5))))`;
export function prepare(env,sql,args){
  const n=Math.max(0,...[...sql.matchAll(/\?(\d+)/g)].map(m=>Number(m[1])));
  return env.DB.prepare(sql).bind(...args.slice(0,n));
}
export async function context(env,user,permission,options,ownerOnly=false){
  if(user?.role!=='admin'||typeof user.sessionId!=='string'||!positive(user.tokenVersion))return {error:fail(403,'admin_role_required')};
  const access=await resolveAdminAccess(env,user);
  if(!access.ok||!adminCan(access,permission)||(ownerOnly&&!access.isOwner))return {error:fail(403,ownerOnly?'owner_required':'permission_required')};
  if(access.isOwner&&(options.mfa?.required!==true||options.mfa?.verified!==true))return {error:fail(403,'owner_mfa_required')};
  return {args:[user.id,user.sessionId,user.tokenVersion,Date.now(),permission,ownerOnly?1:0],requestId:options.requestId??('req_'+crypto.randomUUID())};
}
