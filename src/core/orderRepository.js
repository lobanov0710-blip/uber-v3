// =========================================
// ORDER REPOSITORY
// Cloudflare D1
// =========================================
//
// Transactional order persistence.
//
// Quoted order:
//
// 1. INSERT order from active quote
// 2. UPDATE quote -> consumed_at
//
// Both statements execute inside one
// D1 batch transaction.
//
// Database invariant:
//
// orders.quote_id UNIQUE
//
// Therefore:
//
// 1 quoteId -> max 1 physical order
//
// Repeated requests return the existing
// order instead of creating a duplicate.
// =========================================


// =========================================
// DATABASE
// =========================================

function requireDatabase(env) {
  if (!env?.DB) {
    throw new Error(
      "D1 DB binding is not configured"
    );
  }

  return env.DB;
}


// =========================================
// VALIDATION
// =========================================

function requiredText(
  value,
  field
) {
  const text =
    String(value ?? "").trim();

  if (!text) {
    throw new Error(
      `Invalid order ${field}`
    );
  }

  return text;
}


function optionalText(value) {
  const text =
    String(value ?? "").trim();

  return text || null;
}


function requiredTimestamp(
  value,
  field
) {
  const number =
    Number(value);

  if (
    !Number.isSafeInteger(number) ||
    number <= 0
  ) {
    throw new Error(
      `Invalid order ${field}`
    );
  }

  return number;
}


// =========================================
// ROW -> DOMAIN
// =========================================

function mapOrderRow(row) {
  if (
    !row ||
    typeof row !== "object"
  ) {
    return null;
  }

  return {
    id:
      String(row.id),

    quoteId:
      row.quote_id === null
        ? null
        : String(row.quote_id),

    name:
      String(row.name),

    phone:
      String(row.phone),

    route:
      String(row.route),

    from:
      row.from_place === null
        ? ""
        : String(row.from_place),

    to:
      row.to_place === null
        ? ""
        : String(row.to_place),

    date:
      String(row.trip_date),

    comment:
      String(row.comment ?? ""),

    tariff:
      row.tariff === null
        ? null
        : String(row.tariff),

    distance:
      row.distance_km === null
        ? null
        : Number(row.distance_km),

    duration:
      row.duration_minutes === null
        ? null
        : Number(row.duration_minutes),

    price:
      row.price_rub === null
        ? null
        : Number(row.price_rub),

    status:
      String(row.status),

    driverId:
      row.driver_id === null
        ? null
        : String(row.driver_id),

    createdAt:
      Number(row.created_at),

    updatedAt:
      Number(row.updated_at)
  };
}


// =========================================
// COMMON SELECT
// =========================================

const ORDER_SELECT = `
  SELECT
    id,
    quote_id,
    name,
    phone,
    route,
    from_place,
    to_place,
    trip_date,
    comment,
    tariff,
    distance_km,
    duration_minutes,
    price_rub,
    status,
    driver_id,
    created_at,
    updated_at
  FROM orders
`;


// =========================================
// GET ORDER BY ID
// =========================================

export async function getOrderById(
  env,
  orderId
) {
  const id =
    String(orderId ?? "").trim();

  if (!id) {
    return null;
  }

  const db =
    requireDatabase(env);

  const row =
    await db
      .prepare(`
        ${ORDER_SELECT}
        WHERE id = ?1
        LIMIT 1
      `)
      .bind(id)
      .first();

  return mapOrderRow(row);
}


// =========================================
// GET ORDER BY QUOTE ID
// =========================================

export async function getOrderByQuoteId(
  env,
  quoteId
) {
  const id =
    String(quoteId ?? "").trim();

  if (!id) {
    return null;
  }

  const db =
    requireDatabase(env);

  const row =
    await db
      .prepare(`
        ${ORDER_SELECT}
        WHERE quote_id = ?1
        LIMIT 1
      `)
      .bind(id)
      .first();

  return mapOrderRow(row);
}

