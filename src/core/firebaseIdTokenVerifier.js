// =========================================
// FIREBASE ID TOKEN VERIFIER
// =========================================
//
// Verifies Firebase Authentication ID tokens
// without trusting any client-supplied phone,
// role or driver identifier.
//
// Public keys are fetched from Google's JWK
// endpoint for securetoken service account.
// Raw tokens are never logged or persisted.
// =========================================

const encoder =
  new TextEncoder();

const decoder =
  new TextDecoder();

const FIREBASE_JWK_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

const DEFAULT_AUTH_MAX_AGE_SECONDS =
  5 * 60;

const MAX_TOKEN_LENGTH =
  16 * 1024;

const MAX_KEY_CACHE_SECONDS =
  24 * 60 * 60;

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
      "invalid firebase token encoding"
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
      "invalid firebase token encoding"
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

  const bytes =
    base64UrlToBytes(
      value
    );


  const text =
    decoder.decode(
      bytes
    );


  const parsed =
    JSON.parse(
      text
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
      "invalid firebase token json"
    );
  }


  return parsed;
}


function requireProjectId(
  env
) {

  const projectId =
    clean(
      env?.FIREBASE_PROJECT_ID
    );


  if (
    !/^[a-z0-9][a-z0-9-]{2,98}[a-z0-9]$/i.test(
      projectId
    )
  ) {

    throw new Error(
      "firebase project is not configured"
    );
  }


  return projectId;
}


function requirePositiveInteger(
  value,
  name
) {

  const number =
    Number(
      value
    );


  if (
    !Number.isSafeInteger(
      number
    )
    ||
    number <= 0
  ) {

    throw new Error(
      `invalid firebase ${name}`
    );
  }


  return number;
}


function requireAuthMaxAge(
  env
) {

  const configured =
    clean(
      env?.FIREBASE_AUTH_MAX_AGE_SECONDS
    );


  if (!configured) {

    return DEFAULT_AUTH_MAX_AGE_SECONDS;
  }


  const seconds =
    Number(
      configured
    );


  if (
    !Number.isSafeInteger(
      seconds
    )
    ||
    seconds < 60
    ||
    seconds > 60 * 60
  ) {

    throw new Error(
      "invalid firebase auth max age"
    );
  }


  return seconds;
}


function parseMaxAgeSeconds(
  value
) {

  const text =
    clean(
      value
    );


  const match =
    text.match(
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
    MAX_KEY_CACHE_SECONDS
  );
}


async function fetchPublicKeys(
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
      FIREBASE_JWK_URL,
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
      "firebase public keys unavailable"
    );
  }


  const body =
    await response.json();


  if (
    !body
    ||
    typeof body !==
      "object"
    ||
    !Array.isArray(
      body.keys
    )
  ) {

    throw new Error(
      "invalid firebase public keys"
    );
  }


  const byKid =
    new Map();


  for (
    const key of body.keys
  ) {

    if (
      !key
      ||
      typeof key !==
        "object"
      ||
      Array.isArray(
        key
      )
    ) {

      continue;
    }


    const kid =
      clean(
        key.kid
      );


    if (
      !kid
      ||
      key.kty !==
        "RSA"
      ||
      key.alg !==
        "RS256"
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
      "firebase public keys are empty"
    );
  }


  const maxAgeSeconds =
    parseMaxAgeSeconds(
      response.headers?.get?.(
        "cache-control"
      )
    );


  keyCache = {
    byKid,
    expiresAtMs:
      nowMs +
      (
        maxAgeSeconds *
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


export async function digestFirebaseIdToken(
  token
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
      "invalid firebase id token"
    );
  }


  const digest =
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        encoder.encode(
          normalized
        )
      )
    );


  let binary =
    "";


  for (
    const byte of digest
  ) {

    binary +=
      String.fromCharCode(
        byte
      );
  }


  return btoa(
    binary
  )
    .replace(
      /\+/g,
      "-"
    )
    .replace(
      /\//g,
      "_"
    )
    .replace(
      /=+$/g,
      ""
    );
}


export async function verifyFirebaseIdToken(
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
      "invalid firebase id token"
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
      "invalid firebase id token"
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
  ) {

    throw new Error(
      "invalid firebase token algorithm"
    );
  }


  const kid =
    clean(
      header.kid
    );


  if (!kid) {

    throw new Error(
      "invalid firebase token key"
    );
  }


  const projectId =
    requireProjectId(
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
    requirePositiveInteger(
      payload.exp,
      "exp"
    );


  const iat =
    requirePositiveInteger(
      payload.iat,
      "iat"
    );


  const authTime =
    requirePositiveInteger(
      payload.auth_time,
      "auth_time"
    );


  if (
    exp <= nowSeconds
    ||
    iat > nowSeconds
    ||
    authTime > nowSeconds
  ) {

    throw new Error(
      "invalid firebase token time"
    );
  }


  const maxAuthAge =
    requireAuthMaxAge(
      env
    );


  if (
    nowSeconds -
      authTime >
      maxAuthAge
  ) {

    throw new Error(
      "firebase authentication is too old"
    );
  }


  if (
    payload.aud !==
      projectId
  ) {

    throw new Error(
      "invalid firebase token audience"
    );
  }


  const expectedIssuer =
    `https://securetoken.google.com/${projectId}`;


  if (
    payload.iss !==
      expectedIssuer
  ) {

    throw new Error(
      "invalid firebase token issuer"
    );
  }


  const uid =
    clean(
      payload.sub
    );


  if (
    !uid
    ||
    uid.length > 128
  ) {

    throw new Error(
      "invalid firebase uid"
    );
  }


  const firebaseClaim =
    payload.firebase;


  if (
    !firebaseClaim
    ||
    typeof firebaseClaim !==
      "object"
    ||
    Array.isArray(
      firebaseClaim
    )
    ||
    firebaseClaim
      .sign_in_provider !==
      "phone"
  ) {

    throw new Error(
      "firebase phone authentication required"
    );
  }


  const phoneNumber =
    clean(
      payload.phone_number
    );


  if (
    !/^\+[1-9][0-9]{7,14}$/.test(
      phoneNumber
    )
  ) {

    throw new Error(
      "invalid firebase phone number"
    );
  }


  const fetchImpl =
    options.fetchImpl ??
    fetch;


  const keys =
    await fetchPublicKeys(
      fetchImpl,
      nowMs
    );


  const jwk =
    keys.get(
      kid
    );


  if (!jwk) {

    // Force a refresh once when Google has
    // rotated keys but the cache is still
    // inside its previous max-age window.
    keyCache = {
      expiresAtMs: 0,
      byKid: new Map()
    };


    const refreshed =
      await fetchPublicKeys(
        fetchImpl,
        nowMs
      );


    const rotatedKey =
      refreshed.get(
        kid
      );


    if (!rotatedKey) {

      throw new Error(
        "unknown firebase token key"
      );
    }


    const verified =
      await verifySignature(
        encodedHeader,
        encodedPayload,
        encodedSignature,
        rotatedKey
      );


    if (!verified) {

      throw new Error(
        "invalid firebase token signature"
      );
    }

  } else {

    const verified =
      await verifySignature(
        encodedHeader,
        encodedPayload,
        encodedSignature,
        jwk
      );


    if (!verified) {

      throw new Error(
        "invalid firebase token signature"
      );
    }
  }


  return {
    projectId,
    uid,
    phoneNumber,
    issuedAt:
      iat,
    authTime,
    expiresAt:
      exp
  };
}


export function resetFirebasePublicKeyCacheForTests() {

  keyCache = {
    expiresAtMs: 0,
    byKid: new Map()
  };
}
