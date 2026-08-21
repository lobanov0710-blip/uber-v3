const enc = new TextEncoder();

function b64(obj) {
  return btoa(JSON.stringify(obj));
}

function ub64(str) {
  return JSON.parse(atob(str));
}

export async function signJWT(secret, payload) {
  const header = b64({ alg: "HS256", typ: "JWT" });

  const body = b64({
    ...payload,
    iat: Date.now(),
    exp: Date.now() + 86400000
  });

  const data = `${header}.${body}`;

  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));

  return `${data}.${btoa(String.fromCharCode(...new Uint8Array(sig)))}`;
}

export async function verifyJWT(secret, token) {
  try {
    const [h, b, s] = token.split(".");

    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );

    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      Uint8Array.from(atob(s), c => c.charCodeAt(0)),
      enc.encode(`${h}.${b}`)
    );

    if (!valid) return null;

    return ub64(b);
  } catch {
    return null;
  }
}