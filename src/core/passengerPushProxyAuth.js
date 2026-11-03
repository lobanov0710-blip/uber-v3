// PUSH-01F: nonce-bound HMAC version 2 for ONLY the new passenger push
// endpoints. The frozen API v1 verifyProxyRequest() remains unchanged.
// This verifier consumes each signed nonce atomically in authoritative D1.
// No staff JWT, passenger access token, FCM token or PII is logged.
const PATHS = new Set([
  "/passenger/push-grant",
  "/passenger/push-device"
]);
const WINDOW_SECONDS = 300;
const NONCE_RETENTION_MS = 20 * 60 * 1000;
const BODY_LIMIT_BYTES = 8192;
const rejected = () => ({ ok: false, status: 403, error: "forbidden" });
const unavailable = () => ({
  ok: false, status: 503, error: "passenger push authentication unavailable"
});

function hexBytes(hex) {
  if (typeof hex !== "string" || !/^[0-9a-f]{64}$/.test(hex)) return null;
  return new Uint8Array(hex.match(/.{2}/g).map(two => Number.parseInt(two, 16)));
}

export async function verifyPassengerPushProxyRequest(req, env, expectedPath,
  nowMs = Date.now()) {
  if (!(req instanceof Request) || !PATHS.has(expectedPath)
      || new URL(req.url).pathname !== expectedPath
      || !["POST", "DELETE"].includes(req.method)
      || (expectedPath === "/passenger/push-grant" && req.method !== "POST")
      || !Number.isSafeInteger(nowMs) || nowMs <= 0) {
    return rejected();
  }
  const timestamp = req.headers.get("X-Proxy-Timestamp");
  const nonce = req.headers.get("X-Proxy-Nonce");
  const signature = hexBytes(req.headers.get("X-Proxy-Signature"));
  if (!timestamp || !/^\d{10}$/.test(timestamp)
      || !nonce || !/^[0-9a-f]{32}$/.test(nonce) || !signature) {
    return rejected();
  }
  const seconds = Number(timestamp);
  if (!Number.isSafeInteger(seconds)
      || Math.abs(Math.floor(nowMs / 1000) - seconds) > WINDOW_SECONDS) {
    return rejected();
  }
  const secret = env?.PROXY_HMAC_SECRET;
  if (typeof secret !== "string" || secret.length < 32) return unavailable();

  let body;
  try {
    body = await req.clone().text();
  } catch {
    return rejected();
  }
  if (new TextEncoder().encode(body).length > BODY_LIMIT_BYTES) {
    return { ok: false, status: 413, error: "request too large" };
  }
  const canonical = [
    "PASSENGER-PUSH-V2", req.method, timestamp, expectedPath, nonce, body
  ].join("\n");
  let verified = false;
  try {
    const key = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" }, false, ["verify"]
    );
    verified = await crypto.subtle.verify(
      "HMAC", key, signature, new TextEncoder().encode(canonical)
    );
  } catch {
    return unavailable();
  }
  if (!verified) return rejected();

  // A cryptographically valid request must also claim a unique nonce
  // before any grant issuance, registration or revoke. This is a D1
  // UNIQUE constraint and works under concurrent identical requests.
  if (!env?.DB || typeof env.DB.prepare !== "function") return unavailable();
  try {
    const result = await env.DB.prepare(`
      INSERT OR IGNORE INTO passenger_push_proxy_nonces(nonce, seen_at)
      VALUES (?1, ?2)
    `).bind(nonce, nowMs).run();
    if (result?.success !== true
        || !Number.isSafeInteger(result?.meta?.changes)
        || result.meta.changes < 0 || result.meta.changes > 1) {
      return unavailable();
    }
    return result.meta.changes === 1 ? { ok: true } : rejected();
  } catch {
    return unavailable();
  }
}

// Maintenance is a trusted, explicit operation; no HTTP or cron is created.
// Nonces older than 20 minutes are safe to remove because a signed timestamp
// is already rejected beyond +/- 5 minutes.
export async function prunePassengerPushProxyNonces(env, nowMs = Date.now()) {
  if (!env?.DB || typeof env.DB.prepare !== "function"
      || !Number.isSafeInteger(nowMs)
      || nowMs <= NONCE_RETENTION_MS) {
    throw new Error("Passenger push replay cache unavailable");
  }
  const result = await env.DB.prepare(`
    DELETE FROM passenger_push_proxy_nonces WHERE seen_at <= ?1
  `).bind(nowMs - NONCE_RETENTION_MS).run();
  if (result?.success !== true
      || !Number.isSafeInteger(result?.meta?.changes)
      || result.meta.changes < 0) {
    throw new Error("Passenger push replay cache prune failed");
  }
  return { purged: result.meta.changes };
}
