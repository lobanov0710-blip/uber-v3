import { purgeOwnerMfaEphemera } from './core/ownerMfaRepository.js';
import router from "./router.js";
import { json } from "./core/utils.js";

import {
  runMonthlyPhotoControlDueGeneration
} from "./core/vehiclePhotoControlService.js";

import {
  runSupportChatRetention
} from "./core/supportCaseLifecycleService.js";

export default {
  async fetch(req, env, ctx) {
    try {
      return await router(req, env, ctx);
    } catch {
      // Error objects may contain SQL parameters, request bodies or credentials.
      console.error("FATAL WORKER ERROR");
      return json({ ok: false, error: "worker crash" }, 500);
    }
  },

  async scheduled(
    _event,
    env,
    ctx
  ) {
    const task =
      Promise.all([
        purgeOwnerMfaEphemera(env).catch(() => { console.error('OWNER MFA CLEANUP ERROR'); }),
        runMonthlyPhotoControlDueGeneration(
          env
        )
          .catch(
            () => {
              console.error(
                "PHOTO CONTROL DUE GENERATION ERROR"
              );
            }
          ),

        runSupportChatRetention(
          env
        )
          .catch(
            () => {
              console.error(
                "SUPPORT CHAT RETENTION ERROR"
              );
            }
          )
      ]);

    if (
      ctx &&
      typeof ctx.waitUntil ===
        "function"
    ) {
      ctx.waitUntil(
        task
      );
      return;
    }

    await task;
  }
};
