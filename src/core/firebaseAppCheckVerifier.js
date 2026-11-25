// =========================================
// FIREBASE APP CHECK TOKEN VERIFIER
// =========================================
//
// Custom backend verification for the
// X-Firebase-AppCheck token.
// =========================================

const encoder =
  new TextEncoder();

const decoder =
  new TextDecoder();

const APP_CHECK_JWKS_URL =
  "https://firebaseappcheck.googleapis.com/v1/jwks";

const MAX_TOKEN_LENGTH =
  16 * 1024;

const MAX_CACHE_SECONDS =
  6 * 60 * 60;

let keyCache = {
  expiresAtMs: 0,
  byKid: new Map()
};


function clean(
  value
) {

  return String(
    value ?? ""
  )
    .trim();
}


function base64UrlToBytes(
  value
) {

  const text =
    clean(
      value
    );


  if (
    !text
    ||
    !/^[A-Za-z0-9_-]+$/.test(
      text
    )
  ) {

    throw new Error(
      "invalid app check encoding"
    );
  }


  let base64 =
    text
      .replace(
        /-/g,
        "+"
      )
      .replace(
        /_/g,
        "/"
      );


  const remainder =
    base64.length % 4;


  if (remainder === 2) {

    base64 += "==";

  } else if (
    remainder === 3
  ) {

    base64 += "=";

  } else if (
    remainder !== 0
  ) {

    throw new Error(
      "invalid app check encoding"
    );
  }


  const binary =
    atob(
      base64
    );


  const bytes =
    new Uint8Array(
      binary.length
    );


  for (
    let index = 0;
    index < binary.length;
    index++
  ) {

    bytes[index] =
      binary.charCodeAt(
        index
      );
  }


  return bytes;
}


function parseJsonPart(
  value
) {

  const parsed =
    JSON.parse(
      decoder.decode(
        base64UrlToBytes(
          value
        )
      )
    );


  if (
    !parsed
    ||
    typeof parsed !==
      "object"
    ||
    Array.isArray(
      parsed
    )
  ) {

    throw new Error(
      "invalid app check json"
    );
  }


  return parsed;
}


function requireProjectNumber(
  env
) {

  const projectNumber =
    clean(
      env?.FIREBASE_PROJECT_NUMBER
    );


  if (
    !/^[0-9]{6,20}$/.test(
      projectNumber
    )
  ) {

    throw new Error(
      "firebase app check is not configured"
    );
  }


  return projectNumber;
}


function parseMaxAgeSeconds(
  value
) {

  const match =
    clean(
      value
    )
      .match(
        /(?:^|,)\s*max-age=(\d+)\s*(?:,|$)/i
      );


  if (!match) {

    return 300;
  }


  const seconds =
    Number(
      match[1]
    );


  if (
    !Number.isSafeInteger(
      seconds
    )
    ||
    seconds <= 0
  ) {

    return 300;
  }


  return Math.min(
    seconds,
    MAX_CACHE_SECONDS
  );
}


async function fetchKeys(
  fetchImpl,
  nowMs
) {

  if (
    keyCache.byKid.size > 0
    &&
    keyCache.expiresAtMs >
      nowMs
  ) {

    return keyCache.byKid;
  }


  const response =
    await fetchImpl(
      APP_CHECK_JWKS_URL,
      {
        method:
          "GET",

        headers: {
          Accept:
            "application/json"
        }
      }
    );


  if (
    !response
    ||
    response.ok !==
      true
  ) {

    throw new Error(
      "app check keys unavailable"
    );
  }


  const body =
    await response.json();


  if (
    !body
    ||
    !Array.isArray(
      body.keys
    )
  ) {

    throw new Error(
      "invalid app check keys"
    );
  }


  const byKid =
    new Map();


  for (
    const key of body.keys
  ) {

    const kid =
      clean(
        key?.kid
      );


    if (
      !kid
      ||
      key?.kty !==
        "RSA"
    ) {

      continue;
    }


    byKid.set(
      kid,
      key
    );
  }


  if (
    byKid.size === 0
  ) {

    throw new Error(
      "app check keys are empty"
    );
  }


  keyCache = {
    byKid,
    expiresAtMs:
      nowMs +
      (
        parseMaxAgeSeconds(
          response.headers?.get?.(
            "cache-control"
          )
        ) *
        1000
      )
  };


  return byKid;
}


