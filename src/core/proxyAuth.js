const MAX_CLOCK_SKEW_SECONDS =
  300;

const SIGNATURE_HEX_LENGTH =
  64;


// =========================================
// HEX -> BYTES
// =========================================

function hexToBytes(
  value
) {

  const hex =
    String(
      value || ""
    )
      .trim()
      .toLowerCase();

  if (
    hex.length !==
      SIGNATURE_HEX_LENGTH ||
    !/^[0-9a-f]+$/.test(
      hex
    )
  ) {
    return null;
  }

  const bytes =
    new Uint8Array(
      hex.length / 2
    );

  for (
    let i = 0;
    i < hex.length;
    i += 2
  ) {

    bytes[i / 2] =
      Number.parseInt(
        hex.slice(
          i,
          i + 2
        ),
        16
      );
  }

  return bytes;
}


// =========================================
// VERIFY PROXY REQUEST
// =========================================

export async function verifyProxyRequest(
  req,
  env,
  expectedPath
) {

  const secret =
    String(
      env?.PROXY_HMAC_SECRET ||
      ""
    );

  if (
    secret.length < 32
  ) {

    console.error(
      "PROXY_HMAC_SECRET unavailable"
    );

    return {
      ok: false,
      status: 500,
      error:
        "proxy authentication unavailable"
    };
  }


  // =========================================
  // HEADERS
  // =========================================

  const timestampHeader =
    req.headers.get(
      "X-Proxy-Timestamp"
    );

  const signatureHeader =
    req.headers.get(
      "X-Proxy-Signature"
    );

  if (
    !timestampHeader ||
    !signatureHeader
  ) {

    return {
      ok: false,
      status: 403,
      error: "forbidden"
    };
  }


  // =========================================
  // TIMESTAMP
  // =========================================

  if (
    !/^\d{10}$/.test(
      timestampHeader
    )
  ) {

    return {
      ok: false,
      status: 403,
      error: "forbidden"
    };
  }

  const timestamp =
    Number(
      timestampHeader
    );

  if (
    !Number.isSafeInteger(
      timestamp
    )
  ) {

    return {
      ok: false,
      status: 403,
      error: "forbidden"
    };
  }

  const now =
    Math.floor(
      Date.now() / 1000
    );

  if (
    Math.abs(
      now - timestamp
    ) >
    MAX_CLOCK_SKEW_SECONDS
  ) {

    return {
      ok: false,
      status: 403,
      error: "forbidden"
    };
  }


  // =========================================
  // PATH
  // =========================================

  const actualPath =
    new URL(
      req.url
    ).pathname;

  if (
    actualPath !==
    expectedPath
  ) {

    return {
      ok: false,
      status: 403,
      error: "forbidden"
    };
  }


  // =========================================
  // SIGNATURE
  // =========================================

  const signatureBytes =
    hexToBytes(
      signatureHeader
    );

  if (
    !signatureBytes
  ) {

    return {
      ok: false,
      status: 403,
      error: "forbidden"
    };
  }


  // =========================================
  // RAW BODY
  // =========================================

  let body;

  try {

    body =
      await req
        .clone()
        .text();

  } catch (
    error
  ) {

    return {
      ok: false,
      status: 403,
      error: "forbidden"
    };
  }


  // =========================================
  // CANONICAL STRING
  // =========================================

  const canonical =
    timestampHeader +
    "\n" +
    expectedPath +
    "\n" +
    body;

  const encoder =
    new TextEncoder();


  // =========================================
  // IMPORT HMAC KEY
  // =========================================

  let key;

  try {

    key =
      await crypto.subtle
        .importKey(
          "raw",
          encoder.encode(
            secret
          ),
          {
            name: "HMAC",
            hash: "SHA-256"
          },
          false,
          [
            "verify"
          ]
        );

  } catch (
    error
  ) {

    console.error(
      "Proxy HMAC key import failed"
    );

    return {
      ok: false,
      status: 500,
      error:
        "proxy authentication unavailable"
    };
  }


  // =========================================
  // CONSTANT-TIME VERIFY
  // =========================================

  let valid =
    false;

  try {

    valid =
      await crypto.subtle
        .verify(
          {
            name: "HMAC"
          },
          key,
          signatureBytes,
          encoder.encode(
            canonical
          )
        );

  } catch (
    error
  ) {

    valid =
      false;
  }

  if (
    !valid
  ) {

    return {
      ok: false,
      status: 403,
      error: "forbidden"
    };
  }


  return {
    ok: true
  };
}