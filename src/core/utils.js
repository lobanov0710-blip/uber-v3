export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
};

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...cors,
      ...headers,
      "Content-Type": "application/json"
    }
  });
}

export async function safeJson(req) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}