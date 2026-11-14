import { signJWT } from './auth.js';
import { createRefreshToken } from './staffAuthCrypto.js';
import { STAFF_ACCESS_TTL_SECONDS, STAFF_REFRESH_TTL_MS } from './staffAuthPolicy.js';
import { randomToken,randomBytes,digest,base32,encryptSeed,decryptSeed,matchingCounter,recoveryCode,normalizeRecovery,assertMfaConfigured } from './ownerMfaCrypto.js';
import { CHALLENGE_TTL,quota,createChallenge,getChallenge,usableChallenge,recordFailure,reserveEnrollment,getEnrollment,activateEnrollment,consumeProofAndCreateSession,audit } from './ownerMfaRepository.js';

const error=(status=401)=>({ok:false,status,error:status===429?'authentication temporarily limited':status===503?'authentication unavailable':'authentication failed'});
export function mfaContext(context={}){
 const ip=context.ip;
 if(typeof ip!=='string'||ip.length>64||!((/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)&&ip.split('.').every(x=>Number(x)<=255))||(/^[0-9a-f:]+$/i.test(ip)&&ip.includes(':'))))return null;
 return {ip:ip.toLowerCase(),requestId:typeof context.requestId==='string'&&/^req_[a-f0-9-]{36}$/.test(context.requestId)?context.requestId:'req_'+crypto.randomUUID()};
}
function bodyShape(body,keys){return body&&typeof body==='object'&&!Array.isArray(body)&&Object.keys(body).length===keys.length&&keys.every(k=>typeof body[k]==='string');}
async function fail(env,c,hash,context,now,options={}){
 await recordFailure(env,{challengeDigest:hash,accountId:c?.account_id??null,...context,now,...options});return error();
}
export async function beginOwnerMfaLogin(env,account,context){
 const ctx=mfaContext(context);if(!ctx)return error(400);
 try{await assertMfaConfigured(env);}catch{return error(503);}
 const now=Date.now();if((await quota(env,account.id,ctx.ip,now)).blocked)return error(429);
 const token=randomToken('mfa'),hash=await digest('mfa-challenge',token);
 const created=await createChallenge(env,account,hash,now,ctx.requestId);if(!created)return error();
 return {ok:true,mfaRequired:true,challengeId:token,expiresAt:now+CHALLENGE_TTL,...(created.enrollmentRequired?{enrollmentRequired:true}:{})};
}
export async function startOwnerMfaEnrollment(env,body,context){
 const ctx=mfaContext(context);if(!ctx)return error(400);
 if(!bodyShape(body,['challengeId','bootstrapCode'])||!/^mfa_[A-Za-z0-9_-]{43}$/.test(body.challengeId)||body.bootstrapCode.length>100)return error(400);
 const now=Date.now(),hash=await digest('mfa-challenge',body.challengeId),c=await getChallenge(env,hash);
 if((await quota(env,c?.account_id,ctx.ip,now)).blocked)return error(429);
 if(!usableChallenge(c,now)||c.factor_revision!==null)return fail(env,c,hash,ctx,now,{bootstrap:true,replay:c?.consumed_at!=null});
 const seed=randomBytes(20),token=randomToken('enroll'),enrollmentDigest=await digest('mfa-enrollment',token);
 let encryptedSeed;try{encryptedSeed=await encryptSeed(env,c.account_id,seed);}catch{return error(503);}
 const success=await reserveEnrollment(env,{c,bootstrapDigest:await digest('mfa-bootstrap',body.bootstrapCode),enrollmentDigest,encryptedSeed,now:Date.now(),requestId:ctx.requestId,ip:ctx.ip});
 if(!success)return fail(env,c,hash,ctx,now,{bootstrap:true});
 return {ok:true,enrollmentId:token,secret:base32(seed),expiresAt:c.expires_at};
}
export async function confirmOwnerMfaEnrollment(env,body,context){
 const ctx=mfaContext(context);if(!ctx)return error(400);
 if(!bodyShape(body,['enrollmentId','code'])||!/^enroll_[A-Za-z0-9_-]{43}$/.test(body.enrollmentId)||body.code.length>80)return error(400);
 const now=Date.now(),hash=await digest('mfa-enrollment',body.enrollmentId),e=await getEnrollment(env,hash),c=e?await getChallenge(env,e.challenge_digest):null;
 if((await quota(env,c?.account_id,ctx.ip,now)).blocked)return error(429);
 if(!e||e.consumed_at!=null||e.expires_at<=now||!usableChallenge(c,now)||c.factor_revision!==null)return fail(env,c,c?.digest,ctx,now,{bootstrap:true,replay:e?.consumed_at!=null});
 let seed;try{seed=await decryptSeed(env,c.account_id,e.encrypted_seed);}catch{return error(503);}
 const counter=await matchingCounter(seed,body.code,now);
 if(counter===null)return fail(env,c,c.digest,ctx,now,{bootstrap:true});
 const codes=Array.from({length:10},()=>recoveryCode()),revision=randomToken('factor');
 const recoveryDigests=await Promise.all(codes.map(code=>digest('mfa-recovery',c.account_id+'|'+normalizeRecovery(code))));
 const activationTime=Date.now();
 if(Math.abs(counter-Math.floor(activationTime/30000))>1)return fail(env,c,c.digest,ctx,activationTime,{bootstrap:true});
 const activated=await activateEnrollment(env,{e,c,counter,revision,recoveryDigests,now:activationTime,requestId:ctx.requestId,ip:ctx.ip});
 if(!activated)return fail(env,c,c.digest,ctx,now,{bootstrap:true,replay:true});
 // No staff tokens: show recovery codes once, then require a fresh password + fresh TOTP login.
 return {ok:true,recoveryCodes:codes};
}
export async function verifyOwnerMfa(env,body,context,method='totp'){
 const ctx=mfaContext(context);if(!ctx)return error(400);
 const field=method==='totp'?'code':'recoveryCode';
 if(!['totp','recovery'].includes(method)||!bodyShape(body,['challengeId',field])||!/^mfa_[A-Za-z0-9_-]{43}$/.test(body.challengeId)||body[field].length>80)return error(400);
 const now=Date.now(),hash=await digest('mfa-challenge',body.challengeId),c=await getChallenge(env,hash);
 if((await quota(env,c?.account_id,ctx.ip,now)).blocked)return error(429);
 if(!usableChallenge(c,now)||!c.factor_revision)return fail(env,c,hash,ctx,now,{replay:c?.consumed_at!=null});
 let counter=null,recoveryDigest='';
 if(method==='totp'){
  let seed;try{seed=await decryptSeed(env,c.account_id,c.encrypted_seed);}catch{await audit(env,c.account_id,'admin.mfa.unavailable','failed',ctx.requestId,now);return error(503);}
  counter=await matchingCounter(seed,body.code,now);
  if(counter===null||counter<=c.last_counter)return fail(env,c,hash,ctx,now,{replay:counter!==null});
 }else{
  const normalized=normalizeRecovery(body.recoveryCode);if(normalized.length!==32)return fail(env,c,hash,ctx,now);
  recoveryDigest=await digest('mfa-recovery',c.account_id+'|'+normalized);
 }
 const claimedAt=Date.now();
 if(method==='totp'&&Math.abs(counter-Math.floor(claimedAt/30000))>1)return fail(env,c,hash,ctx,claimedAt);
 const session={id:'staff-session_'+crypto.randomUUID(),familyId:'staff-family_'+crypto.randomUUID(),expiresAt:claimedAt+STAFF_REFRESH_TTL_MS};
 const refresh=await createRefreshToken();session.refreshTokenHash=refresh.refreshTokenHash;
 const accessToken=await signJWT(env.JWT_SECRET,{sub:c.account_id,id:c.account_id,role:'admin',scope:'staff',tokenVersion:c.token_version,sid:session.id},STAFF_ACCESS_TTL_SECONDS);
 const consumed=await consumeProofAndCreateSession(env,{c,counter,recoveryDigest,session,now:claimedAt,method,requestId:ctx.requestId,ip:ctx.ip});
 if(!consumed)return fail(env,c,hash,ctx,now,{replay:true});
 return {ok:true,staff:{id:c.account_id,displayName:c.display_name,role:'admin'},accessToken,accessExpiresAt:(Math.floor(now/1000)+STAFF_ACCESS_TTL_SECONDS)*1000,refreshToken:refresh.refreshToken,refreshExpiresAt:session.expiresAt};
}