// =========================================
// LIST ORDERS
// =========================================
//
// D1 is the authoritative source
// of truth for order reads.
//
// The current private GET /orders route
// still performs role/status filtering
// itself. This repository method only
// returns persisted orders ordered
// newest first.
// =========================================

export async function listOrders(
  env,
  maxItems = 1000
) {

  const requestedLimit =
    Number(
      maxItems
    );

  const limit =
    Number.isInteger(
      requestedLimit
    )
      ? Math.max(
          1,
          Math.min(
            requestedLimit,
            1000
          )
        )
      : 1000;

  const db =
    requireDatabase(
      env
    );

  const result =
    await db
      .prepare(`
        ${ORDER_SELECT}

        ORDER BY created_at DESC

        LIMIT ?1
      `)
      .bind(
        limit
      )
      .all();

  if (
    result?.success !== true
  ) {

    throw new Error(
      "Order list read failed"
    );
  }

  const rows =
    Array.isArray(
      result.results
    )
      ? result.results
      : [];

  return rows
    .map(
      mapOrderRow
    )
    .filter(Boolean);
}


// =========================================
// INSERT MANUAL ORDER
// =========================================

export async function insertManualOrder(
  env,
  order
) {
  if (
    !order ||
    typeof order !== "object"
  ) {
    throw new Error(
      "Invalid manual order entity"
    );
  }

  const db =
    requireDatabase(env);

  const id =
    requiredText(
      order.id,
      "id"
    );

  const name =
    requiredText(
      order.name,
      "name"
    );

  const phone =
    requiredText(
      order.phone,
      "phone"
    );

  const route =
    requiredText(
      order.route,
      "route"
    );

  const date =
    requiredText(
      order.date,
      "date"
    );

  const status =
    requiredText(
      order.status,
      "status"
    );

  const createdAt =
    requiredTimestamp(
      order.createdAt,
      "createdAt"
    );

  const updatedAt =
    requiredTimestamp(
      order.updatedAt,
      "updatedAt"
    );

  const result =
    await db
      .prepare(`
        INSERT INTO orders (
          id,
          quote_id,
          name,
          phone,
          route,
          from_place,
          to_place,
          trip_date,
          comment,
          tariff,
          distance_km,
          duration_minutes,
          price_rub,
          status,
          driver_id,
          created_at,
          updated_at
        )
        VALUES (
          ?1,
          NULL,
          ?2,
          ?3,
          ?4,
          ?5,
          ?6,
          ?7,
          ?8,
          NULL,
          NULL,
          NULL,
          NULL,
          ?9,
          NULL,
          ?10,
          ?11
        )
      `)
      .bind(
        id,
        name,
        phone,
        route,
        optionalText(order.from),
        optionalText(order.to),
        date,
        String(order.comment ?? ""),
        status,
        createdAt,
        updatedAt
      )
      .run();

  if (
    result?.success !== true
  ) {
    throw new Error(
      "Manual order insert failed"
    );
  }

  const persistedOrder =
    await getOrderById(
      env,
      id
    );

  if (!persistedOrder) {
    throw new Error(
      "Manual order readback failed"
    );
  }

  return {
    ok: true,
    created: true,
    idempotent: false,
    order: persistedOrder
  };
}


// =========================================
// INSERT QUOTED ORDER
// =========================================

