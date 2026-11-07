import router from "./router.js";
import { json } from "./core/utils.js";

import {
  runMonthlyPhotoControlDueGeneration
} from "./core/vehiclePhotoControlService.js";

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
      runMonthlyPhotoControlDueGeneration(
        env
      )
        .catch(
          () => {
            console.error(
              "PHOTO CONTROL DUE GENERATION ERROR"
            );
          }
        );

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
