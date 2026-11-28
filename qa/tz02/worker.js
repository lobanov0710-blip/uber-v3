import { passengerOrderStatusV2 } from '../../src/core/passengerOrderStatusV2.js';
import { json } from '../../src/core/utils.js';

const originPattern = /^https:\/\/uber-v3-tz02-qa\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.workers\.dev$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (env.APP_ENV !== 'staging' || env.ADMIN_PHONE_TEST_ONLY !== undefined
        || !originPattern.test(env.TZ02_QA_WORKER_ORIGIN ?? '')
        || url.origin !== env.TZ02_QA_WORKER_ORIGIN || url.pathname !== '/v2/order-status') {
      return json({ ok: false, error: 'not found' }, 404);
    }
    try {
      return await passengerOrderStatusV2(request, env);
    } catch {
      return json({ ok: false, error: 'order read unavailable' }, 500);
    }
  }
};
