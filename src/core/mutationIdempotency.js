// =========================================
// MUTATION IDEMPOTENCY
// =========================================
//
// Raw Idempotency-Key values are validated
// in memory and reduced to SHA-256 digests.
// Canonical request digests bind a key to
// one operation/target/body.
// =========================================

const encoder =
  new TextEncoder();

const IDEMPOTENCY_KEY_PATTERN =
  /^[A-Za-z0-9._:-]{8,128}$/;


function clean(
  value
) {

  return String(
    value ?? ""
  )
    .trim();
}


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


async function digestText(
  value
) {

  const digest =
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        encoder.encode(
          value
        )
      )
    );


  return bytesToBase64Url(
    digest
  );
}


function canonicalize(
  value
) {

  if (
    value === null
    ||
    typeof value ===
      "string"
    ||
    typeof value ===
      "boolean"
  ) {

    return value;
  }


  if (
    typeof value ===
      "number"
  ) {

    if (
      !Number.isFinite(
        value
      )
  ) {

      throw new Error(
        "invalid idempotency number"
      );
    }


    return value;
  }


  if (
    Array.isArray(
      value
    )
  ) {

    return value.map(
      canonicalize
    );
  }


  if (
    value
    &&
    typeof value ===
      "object"
  ) {

    const output = {};


    for (
      const key of Object.keys(
        value
      )
        .sort()
    ) {

      output[key] =
        canonicalize(
          value[key]
        );
    }


    return output;
  }


  throw new Error(
    "invalid idempotency value"
  );
}


export async function createMutationIdempotency(
  {
    key,
    operation,
    target,
    body
  }
) {

  const rawKey =
    clean(
      key
    );


  const normalizedOperation =
    clean(
      operation
    );


  const normalizedTarget =
    clean(
      target
    );


  if (
    !IDEMPOTENCY_KEY_PATTERN.test(
      rawKey
    )
  ) {

    return {
      ok:
        false,

      status:
        400,

      error:
        "invalid request",

      code:
        rawKey
          ? "invalid_idempotency_key"
          : "idempotency_key_required"
    };
  }


  if (
    !normalizedOperation
    ||
    !normalizedTarget
  ) {

    throw new Error(
      "invalid idempotency operation"
    );
  }


  const keyDigest =
    await digestText(
      rawKey
    );


  const requestDigest =
    await digestText(
      JSON.stringify({
        operation:
          normalizedOperation,

        target:
          normalizedTarget,

        body:
          canonicalize(
            body ?? null
          )
      })
    );


  return {
    ok:
      true,

    operation:
      normalizedOperation,

    keyDigest,

    requestDigest
  };
}
