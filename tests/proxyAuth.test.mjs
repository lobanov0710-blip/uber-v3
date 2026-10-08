import assert from "node:assert/strict";

import {
  webcrypto
} from "node:crypto";

import {
  verifyProxyRequest
} from "../src/core/proxyAuth.js";


if (!globalThis.crypto) {
  globalThis.crypto =
    webcrypto;
}


// ========================================
// CONSTANTS
// ========================================

const SECRET =
  "0123456789abcdef0123456789abcdef";

const WRONG_SECRET =
  "abcdef0123456789abcdef0123456789";

const FIXED_NOW =
  1700000000000;

const FIXED_TIMESTAMP =
  String(
    Math.floor(
      FIXED_NOW / 1000
    )
  );


// ========================================
// TEST RUNNER
// ========================================

async function test(
  name,
  fn
) {
  try {

    await fn();

    console.log(
      `✓ ${name}`
    );

  } catch (error) {

    console.error(
      `✘ ${name}`
    );

    console.error(
      error
    );

    process.exitCode = 1;
  }
}


// ========================================
// FIXED TIME
// ========================================

async function withNow(
  now,
  fn
) {

  const originalNow =
    Date.now;

  Date.now =
    () => now;

  try {

    return await fn();

  } finally {

    Date.now =
      originalNow;
  }
}


// ========================================
// HMAC
// ========================================

async function createSignature(
  secret,
  timestamp,
  path,
  body
) {

  const encoder =
    new TextEncoder();


  const key =
    await crypto.subtle.importKey(
      "raw",
      encoder.encode(
        secret
      ),
      {
        name:
          "HMAC",

        hash:
          "SHA-256"
      },
      false,
      [
        "sign"
      ]
    );


  const canonical =
    timestamp +
    "\n" +
    path +
    "\n" +
    body;


  const signature =
    await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(
        canonical
      )
    );


  return Array
    .from(
      new Uint8Array(
        signature
      )
    )
    .map(
      byte =>
        byte
          .toString(16)
          .padStart(
            2,
            "0"
          )
    )
    .join("");
}


// ========================================
// REQUEST
// ========================================

function createRequest(
  {
    path = "/calculate",
    body =
      '{"from":"Нижний Новгород","to":"Москва","tariff":"comfort"}',
    timestamp =
      FIXED_TIMESTAMP,
    signature = null,
    includeTimestamp = true,
    includeSignature = true
  } = {}
) {

  const headers =
    new Headers({
      "Content-Type":
        "application/json"
    });


  if (
    includeTimestamp
  ) {

    headers.set(
      "X-Proxy-Timestamp",
      timestamp
    );
  }


  if (
    includeSignature &&
    signature
  ) {

    headers.set(
      "X-Proxy-Signature",
      signature
    );
  }


  return new Request(
    `https://uber-v3.test${path}`,
    {
      method:
        "POST",

      headers,

      body
    }
  );
}


// ========================================
// VALID SIGNATURE
// ========================================

await test(
  "valid HMAC proxy request is accepted",
  async () => {

    await withNow(
      FIXED_NOW,
      async () => {

        const body =
          '{"from":"Нижний Новгород","to":"Москва","tariff":"comfort"}';


        const signature =
          await createSignature(
            SECRET,
            FIXED_TIMESTAMP,
            "/calculate",
            body
          );


        const request =
          createRequest({
            path:
              "/calculate",

            body,

            signature
          });


        const result =
          await verifyProxyRequest(
            request,
            {
              PROXY_HMAC_SECRET:
                SECRET
            },
            "/calculate"
          );


        assert.deepEqual(
          result,
          {
            ok:
              true
          }
        );
      }
    );
  }
);


// ========================================
// WRONG SECRET
// ========================================

await test(
  "signature created with another secret is rejected",
  async () => {

    await withNow(
      FIXED_NOW,
      async () => {

        const body =
          '{"from":"Нижний Новгород","to":"Москва"}';


        const signature =
          await createSignature(
            WRONG_SECRET,
            FIXED_TIMESTAMP,
            "/calculate",
            body
          );


        const result =
          await verifyProxyRequest(
            createRequest({
              body,
              signature
            }),
            {
              PROXY_HMAC_SECRET:
                SECRET
            },
            "/calculate"
          );


        assert.deepEqual(
          result,
          {
            ok:
              false,

            status:
              403,

            error:
              "forbidden"
          }
        );
      }
    );
  }
);


// ========================================
// MODIFIED BODY
// ========================================

await test(
  "modified request body invalidates signature",
  async () => {

    await withNow(
      FIXED_NOW,
      async () => {

        const signedBody =
          '{"from":"Нижний Новгород","to":"Москва","tariff":"comfort"}';


        const actualBody =
          '{"from":"Нижний Новгород","to":"Казань","tariff":"comfort"}';


        const signature =
          await createSignature(
            SECRET,
            FIXED_TIMESTAMP,
            "/calculate",
            signedBody
          );


        const result =
          await verifyProxyRequest(
            createRequest({
              body:
                actualBody,

              signature
            }),
            {
              PROXY_HMAC_SECRET:
                SECRET
            },
            "/calculate"
          );


        assert.equal(
          result.ok,
          false
        );

        assert.equal(
          result.status,
          403
        );
      }
    );
  }
);


