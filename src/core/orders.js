import {
  saveOrder
} from "./db.js";

import {
  tgSend
} from "./telegram.js";

import {
  insertManualOrder,
  insertQuotedOrder,
  getOrderByQuoteId
} from "./orderRepository.js";

import {
  getActiveQuoteById
} from "./quoteRepository.js";


// =========================
// ORDER CONSTANTS
// =========================

export const ORDER_STATUS = {
  NEW: "new",
  TAKEN: "taken",
  IN_PROGRESS: "in_progress",
  DONE: "done",
  CANCELED: "canceled"
};


// =========================
// TEXT NORMALIZATION
// =========================

function cleanText(
  value,
  maxLength = 500
) {
  return String(value ?? "")
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
// COMMENT
// =========================

function cleanComment(
  value
) {
  return String(value ?? "")
    .replace(
      /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,
      ""
    )
    .trim()
    .slice(
      0,
      2000
    );
}


// =========================
// PHONE
// =========================

function normalizePhone(
  value
) {
  const source =
    String(value ?? "").trim();

  const digits =
    source.replace(
      /\D/g,
      ""
    );

  if (
    digits.length < 10 ||
    digits.length > 15
  ) {
    return null;
  }

  return source.slice(
    0,
    40
  );
}


// =========================
// DATE
// =========================

function normalizeDate(
  value
) {
  const source =
    cleanText(
      value,
      40
    );

  if (!source) {
    return null;
  }

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(
      source
    )
  ) {
    return null;
  }

  return source;
}


// =========================
// QUOTE ID
// =========================

function normalizeQuoteId(
  value
) {
  const quoteId =
    cleanText(
      value,
      100
    );

  if (!quoteId) {
    return null;
  }

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(
        quoteId
      )
  ) {
    return null;
  }

  return quoteId;
}


// =========================
// ROUTE PARSER
// =========================

function parseRoute(
  route
) {
  const text =
    cleanText(
      route,
      300
    );

  if (!text) {
    return {
      from: "",
      to: ""
    };
  }

  const parts =
    text
      .split(
        /\s*(?:→|->)\s*/
      )
      .map(
        item => item.trim()
      )
      .filter(Boolean);

  if (
    parts.length < 2
  ) {
    return {
      from: "",
      to: ""
    };
  }

  return {
    from:
      parts[0],

    to:
      parts
        .slice(1)
        .join(" → ")
  };
}


// =========================
// TELEGRAM FORMATTERS
// =========================

function tariffLabel(
  value
) {
  const tariff =
    String(value || "")
      .trim()
      .toLowerCase();

  const labels = {
    comfort: "Комфорт",
    business: "Бизнес",
    minivan: "Минивэн"
  };

  return (
    labels[tariff] ||
    tariff ||
    "Не указан"
  );
}


function formatPrice(
  value
) {
  const number =
    Number(value);

  if (
    !Number.isFinite(number)
  ) {
    return "";
  }

  return new Intl.NumberFormat(
    "ru-RU",
    {
      maximumFractionDigits: 0
    }
  ).format(number);
}


function formatDistance(
  value
) {
  const number =
    Number(value);

  if (
    !Number.isFinite(number)
  ) {
    return "";
  }

  return new Intl.NumberFormat(
    "ru-RU",
    {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1
    }
  ).format(number);
}


function formatDuration(
  value
) {
  const totalMinutes =
    Math.max(
      0,
      Math.round(
        Number(value) || 0
      )
    );

  const hours =
    Math.floor(
      totalMinutes / 60
    );

  const minutes =
    totalMinutes % 60;

  if (
    hours > 0 &&
    minutes > 0
  ) {
    return (
      `${hours} ч ` +
      `${minutes} мин`
    );
  }

  if (
    hours > 0
  ) {
    return `${hours} ч`;
  }

  return `${minutes} мин`;
}


function formatDate(
  value
) {
  const source =
    String(value || "").trim();

  const match =
    source.match(
      /^(\d{4})-(\d{2})-(\d{2})$/
    );

  if (!match) {
    return source;
  }

  const [
    ,
    year,
    month,
    day
  ] = match;

  return `${day}.${month}.${year}`;
}


// =========================
// TELEGRAM MESSAGE
// =========================

function buildTelegramMessage(
  order
) {
  const lines = [
    "🚖 Новая заявка",
    "",
    `🆔 ID: ${order.id}`,
    `👤 Клиент: ${order.name}`,
    `📞 Телефон: ${order.phone}`,
    "",
    `📍 Маршрут: ${order.route}`,
    `📅 Дата поездки: ${formatDate(order.date)}`
  ];

  if (
    order.quoteId
  ) {
    lines.push(
      `🚘 Тариф: ${tariffLabel(order.tariff)}`
    );
  }

  if (
    order.distance !== null
  ) {
    lines.push(
      `🛣 Расстояние: ${formatDistance(order.distance)} км`
    );
  }

  if (
    order.duration !== null
  ) {
    lines.push(
      `⏱ Время в пути: ${formatDuration(order.duration)}`
    );
  }

  if (
    order.price !== null
  ) {
    lines.push(
      `💰 Стоимость: ${formatPrice(order.price)} ₽`
    );
  }

  if (
    order.comment
  ) {
    lines.push(
      "",
      `💬 Комментарий: ${order.comment}`
    );
  }

  return lines.join("\n");
}