export async function insertQuotedOrder(
  env,
  order
) {
  if (
    !order ||
    typeof order !== "object"
  ) {
    throw new Error(
      "Invalid quoted order entity"
    );
  }

  const db =
    requireDatabase(env);

  const id =
    requiredText(
      order.id,
      "id"
    );

  const quoteId =
    requiredText(
      order.quoteId,
      "quoteId"
    );

  const name =
    requiredText(
      order.name,
      "name"
    );

  const phone =
    requiredText(
      order.phone,
      "phone"
    );

  const date =
    requiredText(
      order.date,
      "date"
    );

  const status =
    requiredText(
      order.status,
      "status"
    );

  const createdAt =
    requiredTimestamp(
      order.createdAt,
      "createdAt"
    );

  const updatedAt =
    requiredTimestamp(
      order.updatedAt,
      "updatedAt"
    );


  // =========================================
  // IDEMPOTENT FAST PATH
  // =========================================

  const existingOrder =
    await getOrderByQuoteId(
      env,
      quoteId
    );

  if (existingOrder) {
    return {
      ok: true,
      created: false,
      idempotent: true,
      order: existingOrder
    };
  }


  // =========================================
  // TRANSACTIONAL INSERT
  // =========================================
  //
  // Statement 1:
  // Create order only from an active quote.
  //
  // Statement 2:
  // Consume exactly that active quote.
  //
  // Both statements execute in one
  // D1 batch transaction.
  // =========================================

  const insertStatement =
    db
      .prepare(`
        INSERT INTO orders (
          id,
          quote_id,
          name,
          phone,
          route,
          from_place,
          to_place,
          trip_date,
          comment,
          tariff,
          distance_km,
          duration_minutes,
          price_rub,
          status,
          driver_id,
          created_at,
          updated_at
        )

        SELECT
          ?1,
          q.id,
          ?2,
          ?3,
          q.from_place || ' → ' || q.to_place,
          q.from_place,
          q.to_place,
          ?4,
          ?5,
          q.tariff,
          q.distance_km,
          q.duration_minutes,
          q.price_rub,
          ?6,
          NULL,
          ?7,
          ?8

        FROM quotes AS q

        WHERE q.id = ?9
          AND q.consumed_at IS NULL
          AND q.expires_at > ?7
      `)
      .bind(
        id,
        name,
        phone,
        date,
        String(order.comment ?? ""),
        status,
        createdAt,
        updatedAt,
        quoteId
      );


  const consumeStatement =
    db
      .prepare(`
        UPDATE quotes

        SET consumed_at = ?1

        WHERE id = ?2
          AND consumed_at IS NULL
          AND expires_at > ?1
      `)
      .bind(
        createdAt,
        quoteId
      );


  try {
    const results =
      await db.batch([
        insertStatement,
        consumeStatement
      ]);

    if (
      !Array.isArray(results) ||
      results.length !== 2
    ) {
      throw new Error(
        "Invalid D1 batch result"
      );
    }

    if (
      results[0]?.success !== true ||
      results[1]?.success !== true
    ) {
      throw new Error(
        "Quoted order transaction failed"
      );
    }

  } catch (error) {

    // =====================================
    // CONCURRENT REQUEST / RETRY
    // =====================================
    //
    // UNIQUE(orders.quote_id) may reject
    // a competing request.
    //
    // In that case return the order which
    // already won the race.
    // =====================================

    const concurrentOrder =
      await getOrderByQuoteId(
        env,
        quoteId
      );

    if (concurrentOrder) {
      return {
        ok: true,
        created: false,
        idempotent: true,
        order: concurrentOrder
      };
    }

    throw error;
  }


  // =========================================
  // DID THIS REQUEST CREATE THE ORDER?
  // =========================================

  const createdOrder =
    await getOrderById(
      env,
      id
    );

  if (createdOrder) {
    return {
      ok: true,
      created: true,
      idempotent: false,
      order: createdOrder
    };
  }


  // =========================================
  // ANOTHER REQUEST MAY HAVE WON
  // =========================================

  const concurrentOrder =
    await getOrderByQuoteId(
      env,
      quoteId
    );

  if (concurrentOrder) {
    return {
      ok: true,
      created: false,
      idempotent: true,
      order: concurrentOrder
    };
  }


  // =========================================
  // QUOTE WAS NOT AVAILABLE
  // =========================================
  //
  // Possible reasons:
  //
  // - quote does not exist
  // - quote expired
  // - quote already consumed
  //
  // INSERT changed zero rows and UPDATE
  // also changed zero rows.
  // =========================================

  return {
    ok: false,
    reason: "quote_not_available"
  };
}