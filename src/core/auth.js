const encoder = new TextEncoder();
const decoder = new TextDecoder();

const JWT_ALGORITHM = "HS256";
const JWT_TYPE = "JWT";

const DEFAULT_TTL_SECONDS =
  24 * 60 * 60;


// =========================
// BASE64 URL
// =========================

function bytesToBase64Url(bytes) {

  let binary = "";

  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}


function base64UrlToBytes(value) {

  if (
    typeof value !== "string" ||
    !value
  ) {
    throw new Error(
      "Invalid base64url value"
    );
  }

  let base64 = value
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  const remainder =
    base64.length % 4;

  if (remainder === 2) {
    base64 += "==";
  } else if (remainder === 3) {
    base64 += "=";
  } else if (remainder !== 0) {
    throw new Error(
      "Invalid base64url padding"
    );
  }

  const binary =
    atob(base64);

  const bytes =
    new Uint8Array(
      binary.length
    );

  for (
    let i = 0;
    i < binary.length;
    i++
  ) {
    bytes[i] =
      binary.charCodeAt(i);
  }

  return bytes;
}


function objectToBase64Url(value) {

  const json =
    JSON.stringify(value);

  return bytesToBase64Url(
    encoder.encode(json)
  );
}


function base64UrlToObject(value) {

  const bytes =
    base64UrlToBytes(value);

  const json =
    decoder.decode(bytes);

  return JSON.parse(json);
}


// =========================
// SECRET
// =========================

function requireSecret(secret) {

  const value =
    String(secret || "");

  if (value.length < 32) {
    throw new Error(
      "JWT_SECRET is missing or too short"
    );
  }

  return value;
}


// =========================
// HMAC KEY
// =========================

async function importHmacKey(
  secret,
  usage
) {

  return crypto.subtle.importKey(
    "raw",
    encoder.encode(
      requireSecret(secret)
    ),
    {
      name: "HMAC",
      hash: "SHA-256"
    },
    false,
    [usage]
  );
}


// =========================
// SIGN JWT
// =========================

export async function signJWT(
  secret,
  payload,
  ttlSeconds = DEFAULT_TTL_SECONDS
) {

  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  ) {
    throw new Error(
      "JWT payload must be an object"
    );
  }

  const ttl =
    Number(ttlSeconds);

  if (
    !Number.isFinite(ttl) ||
    ttl <= 0
  ) {
    throw new Error(
      "Invalid JWT TTL"
    );
  }

  const now =
    Math.floor(
      Date.now() / 1000
    );

  const header = {
    alg: JWT_ALGORITHM,
    typ: JWT_TYPE
  };

  const body = {
    ...payload,
    iat: now,
    exp: now + Math.floor(ttl)
  };

  const encodedHeader =
    objectToBase64Url(header);

  const encodedBody =
    objectToBase64Url(body);

  const signingInput =
    `${encodedHeader}.${encodedBody}`;

  const key =
    await importHmacKey(
      secret,
      "sign"
    );

  const signatureBuffer =
    await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(
        signingInput
      )
    );

  const signature =
    bytesToBase64Url(
      new Uint8Array(
        signatureBuffer
      )
    );

  return (
    `${signingInput}.${signature}`
  );
}


// =========================
// VERIFY JWT
// =========================

export async function verifyJWT(
  secret,
  token
) {

  try {

    if (
      typeof token !== "string"
    ) {
      return null;
    }

    const parts =
      token
        .trim()
        .split(".");

    if (
      parts.length !== 3
    ) {
      return null;
    }

    const [
      encodedHeader,
      encodedBody,
      encodedSignature
    ] = parts;

    if (
      !encodedHeader ||
      !encodedBody ||
      !encodedSignature
    ) {
      return null;
    }

    // =========================
    // HEADER
    // =========================

    const header =
      base64UrlToObject(
        encodedHeader
      );

    if (
      !header ||
      header.alg !== JWT_ALGORITHM ||
      header.typ !== JWT_TYPE
    ) {
      return null;
    }

    // =========================
    // SIGNATURE
    // =========================

    const key =
      await importHmacKey(
        secret,
        "verify"
      );

    const signingInput =
      `${encodedHeader}.${encodedBody}`;

    const signature =
      base64UrlToBytes(
        encodedSignature
      );

    const valid =
      await crypto.subtle.verify(
        "HMAC",
        key,
        signature,
        encoder.encode(
          signingInput
        )
      );

    if (!valid) {
      return null;
    }

    // =========================
    // PAYLOAD
    // =========================

    const payload =
      base64UrlToObject(
        encodedBody
      );

    if (
      !payload ||
      typeof payload !== "object"
    ) {
      return null;
    }

    // =========================
    // TIME
    // =========================

    const now =
      Math.floor(
        Date.now() / 1000
      );

    const exp =
      Number(payload.exp);

    const iat =
      Number(payload.iat);

    if (
      !Number.isFinite(exp) ||
      !Number.isFinite(iat)
    ) {
      return null;
    }

    if (
      exp <= now
    ) {
      return null;
    }

    // Токен не должен быть
    // выпущен сильно "из будущего".
    if (
      iat > now + 60
    ) {
      return null;
    }

    return payload;

  } catch (error) {

    console.warn(
      "JWT VERIFY ERROR:",
      error
    );

    return null;
  }
}


// =========================
// BEARER TOKEN
// =========================

export function getBearerToken(
  request
) {

  const authorization =
    request?.headers?.get(
      "Authorization"
    );

  if (!authorization) {
    return null;
  }

  const match =
    authorization.match(
      /^Bearer\s+(.+)$/i
    );

  if (!match) {
    return null;
  }

  const token =
    String(
      match[1] || ""
    ).trim();

  return token || null;
}


// =========================
// AUTHENTICATE REQUEST
// =========================

export async function authenticateRequest(
  request,
  env
) {

  const token =
    getBearerToken(
      request
    );

  if (!token) {

    return {
      ok: false,
      status: 401,
      error:
        "authorization required"
    };
  }

  const payload =
    await verifyJWT(
      env?.JWT_SECRET,
      token
    );

  if (!payload) {

    return {
      ok: false,
      status: 401,
      error:
        "invalid or expired token"
    };
  }

  return {
    ok: true,
    token,
    user: payload
  };
}


// =========================
// ROLE CHECK
// =========================

export function hasRole(
  user,
  ...roles
) {

  if (
    !user ||
    !roles.length
  ) {
    return false;
  }

  const role =
    String(
      user.role || ""
    )
      .trim()
      .toLowerCase();

  return roles
    .map(item =>
      String(item)
        .trim()
        .toLowerCase()
    )
    .includes(role);
}