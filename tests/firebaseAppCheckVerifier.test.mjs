import assert from "node:assert/strict";

import {
  resetFirebaseAppCheckKeyCacheForTests,
  verifyFirebaseAppCheckToken
} from "../src/core/firebaseAppCheckVerifier.js";


const encoder =
  new TextEncoder();

const PROJECT_NUMBER =
  "1234567890";

const APP_ID =
  "1:1234567890:android:abcdef123456";

const NOW_MS =
  1800000000000;

const NOW_SECONDS =
  Math.floor(
    NOW_MS / 1000
  );


function bytesToBase64Url(
  bytes
) {

  let binary =
    "";


  for (
    const byte of bytes
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


function jsonToBase64Url(
  value
) {

  return bytesToBase64Url(
    encoder.encode(
      JSON.stringify(
        value
      )
    )
  );
}


const keyPair =
  await crypto.subtle.generateKey(
    {
      name:
        "RSASSA-PKCS1-v1_5",

      modulusLength:
        2048,

      publicExponent:
        new Uint8Array([
          1,
          0,
          1
        ]),

      hash:
        "SHA-256"
    },
    true,
    [
      "sign",
      "verify"
    ]
  );


const publicJwk =
  await crypto.subtle.exportKey(
    "jwk",
    keyPair.publicKey
  );


publicJwk.kid =
  "app-check-test-key";

publicJwk.alg =
  "RS256";

publicJwk.use =
  "sig";


async function createToken(
  overrides = {},
  headerOverrides = {}
) {

  const header = {
    alg:
      "RS256",

    typ:
      "JWT",

    kid:
      "app-check-test-key",

    ...headerOverrides
  };


  const payload = {
    iss:
      `https://firebaseappcheck.googleapis.com/${PROJECT_NUMBER}`,

    aud: [
      `projects/${PROJECT_NUMBER}`
    ],

    sub:
      APP_ID,

    exp:
      NOW_SECONDS + 3600,

    ...overrides
  };


  const encodedHeader =
    jsonToBase64Url(
      header
    );


  const encodedPayload =
    jsonToBase64Url(
      payload
    );


  const input =
    `${encodedHeader}.${encodedPayload}`;


  const signature =
    await crypto.subtle.sign(
      {
        name:
          "RSASSA-PKCS1-v1_5"
      },
      keyPair.privateKey,
      encoder.encode(
        input
      )
    );


  return (
    input +
    "." +
    bytesToBase64Url(
      new Uint8Array(
        signature
      )
    )
  );
}


function fakeFetch() {

  return async () => ({
    ok:
      true,

    headers: {
      get:
        name =>
          String(
            name
          )
            .toLowerCase() ===
          "cache-control"
            ? "public, max-age=600"
            : null
    },

    json:
      async () => ({
        keys: [
          publicJwk
        ]
      })
  });
}


async function verify(
  token,
  env = {}
) {

  resetFirebaseAppCheckKeyCacheForTests();


  return verifyFirebaseAppCheckToken(
    {
      FIREBASE_PROJECT_NUMBER:
        PROJECT_NUMBER,

      FIREBASE_DRIVER_APP_ID:
        APP_ID,

      ...env
    },
    token,
    {
      nowMs:
        NOW_MS,

      fetchImpl:
        fakeFetch()
    }
  );
}


const validToken =
  await createToken();


const valid =
  await verify(
    validToken
  );


assert.equal(
  valid.projectNumber,
  PROJECT_NUMBER
);

assert.equal(
  valid.appId,
  APP_ID
);


await assert.rejects(
  async () =>
    verify(
      await createToken({
        exp:
          NOW_SECONDS
      })
    ),
  /expired/
);


await assert.rejects(
  async () =>
    verify(
      await createToken({
        iss:
          "https://firebaseappcheck.googleapis.com/9999999999"
      })
    ),
  /issuer/
);


await assert.rejects(
  async () =>
    verify(
      await createToken({
        aud: [
          "projects/9999999999"
        ]
      })
    ),
  /audience/
);


await assert.rejects(
  async () =>
    verify(
      await createToken({
        sub:
          "1:1234567890:android:attacker"
      })
    ),
  /app/
);


await assert.rejects(
  async () =>
    verify(
      await createToken(
        {},
        {
          alg:
            "HS256"
        }
      )
    ),
  /header/
);


const parts =
  validToken.split(
    "."
  );


parts[1] =
  jsonToBase64Url({
    iss:
      `https://firebaseappcheck.googleapis.com/${PROJECT_NUMBER}`,

    aud: [
      `projects/${PROJECT_NUMBER}`
    ],

    sub:
      "1:1234567890:android:tampered",

    exp:
      NOW_SECONDS + 3600
  });


await assert.rejects(
  () =>
    verify(
      parts.join(
        "."
      )
    ),
  /app|signature/
);


console.log(
  "✓ FIREBASE APP CHECK VERIFIER TESTS PASSED"
);