// =========================
// MANUAL ORDER DATA
// =========================
//
// Если пользователь открыл форму
// без предварительного расчёта,
// заявку всё равно принимаем.
//
// price / tariff / distance / duration
// из браузера НЕ используем.
// =========================

function buildManualRouteData(
  input
) {
  const route =
    cleanText(
      input.route,
      300
    );

  if (!route) {
    return {
      ok: false,
      error: "missing route"
    };
  }

  const parsed =
    parseRoute(route);

  return {
    ok: true,
    quoteId: null,
    route,
    from: parsed.from,
    to: parsed.to,
    tariff: null,
    distance: null,
    duration: null,
    price: null
  };
}


// =========================
// QUOTED ORDER DATA
// =========================
//
// D1 quotes = source of truth.
// Browser pricing/route fields are ignored.
// =========================

async function buildQuotedRouteData(
  input,
  env
) {
  const quoteId =
    normalizeQuoteId(
      input.quoteId
    );

  if (!quoteId) {
    return {
      ok: false,
      status: 400,
      error: "invalid quoteId"
    };
  }

  const quote =
    await getActiveQuoteById(
      env,
      quoteId
    );

  if (!quote) {
    return {
      ok: false,
      status: 409,
      error: "quote expired or not found"
    };
  }

  const from =
    cleanText(
      quote.from,
      200
    );

  const to =
    cleanText(
      quote.to,
      200
    );

  const tariff =
    cleanText(
      quote.tariff,
      40
    )
      .toLowerCase();

  const distance =
    Number(quote.distance);

  const duration =
    Number(quote.duration);

  const price =
    Number(quote.price);

  if (
    !from ||
    !to
  ) {
    return {
      ok: false,
      status: 500,
      error: "invalid quote route"
    };
  }

  if (
    ![
      "comfort",
      "business",
      "minivan"
    ].includes(tariff)
  ) {
    return {
      ok: false,
      status: 500,
      error: "invalid quote tariff"
    };
  }

  if (
    !Number.isFinite(distance) ||
    distance <= 0
  ) {
    return {
      ok: false,
      status: 500,
      error: "invalid quote distance"
    };
  }

  if (
    !Number.isFinite(duration) ||
    duration <= 0
  ) {
    return {
      ok: false,
      status: 500,
      error: "invalid quote duration"
    };
  }

  if (
    !Number.isFinite(price) ||
    price <= 0
  ) {
    return {
      ok: false,
      status: 500,
      error: "invalid quote price"
    };
  }

  return {
    ok: true,
    quoteId,
    route: `${from} → ${to}`,
    from,
    to,
    tariff,
    distance,
    duration,
    price
  };
}


// =========================
// IDEMPOTENT SUBMISSION CHECK
// =========================
//
// Один и тот же quoteId можно безопасно
// повторить только с теми же данными клиента.
// =========================

function isSameSubmission(
  order,
  customer
) {
  if (!order) {
    return false;
  }

  const existingPhoneDigits =
    String(order.phone ?? "")
      .replace(/\D/g, "");

  const requestPhoneDigits =
    String(customer.phone ?? "")
      .replace(/\D/g, "");

  return (
    cleanText(
      order.name,
      100
    ) === customer.name &&

    existingPhoneDigits ===
      requestPhoneDigits &&

    String(order.date ?? "") ===
      customer.date &&

    cleanComment(
      order.comment
    ) === customer.comment
  );
}


// =========================
// KV ORDER MIRROR
// =========================
//
// D1 = source of truth.
// ORDERS KV временно поддерживаем,
// потому что GET /orders пока читает KV.
// =========================

async function mirrorOrderToKv(
  env,
  order
) {
  try {
    await saveOrder(
      env,
      order
    );
  } catch (error) {
    console.error(
      "ORDER KV MIRROR ERROR:",
      {
        orderId:
          order?.id || null,

        message:
          error?.message ||
          "unknown"
      }
    );
  }
}

// =========================
// CREATE ORDER
// =========================

