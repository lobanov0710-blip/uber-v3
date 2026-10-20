import router from "./router.js";


export default {

  async fetch(
    req,
    env,
    ctx
  ) {

    try {

      return await router(
        req,
        env,
        ctx
      );

    } catch (
      error
    ) {

      console.error(
        "FATAL WORKER ERROR:",
        error
      );

      return new Response(
        JSON.stringify(
          {
            ok: false,
            error:
              "worker crash"
          }
        ),
        {
          status: 500,

          headers: {
            "Content-Type":
              "application/json; charset=utf-8",

            "Access-Control-Allow-Origin":
              "*"
          }
        }
      );
    }
  }
};