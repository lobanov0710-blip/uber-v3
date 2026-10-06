// =========================================
// QUOTE REPOSITORY
// Cloudflare D1
// =========================================
//
// Persistence layer for quote entities.
//
// D1 is the authoritative source
// of truth for quotes.
//
// Domain logic such as:
// - validation
// - quoteId generation
// - TTL calculation
//
// remains outside this repository.
//
// This repository is used by both:
// - quote creation
// - quoted order creation
// =========================================


// =========================================
// DATABASE
// =========================================

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


// =========================================
// NUMBER
// =========================================

function requiredNumber(
  value,
  field
) {

  const number =
    Number(
      value
    );

  if (
    !Number.isFinite(
      number
    )
  ) {

    throw new Error(
      `Invalid quote ${field}`
    );
  }

  return number;
}


// =========================================
// INSERT QUOTE
// =========================================

export async function insertQuote(
  env,
  quote
) {

  if (
    !quote ||
    typeof quote !== "object"
  ) {

    throw new Error(
      "Invalid quote entity"
    );
  }

  const db =
    requireDatabase(
      env
    );

  const pricing =
    quote.pricing &&
    typeof quote.pricing === "object"
      ? quote.pricing
      : {};

  const statement =
    db.prepare(
      `
      INSERT INTO quotes (
        id,
        from_place,
        to_place,
        tariff,
        tariff_name,
        distance_km,
        duration_minutes,
        price_rub,
        price_per_km,
        coefficient,
        minimum_price_rub,
        created_at,
        expires_at,
        consumed_at
      )
      VALUES (
        ?1,
        ?2,
        ?3,
        ?4,
        ?5,
        ?6,
        ?7,
        ?8,
        ?9,
        ?10,
        ?11,
        ?12,
        ?13,
        NULL
      )
      `
    )
      .bind(
        String(
          quote.id
        ),

        String(
          quote.from
        ),

        String(
          quote.to
        ),

        String(
          quote.tariff
        ),

        String(
          quote.tariffName
        ),

        requiredNumber(
          quote.distance,
          "distance"
        ),

        requiredNumber(
          quote.duration,
          "duration"
        ),

        requiredNumber(
          quote.price,
          "price"
        ),

        requiredNumber(
          pricing.pricePerKm,
          "pricePerKm"
        ),

        requiredNumber(
          pricing.coefficient,
          "coefficient"
        ),

        requiredNumber(
          pricing.minimumPrice,
          "minimumPrice"
        ),

        requiredNumber(
          quote.createdAt,
          "createdAt"
        ),

        requiredNumber(
          quote.expiresAt,
          "expiresAt"
        )
      );

  const result =
    await statement.run();

  if (
    result?.success !== true
  ) {

    throw new Error(
      "Quote insert failed"
    );
  }

  return quote;
}


// =========================================
// ROW -> DOMAIN
// =========================================

function mapQuoteRow(
  row
) {

  if (
    !row ||
    typeof row !== "object"
  ) {

    return null;
  }

  return {

    id:
      String(
        row.id
      ),

    from:
      String(
        row.from_place
      ),

    to:
      String(
        row.to_place
      ),

    tariff:
      String(
        row.tariff
      ),

    tariffName:
      String(
        row.tariff_name
      ),

    distance:
      Number(
        row.distance_km
      ),

    duration:
      Number(
        row.duration_minutes
      ),

    price:
      Number(
        row.price_rub
      ),

    pricing: {

      pricePerKm:
        Number(
          row.price_per_km
        ),

      coefficient:
        Number(
          row.coefficient
        ),

      minimumPrice:
        Number(
          row.minimum_price_rub
        )
    },

    createdAt:
      Number(
        row.created_at
      ),

    expiresAt:
      Number(
        row.expires_at
      ),

    consumedAt:
      row.consumed_at === null
        ? null
        : Number(
            row.consumed_at
          )
  };
}


// =========================================
// GET QUOTE
// =========================================

export async function getQuoteById(
  env,
  quoteId
) {

  const id =
    String(
      quoteId || ""
    )
      .trim();

  if (!id) {
    return null;
  }

  const db =
    requireDatabase(
      env
    );

  const row =
    await db
      .prepare(
        `
        SELECT
          id,
          from_place,
          to_place,
          tariff,
          tariff_name,
          distance_km,
          duration_minutes,
          price_rub,
          price_per_km,
          coefficient,
          minimum_price_rub,
          created_at,
          expires_at,
          consumed_at
        FROM quotes
        WHERE id = ?1
        LIMIT 1
        `
      )
      .bind(
        id
      )
      .first();

  return mapQuoteRow(
    row
  );
}


// =========================================
// GET ACTIVE QUOTE
// =========================================

export async function getActiveQuoteById(
  env,
  quoteId,
  now = Date.now()
) {

  const id =
    String(
      quoteId || ""
    )
      .trim();

  if (!id) {
    return null;
  }

  const currentTime =
    requiredNumber(
      now,
      "currentTime"
    );

  const db =
    requireDatabase(
      env
    );

  const row =
    await db
      .prepare(
        `
        SELECT
          id,
          from_place,
          to_place,
          tariff,
          tariff_name,
          distance_km,
          duration_minutes,
          price_rub,
          price_per_km,
          coefficient,
          minimum_price_rub,
          created_at,
          expires_at,
          consumed_at
        FROM quotes
        WHERE id = ?1
          AND consumed_at IS NULL
          AND expires_at > ?2
        LIMIT 1
        `
      )
      .bind(
        id,
        currentTime
      )
      .first();

  return mapQuoteRow(
    row
  );
}