// ========================================
// RAW BODY
// ========================================

await test(
  "signature is calculated from exact raw body",
  async () => {

    await withNow(
      FIXED_NOW,
      async () => {

        const rawBody =
          '{ "from": "Нижний Новгород", "to": "Москва" }';


        const signature =
          await createSignature(
            SECRET,
            FIXED_TIMESTAMP,
            "/calculate",
            rawBody
          );


        const validResult =
          await verifyProxyRequest(
            createRequest({
              body:
                rawBody,

              signature
            }),
            {
              PROXY_HMAC_SECRET:
                SECRET
            },
            "/calculate"
          );


        assert.equal(
          validResult.ok,
          true
        );


        const semanticallySameBody =
          '{"from":"Нижний Новгород","to":"Москва"}';


        const invalidResult =
          await verifyProxyRequest(
            createRequest({
              body:
                semanticallySameBody,

              signature
            }),
            {
              PROXY_HMAC_SECRET:
                SECRET
            },
            "/calculate"
          );


        assert.equal(
          invalidResult.ok,
          false
        );

        assert.equal(
          invalidResult.status,
          403
        );
      }
    );
  }
);


// ========================================
// WRONG PATH
// ========================================

await test(
  "request path must match expected path",
  async () => {

    await withNow(
      FIXED_NOW,
      async () => {

        const body =
          '{"name":"Иван"}';


        const signature =
          await createSignature(
            SECRET,
            FIXED_TIMESTAMP,
            "/orders",
            body
          );


        const request =
          createRequest({
            path:
              "/orders",

            body,

            signature
          });


        const result =
          await verifyProxyRequest(
            request,
            {
              PROXY_HMAC_SECRET:
                SECRET
            },
            "/calculate"
          );


        assert.equal(
          result.ok,
          false
        );

        assert.equal(
          result.status,
          403
        );
      }
    );
  }
);


// ========================================
// SIGNED PATH MISMATCH
// ========================================

await test(
  "signature for another endpoint is rejected",
  async () => {

    await withNow(
      FIXED_NOW,
      async () => {

        const body =
          '{"name":"Иван"}';


        const signature =
          await createSignature(
            SECRET,
            FIXED_TIMESTAMP,
            "/calculate",
            body
          );


        const request =
          createRequest({
            path:
              "/orders",

            body,

            signature
          });


        const result =
          await verifyProxyRequest(
            request,
            {
              PROXY_HMAC_SECRET:
                SECRET
            },
            "/orders"
          );


        assert.equal(
          result.ok,
          false
        );

        assert.equal(
          result.status,
          403
        );
      }
    );
  }
);


// ========================================
// MISSING HEADERS
// ========================================

await test(
  "missing timestamp header is rejected",
  async () => {

    await withNow(
      FIXED_NOW,
      async () => {

        const body =
          "{}";


        const signature =
          await createSignature(
            SECRET,
            FIXED_TIMESTAMP,
            "/calculate",
            body
          );


        const result =
          await verifyProxyRequest(
            createRequest({
              body,
              signature,
              includeTimestamp:
                false
            }),
            {
              PROXY_HMAC_SECRET:
                SECRET
            },
            "/calculate"
          );


        assert.equal(
          result.ok,
          false
        );

        assert.equal(
          result.status,
          403
        );
      }
    );
  }
);


await test(
  "missing signature header is rejected",
  async () => {

    await withNow(
      FIXED_NOW,
      async () => {

        const result =
          await verifyProxyRequest(
            createRequest({
              body:
                "{}",

              includeSignature:
                false
            }),
            {
              PROXY_HMAC_SECRET:
                SECRET
            },
            "/calculate"
          );


        assert.equal(
          result.ok,
          false
        );

        assert.equal(
          result.status,
          403
        );
      }
    );
  }
);


// ========================================
// MALFORMED SIGNATURE
// ========================================

await test(
  "malformed HMAC signature is rejected",
  async () => {

    await withNow(
      FIXED_NOW,
      async () => {

        const result =
          await verifyProxyRequest(
            createRequest({
              body:
                "{}",

              signature:
                "not-a-valid-signature"
            }),
            {
              PROXY_HMAC_SECRET:
                SECRET
            },
            "/calculate"
          );


        assert.equal(
          result.ok,
          false
        );

        assert.equal(
          result.status,
          403
        );
      }
    );
  }
);


// ========================================
// TIMESTAMP FORMAT
// ========================================

