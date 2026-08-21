import router from "./router.js";

export { SocketHub } from "./ws/SocketHub.js";

export default {
  async fetch(req, env, ctx) {
    try {
      return await router(req, env, ctx);
    } catch (e) {
      console.error("FATAL WORKER ERROR:", e);

      return new Response(
        JSON.stringify({
          ok: false,
          error: "worker crash",
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }
  },
};