import {
  insertQuote,
  getActiveQuoteById
} from "./quoteRepository.js";


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

function requireQuotesNamespace(
  env
) {

  if (
    !env?.QUOTES
  ) {

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

  if (
    !id
  ) {

    return null;
  }

  return (
    QUOTE_PREFIX +
    id
  );
}

// =========================
// SHADOW COMPARE
// =========================

function compareQuotes(
  kvQuote,
  d1Quote
) {

  const fields = [
    [
      "id",
      String(kvQuote?.id ?? ""),
      String(d1Quote?.id ?? "")
    ],
    [
      "from",
      String(kvQuote?.from ?? ""),
      String(d1Quote?.from ?? "")
    ],
    [
      "to",
      String(kvQuote?.to ?? ""),
      String(d1Quote?.to ?? "")
    ],
    [
      "tariff",
      String(kvQuote?.tariff ?? ""),
      String(d1Quote?.tariff ?? "")
    ],
    [
      "tariffName",
      String(kvQuote?.tariffName ?? ""),
      String(d1Quote?.tariffName ?? "")
    ],
    [
      "distance",
      Number(kvQuote?.distance),
      Number(d1Quote?.distance)
    ],
    [
      "duration",
      Number(kvQuote?.duration),
      Number(d1Quote?.duration)
    ],
    [
      "price",
      Number(kvQuote?.price),
      Number(d1Quote?.price)
    ],
    [
      "pricePerKm",
      Number(
        kvQuote?.pricing?.pricePerKm
      ),
      Number(
        d1Quote?.pricing?.pricePerKm
      )
    ],
    [
      "coefficient",
      Number(
        kvQuote?.pricing?.coefficient
      ),
      Number(
        d1Quote?.pricing?.coefficient
      )
    ],
    [
      "minimumPrice",
      Number(
        kvQuote?.pricing?.minimumPrice
      ),
      Number(
        d1Quote?.pricing?.minimumPrice
      )
    ],
    [
      "createdAt",
      Number(kvQuote?.createdAt),
      Number(d1Quote?.createdAt)
    ],
    [
      "expiresAt",
      Number(kvQuote?.expiresAt),
      Number(d1Quote?.expiresAt)
    ]
  ];

  const mismatchFields =
    fields
      .filter(
        ([, left, right]) =>
          left !== right
      )
      .map(
        ([name]) =>
          name
      );

  return {
    match:
      mismatchFields.length === 0,

    mismatchFields
  };
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

  if (
    !from
  ) {

    throw new Error(
      "Quote from is required"
    );
  }

  if (
    !to
  ) {

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

  if (
    !tariff
  ) {

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

  if (
    distance === null
  ) {

    throw new Error(
      "Quote distance is invalid"
    );
  }

  if (
    duration === null
  ) {

    throw new Error(
      "Quote duration is invalid"
    );
  }

  if (
    price === null
  ) {

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

  if (
    pricePerKm === null
  ) {

    throw new Error(
      "Quote pricePerKm is invalid"
    );
  }

  if (
    coefficient === null
  ) {

    throw new Error(
      "Quote coefficient is invalid"
    );
  }

  if (
    minimumPrice === null
  ) {

    throw new Error(
      "Quote minimumPrice is invalid"
    );
  }


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
  //
  // Пока QUOTES KV остаётся
  // production source of truth.
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


  // =========================
  // D1 SHADOW WRITE
  // =========================
  //
  // D1 получает копию quote.
  //
  // На этом этапе ошибка D1
  // НЕ должна ломать работающий
  // production flow.
  //
  // /orders пока продолжает
  // читать quote из QUOTES KV.
  // =========================

  try {

    await insertQuote(
      env,
      quote
    );

  } catch (
    error
  ) {

    console.error(
      "QUOTE D1 SHADOW WRITE ERROR:",
      {
        quoteId:
          quote.id,

        message:
          error?.message ||
          "unknown"
      }
    );
  }


  // =========================
  // LOG
  // =========================

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

  if (
    !key
  ) {

    return null;
  }

  const raw =
    await quotes.get(
      key
    );

  if (
    !raw
  ) {

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
  // =========================
// D1 SHADOW READ
// =========================
//
// Production source of truth
// всё ещё QUOTES KV.
//
// D1 только сравниваем.
// Даже если D1 недоступна,
// заказ продолжает работать
// по старой KV-схеме.
// =========================

try {

  const d1Quote =
    await getActiveQuoteById(
      env,
      quoteId
    );

  if (
    !d1Quote
  ) {

    console.warn(
      "QUOTE D1 SHADOW MISS:",
      {
        quoteId:
          quote.id
      }
    );

  } else {

    const comparison =
      compareQuotes(
        quote,
        d1Quote
      );

    if (
      comparison.match
    ) {

      console.log(
        "QUOTE D1 SHADOW MATCH:",
        {
          quoteId:
            quote.id
        }
      );

    } else {

      console.error(
        "QUOTE D1 SHADOW MISMATCH:",
        {
          quoteId:
            quote.id,

          fields:
            comparison.mismatchFields
        }
      );
    }
  }

} catch (
  error
) {

  console.error(
    "QUOTE D1 SHADOW READ ERROR:",
    {
      quoteId:
        quote.id,

      message:
        error?.message ||
        "unknown"
    }
  );
}

  return quote;
}


// =========================
// DELETE
// =========================
//
// После успешного создания заказа
// котировку можно удалить.
//
// Пока это удаление относится
// только к QUOTES KV.
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

  if (
    !key
  ) {

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