await test(
  "non numeric timestamp is rejected",
  async () => {

    const result =
      await verifyProxyRequest(
        createRequest({
          timestamp:
            "abcdefghij",

          signature:
            "0".repeat(64)
        }),
        {
          PROXY_HMAC_SECRET:
            SECRET
        },
        "/calculate"
      );


    assert.equal(
      result.ok,
      false
    );

    assert.equal(
      result.status,
      403
    );
  }
);


await test(
  "timestamp must contain exactly ten digits",
  async () => {

    const result =
      await verifyProxyRequest(
        createRequest({
          timestamp:
            "123456789",

          signature:
            "0".repeat(64)
        }),
        {
          PROXY_HMAC_SECRET:
            SECRET
        },
        "/calculate"
      );


    assert.equal(
      result.ok,
      false
    );

    assert.equal(
      result.status,
      403
    );
  }
);


// ========================================
// CLOCK SKEW
// ========================================

await test(
  "timestamp exactly 300 seconds old is accepted",
  async () => {

    await withNow(
      FIXED_NOW,
      async () => {

        const timestamp =
          String(
            Math.floor(
              FIXED_NOW / 1000
            ) - 300
          );


        const body =
          "{}";


        const signature =
          await createSignature(
            SECRET,
            timestamp,
            "/calculate",
            body
          );


        const result =
          await verifyProxyRequest(
            createRequest({
              body,
              timestamp,
              signature
            }),
            {
              PROXY_HMAC_SECRET:
                SECRET
            },
            "/calculate"
          );


        assert.equal(
          result.ok,
          true
        );
      }
    );
  }
);


await test(
  "timestamp older than 300 seconds is rejected",
  async () => {

    await withNow(
      FIXED_NOW,
      async () => {

        const timestamp =
          String(
            Math.floor(
              FIXED_NOW / 1000
            ) - 301
          );


        const body =
          "{}";


        const signature =
          await createSignature(
            SECRET,
            timestamp,
            "/calculate",
            body
          );


        const result =
          await verifyProxyRequest(
            createRequest({
              body,
              timestamp,
              signature
            }),
            {
              PROXY_HMAC_SECRET:
                SECRET
            },
            "/calculate"
          );


        assert.equal(
          result.ok,
          false
        );

        assert.equal(
          result.status,
          403
        );
      }
    );
  }
);


await test(
  "timestamp more than 300 seconds in future is rejected",
  async () => {

    await withNow(
      FIXED_NOW,
      async () => {

        const timestamp =
          String(
            Math.floor(
              FIXED_NOW / 1000
            ) + 301
          );


        const body =
          "{}";


        const signature =
          await createSignature(
            SECRET,
            timestamp,
            "/calculate",
            body
          );


        const result =
          await verifyProxyRequest(
            createRequest({
              body,
              timestamp,
              signature
            }),
            {
              PROXY_HMAC_SECRET:
                SECRET
            },
            "/calculate"
          );


        assert.equal(
          result.ok,
          false
        );

        assert.equal(
          result.status,
          403
        );
      }
    );
  }
);


// ========================================
// SECRET
// ========================================

await test(
  "missing proxy secret returns server configuration error",
  async () => {

    const originalError =
      console.error;

    console.error =
      () => {};


    try {

      const result =
        await verifyProxyRequest(
          createRequest({
            signature:
              "0".repeat(64)
          }),
          {},
          "/calculate"
        );


      assert.deepEqual(
        result,
        {
          ok:
            false,

          status:
            500,

          error:
            "proxy authentication unavailable"
        }
      );

    } finally {

      console.error =
        originalError;
    }
  }
);


await test(
  "short proxy secret returns server configuration error",
  async () => {

    const originalError =
      console.error;

    console.error =
      () => {};


    try {

      const result =
        await verifyProxyRequest(
          createRequest({
            signature:
              "0".repeat(64)
          }),
          {
            PROXY_HMAC_SECRET:
              "short"
          },
          "/calculate"
        );


      assert.deepEqual(
        result,
        {
          ok:
            false,

          status:
            500,

          error:
            "proxy authentication unavailable"
        }
      );

    } finally {

      console.error =
        originalError;
    }
  }
);


// ========================================
// ORDERS ENDPOINT
// ========================================

await test(
  "valid signed orders request is accepted",
  async () => {

    await withNow(
      FIXED_NOW,
      async () => {

        const body =
          '{"quoteId":"11111111-1111-4111-8111-111111111111","name":"Иван"}';


        const signature =
          await createSignature(
            SECRET,
            FIXED_TIMESTAMP,
            "/orders",
            body
          );


        const result =
          await verifyProxyRequest(
            createRequest({
              path:
                "/orders",

              body,

              signature
            }),
            {
              PROXY_HMAC_SECRET:
                SECRET
            },
            "/orders"
          );


        assert.equal(
          result.ok,
          true
        );
      }
    );
  }
);


console.log("");

if (!process.exitCode) {

  console.log(
    "✓ ALL PROXY AUTH TESTS PASSED"
  );
}