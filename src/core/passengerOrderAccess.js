import {
  signJWT,
  verifyJWT
} from "./auth.js";


// =========================================
// PASSENGER ORDER ACCESS
// =========================================
//
// Passenger order access uses a dedicated
// signing secret.
//
// It MUST NOT reuse:
// - staff JWT_SECRET
// - proxy HMAC secret
//
// The token acts as a capability allowing
// read-only access to exactly one order.
// =========================================

const ACCESS_SCOPE =
  "passenger_order:read";

const MIN_ACCESS_SECONDS =
  30 * 24 * 60 * 60;

const AFTER_TRIP_SECONDS =
  7 * 24 * 60 * 60;


// =========================================
// SECRET
// =========================================

function requireSecret(
  env
) {

  const secret =
    String(
      env?.PASSENGER_ORDER_SECRET ??
      ""
    );

  if (
    secret.length < 32
  ) {

    throw new Error(
      "PASSENGER_ORDER_SECRET is missing or too short"
    );
  }

  return secret;
}


// =========================================
// ORDER ID
// =========================================

function requireOrderId(
  order
) {

  const id =
    String(
      order?.id ??
      ""
    )
      .trim();

  if (!id) {

    throw new Error(
      "Invalid passenger order id"
    );
  }

  return id;
}


// =========================================
// TRIP DATE
// =========================================

function parseTripDateEnd(
  value
) {

  const date =
    String(
      value ??
      ""
    )
      .trim();

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(
      date
    )
  ) {

    return null;
  }


  const timestamp =
    Date.parse(
      `${date}T23:59:59.999Z`
    );


  if (
    !Number.isFinite(
      timestamp
    )
  ) {

    return null;
  }


  const parsedDate =
    new Date(
      timestamp
    );


  if (
    parsedDate
      .toISOString()
      .slice(
        0,
        10
      ) !==
    date
  ) {

    return null;
  }


  return timestamp;
}


// =========================================
// EXPIRATION
// =========================================
//
// Access must survive long enough for:
// - delayed trips;
// - future bookings;
// - temporary app/network failures.
//
// Minimum lifetime:
// 30 days.
//
// For a future trip:
// access remains valid until at least
// 7 days after the trip date.
// =========================================

function calculateAccessLifetime(
  order,
  nowMilliseconds
) {

  const minimumExpiry =
    nowMilliseconds +
    (
      MIN_ACCESS_SECONDS *
      1000
    );


  const tripDateEnd =
    parseTripDateEnd(
      order?.date
    );


  let desiredExpiry =
    minimumExpiry;


  if (
    tripDateEnd !== null
  ) {

    desiredExpiry =
      Math.max(
        desiredExpiry,

        tripDateEnd +
        (
          AFTER_TRIP_SECONDS *
          1000
        )
      );
  }


  const nowSeconds =
    Math.floor(
      nowMilliseconds / 1000
    );


  const expirySeconds =
    Math.ceil(
      desiredExpiry / 1000
    );


  const ttlSeconds =
    Math.max(
      1,
      expirySeconds -
      nowSeconds
    );


  return {
    ttlSeconds,

    expiresAt:
      (
        nowSeconds +
        ttlSeconds
      ) * 1000
  };
}


// =========================================
// CONFIG CHECK
// =========================================
//
// Router can call this BEFORE writing
// an order to D1.
//
// This prevents a missing passenger
// signing secret from turning a valid
// order write into an unusable response.
// =========================================

export function requirePassengerOrderAccess(
  env
) {

  requireSecret(
    env
  );

  return true;
}


// =========================================
// ISSUE TOKEN
// =========================================

export async function issuePassengerOrderAccess(
  env,
  order
) {

  const secret =
    requireSecret(
      env
    );


  const orderId =
    requireOrderId(
      order
    );


  const now =
    Date.now();


  const {
    ttlSeconds,
    expiresAt
  } =
    calculateAccessLifetime(
      order,
      now
    );


  const token =
    await signJWT(
      secret,
      {
        sub:
          orderId,

        scope:
          ACCESS_SCOPE
      },
      ttlSeconds
    );


  return {
    accessToken:
      token,

    accessExpiresAt:
      expiresAt
  };
}


// =========================================
// VERIFY TOKEN
// =========================================

export async function verifyPassengerOrderAccess(
  env,
  token
) {

  const secret =
    requireSecret(
      env
    );


  const value =
    String(
      token ??
      ""
    )
      .trim();


  if (!value) {

    return {
      ok:
        false
    };
  }


  const payload =
    await verifyJWT(
      secret,
      value
    );


  if (
    !payload ||
    typeof payload !==
      "object"
  ) {

    return {
      ok:
        false
    };
  }


  if (
    payload.scope !==
      ACCESS_SCOPE
  ) {

    return {
      ok:
        false
    };
  }


  const orderId =
    String(
      payload.sub ??
      ""
    )
      .trim();


  if (!orderId) {

    return {
      ok:
        false
    };
  }


  return {
    ok:
      true,

    orderId,

    expiresAt:
      Number(
        payload.exp
      ) * 1000
  };
}