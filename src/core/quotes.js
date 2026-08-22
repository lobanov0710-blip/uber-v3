// =========================
// QUOTES
// =========================
//
// Серверная котировка стоимости поездки.
//
// Frontend получает только quoteId,
// а при создании заказа backend сам
// загружает доверенные:
// - маршрут
// - тариф
// - расстояние
// - время
// - стоимость
//
// Срок жизни котировки: 30 минут.
// =========================

export const QUOTE_TTL_SECONDS =
  30 * 60;

const QUOTE_PREFIX =
  "quote:";

// =========================
// KV
// =========================

function requireQuotesNamespace(env) {

  if (!env?.QUOTES) {
    throw new Error(
      "QUOTES KV binding is not configured"
    );
  }

  return env.QUOTES;
}

// =========================
// TEXT
// =========================

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

// =========================
// NUMBER
// =========================

function positiveNumber(
  value
) {

  const number =
    Number(value);

  if (
    !Number.isFinite(number) ||
    number <= 0
  ) {
    return null;
  }

  return number;
}

// =========================
// FROM / TO
// =========================
//
// /calculate сейчас получает
// geoResult.from и geoResult.to
// в виде объектов:
//
// {
//   query,
//   lat,
//   lon,
//   displayName
// }
//
// Но функция также поддерживает
// обычную строку.
// =========================

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

// =========================
// KEY
// =========================

function quoteKey(
  quoteId
) {

  const id =
    cleanText(
      quoteId,
      100
    );

  if (!id) {
    return null;
  }

  return (
    QUOTE_PREFIX +
    id
  );
}

// =========================
// CREATE
// =========================

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

  const quotes =
    requireQuotesNamespace(
      env
    );

  // =========================
  // ROUTE
  // =========================

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

  // =========================
  // TARIFF
  // =========================

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

  // =========================
  // NUMBERS
  // =========================

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

  // =========================
  // PRICING AUDIT DATA
  // =========================

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

  // =========================
  // ENTITY
  // =========================

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

      pricePerKm:
        pricePerKm,

      coefficient:
        coefficient,

      minimumPrice:
        minimumPrice
    },

    createdAt:
      now,

    expiresAt:
      expiresAt
  };

  // =========================
  // SAVE TO KV
  // =========================

  await quotes.put(
    quoteKey(
      quoteId
    ),

    JSON.stringify(
      quote
    ),

    {
      expirationTtl:
        QUOTE_TTL_SECONDS
    }
  );

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

// =========================
// GET
// =========================

export async function getQuote(
  env,
  quoteId
) {

  const quotes =
    requireQuotesNamespace(
      env
    );

  const key =
    quoteKey(
      quoteId
    );

  if (!key) {
    return null;
  }

  const raw =
    await quotes.get(
      key
    );

  if (!raw) {
    return null;
  }

  let quote;

  try {

    quote =
      JSON.parse(
        raw
      );

  } catch (
    error
  ) {

    console.error(
      "QUOTE JSON ERROR:",
      error
    );

    return null;
  }

  if (
    !quote ||
    typeof quote !== "object"
  ) {
    return null;
  }

  // =========================
  // EXPIRATION CHECK
  // =========================

  const expiresAt =
    Number(
      quote.expiresAt
    );

  if (
    !Number.isFinite(
      expiresAt
    ) ||
    expiresAt <=
      Date.now()
  ) {

    try {

      await quotes.delete(
        key
      );

    } catch (
      error
    ) {

      console.warn(
        "QUOTE DELETE EXPIRED ERROR:",
        error
      );
    }

    return null;
  }

  return quote;
}

// =========================
// DELETE
// =========================
//
// После успешного создания заказа
// котировку можно удалить.
// =========================

export async function deleteQuote(
  env,
  quoteId
) {

  const quotes =
    requireQuotesNamespace(
      env
    );

  const key =
    quoteKey(
      quoteId
    );

  if (!key) {
    return false;
  }

  await quotes.delete(
    key
  );

  return true;
}

// =========================
// PUBLIC RECEIPT
// =========================
//
// Это можно безопасно вернуть
// frontend после /calculate.
// =========================

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