export async function createOrder(
  input,
  env
) {
  if (
    !input ||
    typeof input !== "object"
  ) {
    return {
      ok: false,
      status: 400,
      error: "invalid order data"
    };
  }


  // =========================
  // CUSTOMER DATA
  // =========================

  const name =
    cleanText(
      input.name,
      100
    );

  const phone =
    normalizePhone(
      input.phone
    );

  const date =
    normalizeDate(
      input.date
    );

  const comment =
    cleanComment(
      input.comment
    );


  // =========================
  // REQUIRED CUSTOMER FIELDS
  // =========================

  if (!name) {
    return {
      ok: false,
      status: 400,
      error: "missing name"
    };
  }

  if (!phone) {
    return {
      ok: false,
      status: 400,
      error: "invalid phone"
    };
  }

  if (!date) {
    return {
      ok: false,
      status: 400,
      error: "invalid date"
    };
  }

  const customerData = {
    name,
    phone,
    date,
    comment
  };


  // =========================
  // QUOTE ID
  // =========================

  let normalizedQuoteId =
    null;

  if (input.quoteId) {
    normalizedQuoteId =
      normalizeQuoteId(
        input.quoteId
      );

    if (!normalizedQuoteId) {
      return {
        ok: false,
        status: 400,
        error: "invalid quoteId"
      };
    }
  }


  // =========================
  // IDEMPOTENT RETRY
  // =========================
  //
  // existing order проверяем ДО active quote.
  //
  // После первого успешного заказа quote
  // уже consumed в D1.
  // =========================

  if (normalizedQuoteId) {
    const existingOrder =
      await getOrderByQuoteId(
        env,
        normalizedQuoteId
      );

    if (existingOrder) {
      if (
        !isSameSubmission(
          existingOrder,
          customerData
        )
      ) {
        return {
          ok: false,
          status: 409,
          error: "quote already used"
        };
      }

      await mirrorOrderToKv(
        env,
        existingOrder
      );

      return {
        ok: true,
        idempotent: true,
        order: existingOrder
      };
    }
  }


  // =========================
  // ROUTE SOURCE
  // =========================

  let routeData;

  if (normalizedQuoteId) {
    routeData =
      await buildQuotedRouteData(
        {
          ...input,
          quoteId:
            normalizedQuoteId
        },
        env
      );
  } else {
    routeData =
      buildManualRouteData(
        input
      );
  }

  if (!routeData.ok) {
    return {
      ok: false,

      status:
        routeData.status ||
        400,

      error:
        routeData.error ||
        "invalid route"
    };
  }


  // =========================
  // ORDER CANDIDATE
  // =========================

  const now =
    Date.now();

  const candidateOrder = {
    id:
      crypto.randomUUID(),

    quoteId:
      routeData.quoteId,

    name,
    phone,

    route:
      routeData.route,

    from:
      routeData.from,

    to:
      routeData.to,

    date,
    comment,

    tariff:
      routeData.tariff,

    distance:
      routeData.distance,

    duration:
      routeData.duration,

    price:
      routeData.price,

    status:
      ORDER_STATUS.NEW,

    driverId:
      null,

    createdAt:
      now,

    updatedAt:
      now
  };


  // =========================
  // D1 PERSISTENCE
  // =========================

  let persistenceResult;

  if (routeData.quoteId) {
    persistenceResult =
      await insertQuotedOrder(
        env,
        candidateOrder
      );
  } else {
    persistenceResult =
      await insertManualOrder(
        env,
        candidateOrder
      );
  }


  // =========================
  // PERSISTENCE FAILURE
  // =========================

  if (
    !persistenceResult?.ok
  ) {
    if (
      persistenceResult?.reason ===
      "quote_not_available"
    ) {
      return {
        ok: false,
        status: 409,
        error:
          "quote expired or already used"
      };
    }

    throw new Error(
      "Order persistence failed"
    );
  }

  const order =
    persistenceResult.order;

  if (!order?.id) {
    throw new Error(
      "Persisted order is invalid"
    );
  }


  // =========================
  // CONCURRENT QUOTE USE
  // =========================
  //
  // insertQuotedOrder() может вернуть
  // существующий заказ, если другой запрос
  // выиграл race.
  // =========================

  if (
    routeData.quoteId &&
    persistenceResult.created === false
  ) {
    if (
      !isSameSubmission(
        order,
        customerData
      )
    ) {
      return {
        ok: false,
        status: 409,
        error: "quote already used"
      };
    }
  }


  // =========================
  // KV MIRROR
  // =========================

  await mirrorOrderToKv(
    env,
    order
  );
  
  // =========================
  // TELEGRAM
  // =========================
  //
  // Только реально новый D1-order
  // отправляет уведомление.
  //
  // Повторный/idempotent POST Telegram
  // второй раз не отправляет.
  // =========================

  if (
    persistenceResult.created === true
  ) {
    try {
      await tgSend(
        env,
        buildTelegramMessage(
          order
        )
      );
    } catch (error) {
      console.error(
        "ORDER TELEGRAM ERROR:",
        error
      );
    }
  }

  return {
    ok: true,

    idempotent:
      persistenceResult
        .idempotent === true,

    order
  };
}


// =========================
// PUBLIC RESPONSE
// =========================

export function orderReceipt(
  order
) {
  return {
    id:
      order.id,

    status:
      order.status,

    createdAt:
      order.createdAt
  };
}