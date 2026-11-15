// Explicit owner-approved, temporary STAGING scope. Production defaults are unchanged.
export const ADMIN_PHONE_HOST = 'uber-v3-staging.lobanov0710.workers.dev';
export const OWNER_PHONE_DRIVER = 'staff_owner_phone_fixture';
export async function phoneFixtureAllowed(env,id){
  if(!ownerPhoneTestEnabled(env))return true;
  if(id!==OWNER_PHONE_DRIVER)return false;
  return !!await env.DB.prepare(`SELECT a.id FROM staff_accounts a WHERE a.id=?1 AND a.role='driver' AND a.status='disabled'
    AND a.login='owner-phone-fixture' AND EXISTS(SELECT 1 FROM audit_events e WHERE e.action='admin.phone_fixture_created' AND e.target_id=a.id)`)
    .bind(id).first();
}
export function ownerPhoneTestEnabled(env) {
  if (env?.ADMIN_PHONE_TEST_ONLY === undefined) return false;
  if (env.ADMIN_PHONE_TEST_ONLY !== 'true' || env.APP_ENV !== 'staging') throw new Error('Invalid OWNER phone-test scope');
  return true;
}
export function ownerPhoneRequestPolicy(request) {
  const url=new URL(request.url);
  if(url.protocol!=='https:'||url.hostname!==ADMIN_PHONE_HOST||url.port)return {status:503,code:'admin_phone_target_mismatch'};
  const path=url.pathname;
  let method;
  if(/^\/staff\/(login|refresh|logout)$/.test(path)||/^\/v1\/admin\/mfa\/(totp\/verify|recovery\/verify|enrollment\/(start|confirm))$/.test(path))method='POST';
  else if(/^\/v1\/admin\/(me|registrations)$/.test(path)||new RegExp('^/v1/admin/registrations/'+OWNER_PHONE_DRIVER+'$').test(path))method='GET';
  else if(new RegExp('^/v1/admin/registrations/'+OWNER_PHONE_DRIVER+'/review(/complete|/items/(document|vehicle|vehicle_photo)/[A-Za-z0-9_-]{8,120})?$').test(path))method='POST';
  else return {status:404,code:'admin_phone_route_unavailable'};
  return request.method===method?null:{status:405,code:'method_not_allowed'};
}