async function verifySignature(
  encodedHeader,
  encodedPayload,
  encodedSignature,
  jwk
) {

  const key =
    await crypto.subtle.importKey(
      "jwk",
      jwk,
      {
        name:
          "RSASSA-PKCS1-v1_5",

        hash:
          "SHA-256"
      },
      false,
      [
        "verify"
      ]
    );


  return crypto.subtle.verify(
    {
      name:
        "RSASSA-PKCS1-v1_5"
    },
    key,
    base64UrlToBytes(
      encodedSignature
    ),
    encoder.encode(
      `${encodedHeader}.${encodedPayload}`
    )
  );
}


export async function verifyFirebaseAppCheckToken(
  env,
  token,
  options = {}
) {

  const normalized =
    clean(
      token
    );


  if (
    !normalized
    ||
    normalized.length >
      MAX_TOKEN_LENGTH
  ) {

    throw new Error(
      "invalid app check token"
    );
  }


  const parts =
    normalized.split(
      "."
    );


  if (
    parts.length !== 3
  ) {

    throw new Error(
      "invalid app check token"
    );
  }


  const [
    encodedHeader,
    encodedPayload,
    encodedSignature
  ] =
    parts;


  const header =
    parseJsonPart(
      encodedHeader
    );


  const payload =
    parseJsonPart(
      encodedPayload
    );


  if (
    header.alg !==
      "RS256"
    ||
    header.typ !==
      "JWT"
  ) {

    throw new Error(
      "invalid app check header"
    );
  }


  const kid =
    clean(
      header.kid
    );


  if (!kid) {

    throw new Error(
      "invalid app check key"
    );
  }


  const projectNumber =
    requireProjectNumber(
      env
    );


  const nowMs =
    Number.isSafeInteger(
      options.nowMs
    )
      ? options.nowMs
      : Date.now();


  const nowSeconds =
    Math.floor(
      nowMs / 1000
    );


  const exp =
    Number(
      payload.exp
    );


  if (
    !Number.isSafeInteger(
      exp
    )
    ||
    exp <=
      nowSeconds
  ) {

    throw new Error(
      "expired app check token"
    );
  }


  const issuer =
    `https://firebaseappcheck.googleapis.com/${projectNumber}`;


  if (
    payload.iss !==
      issuer
  ) {

    throw new Error(
      "invalid app check issuer"
    );
  }


  const expectedAudience =
    `projects/${projectNumber}`;


  const audiences =
    Array.isArray(
      payload.aud
    )
      ? payload.aud
      : [
          payload.aud
        ];


  if (
    !audiences.includes(
      expectedAudience
    )
  ) {

    throw new Error(
      "invalid app check audience"
    );
  }


  const appId =
    clean(
      payload.sub
    );


  if (!appId) {

    throw new Error(
      "invalid app check subject"
    );
  }


  const configuredAppId =
    clean(
      env?.FIREBASE_DRIVER_APP_ID
    );


  if (
    configuredAppId
    &&
    appId !==
      configuredAppId
  ) {

    throw new Error(
      "invalid app check app"
    );
  }


  const fetchImpl =
    options.fetchImpl ??
    fetch;


  let keys =
    await fetchKeys(
      fetchImpl,
      nowMs
    );


  let jwk =
    keys.get(
      kid
    );


  if (!jwk) {

    keyCache = {
      expiresAtMs: 0,
      byKid: new Map()
    };


    keys =
      await fetchKeys(
        fetchImpl,
        nowMs
      );


    jwk =
      keys.get(
        kid
      );
  }


  if (!jwk) {

    throw new Error(
      "unknown app check key"
    );
  }


  const verified =
    await verifySignature(
      encodedHeader,
      encodedPayload,
      encodedSignature,
      jwk
    );


  if (!verified) {

    throw new Error(
      "invalid app check signature"
    );
  }


  return {
    projectNumber,
    appId,
    expiresAt:
      exp
  };
}


export function resetFirebaseAppCheckKeyCacheForTests() {

  keyCache = {
    expiresAtMs: 0,
    byKid: new Map()
  };
}
