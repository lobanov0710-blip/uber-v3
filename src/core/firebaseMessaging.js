// =========================================
// FIREBASE CLOUD MESSAGING HTTP v1
// =========================================
//
// Cloudflare Worker sender for data-only
// Android messages.
//
// Required Worker secrets:
// - FIREBASE_PROJECT_ID
// - FIREBASE_CLIENT_EMAIL
// - FIREBASE_PRIVATE_KEY
//
// The private key must never be logged.
// FCM registration tokens must never be
// logged or returned to clients.
// =========================================

const GOOGLE_TOKEN_URL =
  "https://oauth2.googleapis.com/token";

const FCM_SCOPE =
  "https://www.googleapis.com/auth/firebase.messaging";

const GOOGLE_TOKEN_AUDIENCE =
  GOOGLE_TOKEN_URL;


function requiredSecret(
  env,
  name
) {

  const value =
    String(
      env?.[name] ?? ""
    )
      .trim();


  if (!value) {

    throw new Error(
      `${name} is not configured`
    );
  }


  return value;
}


function base64UrlBytes(
  bytes
) {

  let binary =
    "";


  for (
    let index = 0;
    index < bytes.length;
    index += 1
  ) {

    binary +=
      String.fromCharCode(
        bytes[index]
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


function base64UrlText(
  text
) {

  return base64UrlBytes(
    new TextEncoder()
      .encode(
        text
      )
  );
}


function pemToPkcs8(
  value
) {

  const normalized =
    String(
      value ?? ""
    )
      .replace(
        /\\n/g,
        "\n"
      )
      .trim();


  const base64 =
    normalized
      .replace(
        "-----BEGIN PRIVATE KEY-----",
        ""
      )
      .replace(
        "-----END PRIVATE KEY-----",
        ""
      )
      .replace(
        /\s+/g,
        ""
      );


  if (!base64) {

    throw new Error(
      "Invalid Firebase private key"
    );
  }


  let binary;


  try {

    binary =
      atob(
        base64
      );

  } catch (
    error
  ) {

    throw new Error(
      "Invalid Firebase private key"
    );
  }


  const bytes =
    new Uint8Array(
      binary.length
    );


  for (
    let index = 0;
    index < binary.length;
    index += 1
  ) {

    bytes[index] =
      binary.charCodeAt(
        index
      );
  }


  return bytes.buffer;
}


async function signServiceAccountJwt(
  env,
  nowSeconds
) {

  const clientEmail =
    requiredSecret(
      env,
      "FIREBASE_CLIENT_EMAIL"
    );


  const privateKey =
    requiredSecret(
      env,
      "FIREBASE_PRIVATE_KEY"
    );


  const header =
    base64UrlText(
      JSON.stringify(
        {
          alg:
            "RS256",

          typ:
            "JWT"
        }
      )
    );


  const payload =
    base64UrlText(
      JSON.stringify(
        {
          iss:
            clientEmail,

          scope:
            FCM_SCOPE,

          aud:
            GOOGLE_TOKEN_AUDIENCE,

          iat:
            nowSeconds,

          exp:
            nowSeconds + 3600
        }
      )
    );


  const signingInput =
    `${header}.${payload}`;


  const cryptoKey =
    await crypto.subtle.importKey(
      "pkcs8",
      pemToPkcs8(
        privateKey
      ),
      {
        name:
          "RSASSA-PKCS1-v1_5",

        hash:
          "SHA-256"
      },
      false,
      [
        "sign"
      ]
    );


  const signature =
    await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      cryptoKey,
      new TextEncoder()
        .encode(
          signingInput
        )
    );


  return (
    signingInput
    +
    "."
    +
    base64UrlBytes(
      new Uint8Array(
        signature
      )
    )
  );
}


export async function getFirebaseAccessToken(
  env,
  fetchImpl = fetch
) {

  const nowSeconds =
    Math.floor(
      Date.now() / 1000
    );


  const assertion =
    await signServiceAccountJwt(
      env,
      nowSeconds
    );


  const body =
    new URLSearchParams(
      {
        grant_type:
          "urn:ietf:params:oauth:grant-type:jwt-bearer",

        assertion
      }
    );


  const response =
    await fetchImpl(
      GOOGLE_TOKEN_URL,
      {
        method:
          "POST",

        headers: {
          "Content-Type":
            "application/x-www-form-urlencoded"
        },

        body:
          body.toString()
      }
    );


  if (!response.ok) {

    throw new Error(
      `Firebase OAuth failed: ${response.status}`
    );
  }


  const json =
    await response.json();


  const accessToken =
    String(
      json?.access_token ?? ""
    )
      .trim();


  if (!accessToken) {

    throw new Error(
      "Firebase OAuth returned no access token"
    );
  }


  return accessToken;
}


function fcmErrorCode(
  body
) {

  const details =
    Array.isArray(
      body?.error?.details
    )
      ? body.error.details
      : [];


  for (
    const detail of details
  ) {

    const code =
      String(
        detail?.errorCode ?? ""
      )
        .trim();


    if (code) {
      return code;
    }
  }


  return "";
}


export async function sendFirebaseDataMessage(
  env,
  accessToken,
  fcmToken,
  data,
  fetchImpl = fetch
) {

  const projectId =
    requiredSecret(
      env,
      "FIREBASE_PROJECT_ID"
    );


  const token =
    String(
      fcmToken ?? ""
    )
      .trim();


  if (
    !token
    ||
    token.length > 4096
  ) {

    return {
      ok:
        false,

      status:
        0,

      errorCode:
        "INVALID_LOCAL_TOKEN"
    };
  }


  const response =
    await fetchImpl(
      `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`,
      {
        method:
          "POST",

        headers: {
          Authorization:
            `Bearer ${accessToken}`,

          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify(
            {
              message: {
                token,

                data,

                android: {
                  priority:
                    "high",

                  ttl:
                    "300s"
                }
              }
            }
          )
      }
    );


  let body =
    null;


  try {

    body =
      await response.json();

  } catch (
    error
  ) {

    body =
      null;
  }


  if (response.ok) {

    return {
      ok:
        true,

      status:
        response.status,

      errorCode:
        ""
    };
  }


  return {
    ok:
      false,

    status:
      response.status,

    errorCode:
      fcmErrorCode(
        body
      )
  };
}
