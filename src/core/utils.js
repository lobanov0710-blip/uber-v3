// =========================
// CORS
// =========================

export const cors = {

  "Access-Control-Allow-Origin":
    "*",

  "Access-Control-Allow-Headers":
    "Content-Type, Authorization",

  "Access-Control-Allow-Methods":
    "GET, POST, PATCH, OPTIONS",

  "Access-Control-Max-Age":
    "86400"
};


// =========================
// JSON RESPONSE
// =========================

export function json(
  data,
  status = 200,
  headers = {}
) {

  return new Response(
    JSON.stringify(data),
    {
      status,

      headers: {
        ...cors,
        ...headers,

        "Content-Type":
          "application/json; charset=utf-8"
      }
    }
  );
}


// =========================
// SAFE JSON
// =========================

export async function safeJson(
  request
) {

  try {

    return await request.json();

  } catch (error) {

    return {};
  }
}