// =========================================
// DRIVER SESSION EXCHANGE RATE LIMIT
// =========================================

const encoder =
  new TextEncoder();


function requireDatabase(
  env
) {

  if (!env?.DB) {

    throw new Error(
      "D1 DB binding is not configured"
    );
  }


  return env.DB;
}


function clean(
  value
) {

  return String(
    value ?? ""
  )
    .trim();
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
      `invalid rate limit ${name}`
    );
  }


  return number;
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


export async function createRateLimitBucketKey(
  category,
  value
) {

  const type =
    clean(
      category
    );


  const subject =
    clean(
      value
    );


  if (
    !type
    ||
    !subject
  ) {

    throw new Error(
      "invalid rate limit subject"
    );
  }


  const digest =
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        encoder.encode(
          type +
          ":" +
          subject
        )
      )
    );


  return bytesToBase64Url(
    digest
  );
}


export async function consumeDriverExchangeRateLimit(
  env,
  {
    bucketKey,
    now,
    limit,
    windowMs,
    penaltyStepMs,
    maxPenaltyMs
  }
) {

  const key =
    clean(
      bucketKey
    );


  if (
    !/^[A-Za-z0-9_-]{43}$/.test(
      key
    )
  ) {

    throw new Error(
      "invalid rate limit bucket"
    );
  }


  const timestamp =
    requirePositiveInteger(
      now,
      "timestamp"
    );


  const maxAttempts =
    requirePositiveInteger(
      limit,
      "limit"
    );


  const window =
    requirePositiveInteger(
      windowMs,
      "windowMs"
    );


  const penaltyStep =
    requirePositiveInteger(
      penaltyStepMs,
      "penaltyStepMs"
    );


  const maxPenalty =
    requirePositiveInteger(
      maxPenaltyMs,
      "maxPenaltyMs"
    );


  const windowCutoff =
    timestamp -
    window;


  const db =
    requireDatabase(
      env
    );


  await db
    .prepare(`
      INSERT INTO driver_exchange_rate_limits (
        bucket_key,
        window_started_at,
        attempt_count,
        blocked_until,
        updated_at
      )
      VALUES (
        ?1,
        ?2,
        1,
        NULL,
        ?2
      )

      ON CONFLICT(bucket_key)
      DO UPDATE SET

        window_started_at =
          CASE
            WHEN driver_exchange_rate_limits.window_started_at <= ?3
            THEN ?2
            ELSE driver_exchange_rate_limits.window_started_at
          END,

        attempt_count =
          CASE
            WHEN driver_exchange_rate_limits.window_started_at <= ?3
            THEN 1
            ELSE driver_exchange_rate_limits.attempt_count + 1
          END,

        blocked_until =
          CASE
            WHEN driver_exchange_rate_limits.blocked_until IS NOT NULL
              AND driver_exchange_rate_limits.blocked_until > ?2
            THEN driver_exchange_rate_limits.blocked_until

            WHEN driver_exchange_rate_limits.window_started_at <= ?3
            THEN NULL

            WHEN driver_exchange_rate_limits.attempt_count + 1 > ?4
            THEN
              ?2 +
              MIN(
                ?6,
                ?5 *
                (
                  driver_exchange_rate_limits.attempt_count + 1 - ?4
                )
              )

            ELSE NULL
          END,

        updated_at =
          ?2
    `)
    .bind(
      key,
      timestamp,
      windowCutoff,
      maxAttempts,
      penaltyStep,
      maxPenalty
    )
    .run();


  const row =
    await db
      .prepare(`
        SELECT
          attempt_count,
          blocked_until

        FROM driver_exchange_rate_limits

        WHERE bucket_key = ?1

        LIMIT 1
      `)
      .bind(
        key
      )
      .first();


  if (!row) {

    throw new Error(
      "rate limit readback failed"
    );
  }


  const attemptCount =
    Number(
      row.attempt_count
    );


  const blockedUntil =
    row.blocked_until ===
      null
      ||
      row.blocked_until ===
        undefined
      ? null
      : Number(
          row.blocked_until
        );


  if (
    !Number.isSafeInteger(
      attemptCount
    )
    ||
    attemptCount < 1
    ||
    (
      blockedUntil !== null
      &&
      (
        !Number.isSafeInteger(
          blockedUntil
        )
        ||
        blockedUntil <= 0
      )
    )
  ) {

    throw new Error(
      "invalid rate limit state"
    );
  }


  return {
    allowed:
      blockedUntil === null
      ||
      blockedUntil <=
        timestamp,

    attemptCount,
    blockedUntil
  };
}
