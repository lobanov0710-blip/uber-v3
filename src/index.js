import router from "./router.js";
import { json } from "./core/utils.js";

export default {
  async fetch(req, env, ctx) {
    try {
      return await router(req, env, ctx);
    } catch {
      // Error objects may contain SQL parameters, request bodies or credentials.
      console.error("FATAL WORKER ERROR");
      return json({ ok: false, error: "worker crash" }, 500);
    }
  }
};
