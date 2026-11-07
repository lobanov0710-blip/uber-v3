// =========================
// CORS
// =========================

export const cors = {

  "Access-Control-Allow-Origin":
    "*",

  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, Idempotency-Key, X-Firebase-AppCheck",

  "Access-Control-Allow-Methods":
    "GET, POST, PUT, PATCH, DELETE, OPTIONS",

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

  const responseHeaders = new Headers(cors);
  new Headers(headers).forEach((value, name) => responseHeaders.set(name, value));
  responseHeaders.set("Content-Type", "application/json; charset=utf-8");
  responseHeaders.set("Cache-Control", "no-store");
  responseHeaders.set("X-Content-Type-Options", "nosniff");

  return new Response(
    JSON.stringify(data),
    {
      status,

      headers: responseHeaders
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
