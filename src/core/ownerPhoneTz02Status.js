import { ADMIN_PHONE_HOST } from './adminPhoneTestScope.js';
import { passengerOrderStatusV2 } from './passengerOrderStatusV2.js';

export const TZ02_ORDER_ID = 'tz02_qa_synthetic_order';
const HOUR = 60 * 60 * 1000;
const secretPattern = /^[a-f0-9]{64}$/;

export function ownerPhoneTz02Status(req, env, now = Date.now()) {
  if (env.APP_ENV !== 'staging' || env.ADMIN_PHONE_TEST_ONLY !== 'true'
      || req.method !== 'POST' || req.url !== `https://${ADMIN_PHONE_HOST}/v2/order-status`) {
    return null;
  }

  const until = env.TZ02_QA_UNTIL;
  const expires = typeof until === 'string' && /^\d{13}$/.test(until) ? Number(until) : 0;
  const hmac = env.TZ02_QA_HMAC;
  const passenger = env.TZ02_QA_PASSENGER;
  if (expires <= now || expires - now > 24 * HOUR
      || typeof hmac !== 'string' || !secretPattern.test(hmac)
      || typeof passenger !== 'string' || !secretPattern.test(passenger)
      || hmac === passenger
      || [env.PROXY_HMAC_SECRET, env.PASSENGER_ORDER_SECRET, env.JWT_SECRET, env.ADMIN_MFA_ENCRYPTION_KEY]
        .some(secret => secret === hmac || secret === passenger)) {
    return null;
  }

  return passengerOrderStatusV2(req, {
    DB: env.DB,
    PASSENGER_ASSIGNMENT_V2_ENABLED: 'true',
    PROXY_HMAC_SECRET: hmac,
    PASSENGER_ORDER_SECRET: passenger
  }, TZ02_ORDER_ID);
}
