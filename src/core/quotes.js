import {
  insertQuote
} from "./quoteRepository.js";


// =========================================
// QUOTES
// =========================================
//
// Server-side trip quote.
//
// D1 is the single source of truth.
//
// Frontend receives only quoteId.
// When an order is created, backend loads
// trusted route / tariff / distance /
// duration / price from D1.
//
// Quote lifetime: 30 minutes.
// =========================================

export const QUOTE_TTL_SECONDS =
  30 * 60;


// =========================================
// TEXT
// =========================================

function cleanText(
  value,
  maxLength = 300
) {

  return String(
    value ?? ""
  )
    .replace(
      /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,
      ""
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim()
    .slice(
      0,
      maxLength
    );
}


// =========================================
// NUMBER
// =========================================

function positiveNumber(
  value
) {

  const number =
    Number(
      value
    );

  if (
    !Number.isFinite(
      number
    ) ||
    number <= 0
  ) {

    return null;
  }

  return number;
}


// =========================================
// FROM / TO
// =========================================

function normalizePlace(
  value
) {

  if (
    value &&
    typeof value === "object"
  ) {

    return cleanText(
      value.query ||
      value.displayName ||
      "",
      200
    );
  }

  return cleanText(
    value,
    200
  );
}


// =========================================
// CREATE
// =========================================

export async function createQuote(
  env,
  input
) {

  if (
    !input ||
    typeof input !== "object"
  ) {

    throw new Error(
      "Invalid quote data"
    );
  }


  // =======================================
  // ROUTE
  // =======================================

  const from =
    normalizePlace(
      input.from
    );

  const to =
    normalizePlace(
      input.to
    );

  if (!from) {

    throw new Error(
      "Quote from is required"
    );
  }

  if (!to) {

    throw new Error(
      "Quote to is required"
    );
  }


  // =======================================
  // TARIFF
  // =======================================

  const tariff =
    cleanText(
      input.tariff,
      40
    )
      .toLowerCase();

  const tariffName =
    cleanText(
      input.tariffName,
      80
    );

  if (!tariff) {

    throw new Error(
      "Quote tariff is required"
    );
  }


  // =======================================
  // NUMBERS
  // =======================================

  const distance =
    positiveNumber(
      input.distance
    );

  const duration =
    positiveNumber(
      input.duration
    );

  const price =
    positiveNumber(
      input.price
    );

  if (distance === null) {

    throw new Error(
      "Quote distance is invalid"
    );
  }

  if (duration === null) {

    throw new Error(
      "Quote duration is invalid"
    );
  }

  if (price === null) {

    throw new Error(
      "Quote price is invalid"
    );
  }


  // =======================================
  // PRICING AUDIT DATA
  // =======================================

  const pricePerKm =
    positiveNumber(
      input.pricePerKm
    );

  const coefficient =
    positiveNumber(
      input.coefficient
    );

  const minimumPrice =
    positiveNumber(
      input.minimumPrice
    );

  if (pricePerKm === null) {

    throw new Error(
      "Quote pricePerKm is invalid"
    );
  }

  if (coefficient === null) {

    throw new Error(
      "Quote coefficient is invalid"
    );
  }

  if (minimumPrice === null) {

    throw new Error(
      "Quote minimumPrice is invalid"
    );
  }


  // =======================================
  // ENTITY
  // =======================================

  const now =
    Date.now();

  const quoteId =
    crypto.randomUUID();

  const expiresAt =
    now +
    QUOTE_TTL_SECONDS *
      1000;

  const quote = {

    id:
      quoteId,

    from,
    to,

    tariff,

    tariffName:
      tariffName ||
      tariff,

    distance,
    duration,
    price,

    pricing: {

      pricePerKm,

      coefficient,

      minimumPrice
    },

    createdAt:
      now,

    expiresAt
  };


  // =======================================
  // D1 PERSISTENCE
  // =======================================
  //
  // Critical invariant:
  //
  // quoteId is returned to the client
  // ONLY after the quote has been
  // successfully persisted in D1.
  //
  // Any D1 failure propagates to
  // /calculate and the client does not
  // receive a non-persisted quoteId.
  // =======================================

  await insertQuote(
    env,
    quote
  );


  // =======================================
  // LOG
  // =======================================

  console.log(
    "QUOTE CREATED:",
    {
      quoteId:
        quote.id,

      tariff:
        quote.tariff,

      distance:
        quote.distance,

      price:
        quote.price,

      expiresAt:
        quote.expiresAt
    }
  );


  return quote;
}


// =========================================
// PUBLIC RECEIPT
// =========================================

export function quoteReceipt(
  quote
) {

  return {

    quoteId:
      quote.id,

    expiresAt:
      quote.expiresAt
  };
}