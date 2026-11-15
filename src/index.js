import { purgeOwnerMfaEphemera } from './core/ownerMfaRepository.js';
import { ownerPhoneTestEnabled, ownerPhoneRequestPolicy } from './core/adminPhoneTestScope.js';
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
    let phoneTest;
    try { phoneTest=ownerPhoneTestEnabled(env); }
    catch { return json({ok:false,code:'admin_phone_scope_invalid',error:'service unavailable'},503); }
    const finish=response=>{
      if(!phoneTest)return response;
      const headers=new Headers(response.headers);headers.set('X-Transfer-Test-Scope','owner_phone');
      return new Response(response.body,{status:response.status,headers});
    };
    if(phoneTest){const denied=ownerPhoneRequestPolicy(req);if(denied)return finish(json({ok:false,...denied,error:'request unavailable'},denied.status));}
    try {
      return finish(await router(req, env, ctx));
    } catch {
      // Error objects may contain SQL parameters, request bodies or credentials.
      console.error("FATAL WORKER ERROR");
      return finish(json({ ok: false, error: "worker crash" }, 500));
    }
  },

  async scheduled(
    _event,
    env,
    ctx
  ) {
    // This explicit test scope must not run Driver/photo/support maintenance.
    if(ownerPhoneTestEnabled(env)){
      const task=purgeOwnerMfaEphemera(env).catch(()=>console.error('OWNER MFA CLEANUP ERROR'));
      if(ctx?.waitUntil){ctx.waitUntil(task);return;}await task;return;
    }
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
