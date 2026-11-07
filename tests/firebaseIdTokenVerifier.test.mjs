import assert from "node:assert/strict";

import {
  digestFirebaseIdToken,
  resetFirebasePublicKeyCacheForTests,
  verifyFirebaseIdToken
} from "../src/core/firebaseIdTokenVerifier.js";

const encoder =
  new TextEncoder();

const PROJECT_ID =
  "transfer-servis-test";

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
  "test-key";

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
      "test-key",

    ...headerOverrides
  };


  const payload = {
    aud:
      PROJECT_ID,

    iss:
      `https://securetoken.google.com/${PROJECT_ID}`,

    sub:
      "firebase-user-1",

    iat:
      NOW_SECONDS - 10,

    exp:
      NOW_SECONDS + 3600,

    auth_time:
      NOW_SECONDS - 10,

    phone_number:
      "+79991234567",

    firebase: {
      sign_in_provider:
        "phone"
    },

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
            ? "public, max-age=3600"
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

  resetFirebasePublicKeyCacheForTests();


  return verifyFirebaseIdToken(
    {
      FIREBASE_PROJECT_ID:
        PROJECT_ID,

      FIREBASE_AUTH_MAX_AGE_SECONDS:
        "300",

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


const verified =
  await verify(
    validToken
  );


assert.equal(
  verified.projectId,
  PROJECT_ID
);

assert.equal(
  verified.uid,
  "firebase-user-1"
);

assert.equal(
  verified.phoneNumber,
  "+79991234567"
);

assert.equal(
  verified.authTime,
  NOW_SECONDS - 10
);


const digest =
  await digestFirebaseIdToken(
    validToken
  );


assert.match(
  digest,
  /^[A-Za-z0-9_-]{43}$/
);


await assert.rejects(
  () =>
    verify(
      createToken({
        aud:
          "attacker-project"
      })
    ),
  /audience/
);


await assert.rejects(
  async () =>
    verify(
      await createToken({
        iss:
          "https://securetoken.google.com/attacker-project"
      })
    ),
  /issuer/
);


await assert.rejects(
  async () =>
    verify(
      await createToken({
        exp:
          NOW_SECONDS
      })
    ),
  /token time/
);


await assert.rejects(
  async () =>
    verify(
      await createToken({
        auth_time:
          NOW_SECONDS - 301
      })
    ),
  /too old/
);


await assert.rejects(
  async () =>
    verify(
      await createToken({
        firebase: {
          sign_in_provider:
            "password"
        }
      })
    ),
  /phone authentication required/
);


await assert.rejects(
  async () =>
    verify(
      await createToken({
        phone_number:
          "89991234567"
      })
    ),
  /phone number/
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
  /algorithm/
);


const tamperedParts =
  validToken.split(
    "."
  );


tamperedParts[1] =
  jsonToBase64Url({
    aud:
      PROJECT_ID,

    iss:
      `https://securetoken.google.com/${PROJECT_ID}`,

    sub:
      "firebase-user-1",

    iat:
      NOW_SECONDS - 10,

    exp:
      NOW_SECONDS + 3600,

    auth_time:
      NOW_SECONDS - 10,

    phone_number:
      "+79990000000",

    firebase: {
      sign_in_provider:
        "phone"
    }
  });


await assert.rejects(
  () =>
    verify(
      tamperedParts.join(
        "."
      )
    ),
  /signature/
);


console.log(
  "✓ FIREBASE ID TOKEN VERIFIER TESTS PASSED"
);
