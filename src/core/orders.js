import {
  saveOrder
} from "./db.js";

import {
  tgSend
} from "./telegram.js";

import {
  getQuote,
  deleteQuote
} from "./quotes.js";


// =========================
// ORDER CONSTANTS
// =========================

export const ORDER_STATUS = {
  NEW:
    "new",

  TAKEN:
    "taken",

  IN_PROGRESS:
    "in_progress",

  DONE:
    "done",

  CANCELED:
    "canceled"
};


// =========================
// TEXT NORMALIZATION
// =========================

function cleanText(
  value,
  maxLength = 500
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
// COMMENT
// =========================

function cleanComment(
  value
) {

  return String(
    value ?? ""
  )
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
    String(
      value ?? ""
    )
      .trim();

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

  // HTML input[type=date]
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

  // crypto.randomUUID()
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
      from:
        "",

      to:
        ""
    };
  }

  const parts =
    text
      .split(
        /\s*(?:→|->)\s*/
      )
      .map(
        item =>
          item.trim()
      )
      .filter(
        Boolean
      );

  if (
    parts.length < 2
  ) {

    return {
      from:
        "",

      to:
        ""
    };
  }

  return {
    from:
      parts[0],

    to:
      parts
        .slice(1)
        .join(
          " → "
        )
  };
}


// =========================
// TELEGRAM FORMATTERS
// =========================

function tariffLabel(
  value
) {

  const tariff =
    String(
      value || ""
    )
      .trim()
      .toLowerCase();

  const labels = {
    comfort:
      "Комфорт",

    business:
      "Бизнес",

    minivan:
      "Минивэн"
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
    Number(
      value
    );

  if (
    !Number.isFinite(
      number
    )
  ) {

    return "";
  }

  return new Intl
    .NumberFormat(
      "ru-RU",
      {
        maximumFractionDigits:
          0
      }
    )
    .format(
      number
    );
}


function formatDistance(
  value
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

    return "";
  }

  return new Intl
    .NumberFormat(
      "ru-RU",
      {
        minimumFractionDigits:
          1,

        maximumFractionDigits:
          1
      }
    )
    .format(
      number
    );
}


function formatDuration(
  value
) {

  const totalMinutes =
    Math.max(
      0,
      Math.round(
        Number(
          value
        ) || 0
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
    String(
      value || ""
    )
      .trim();

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

  return (
    `${day}.${month}.${year}`
  );
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
    order.distance !==
      null
  ) {

    lines.push(
      `🛣 Расстояние: ${formatDistance(order.distance)} км`
    );
  }

  if (
    order.duration !==
      null
  ) {

    lines.push(
      `⏱ Время в пути: ${formatDuration(order.duration)}`
    );
  }

  if (
    order.price !==
      null
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

  return lines.join(
    "\n"
  );
}


// =========================
// MANUAL ORDER DATA
// =========================
//
// Если пользователь открыл форму
// без предварительного расчёта,
// заявку всё равно принимаем.
//
// Но price / tariff / distance / duration
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
      ok:
        false,

      error:
        "missing route"
    };
  }

  const parsed =
    parseRoute(
      route
    );

  return {
    ok:
      true,

    quoteId:
      null,

    route,

    from:
      parsed.from,

    to:
      parsed.to,

    tariff:
      null,

    distance:
      null,

    duration:
      null,

    price:
      null
  };
}


// =========================
// QUOTED ORDER DATA
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
      ok:
        false,

      status:
        400,

      error:
        "invalid quoteId"
    };
  }

  const quote =
    await getQuote(
      env,
      quoteId
    );

  if (!quote) {

    return {
      ok:
        false,

      status:
        409,

      error:
        "quote expired or not found"
    };
  }

  // =========================
  // TRUSTED SERVER DATA
  // =========================
  //
  // Здесь принципиально НЕ читаем:
  //
  // input.price
  // input.distance
  // input.duration
  // input.tariff
  // input.from
  // input.to
  //
  // Все эти данные берём только
  // из QUOTES KV.
  // =========================

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
    Number(
      quote.distance
    );

  const duration =
    Number(
      quote.duration
    );

  const price =
    Number(
      quote.price
    );

  if (
    !from ||
    !to
  ) {

    return {
      ok:
        false,

      status:
        500,

      error:
        "invalid quote route"
    };
  }

  if (
    ![
      "comfort",
      "business",
      "minivan"
    ].includes(
      tariff
    )
  ) {

    return {
      ok:
        false,

      status:
        500,

      error:
        "invalid quote tariff"
    };
  }

  if (
    !Number.isFinite(
      distance
    ) ||
    distance <= 0
  ) {

    return {
      ok:
        false,

      status:
        500,

      error:
        "invalid quote distance"
    };
  }

  if (
    !Number.isFinite(
      duration
    ) ||
    duration <= 0
  ) {

    return {
      ok:
        false,

      status:
        500,

      error:
        "invalid quote duration"
    };
  }

  if (
    !Number.isFinite(
      price
    ) ||
    price <= 0
  ) {

    return {
      ok:
        false,

      status:
        500,

      error:
        "invalid quote price"
    };
  }

  return {
    ok:
      true,

    quoteId,

    route:
      `${from} → ${to}`,

    from,

    to,

    tariff,

    distance,

    duration,

    price
  };
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
    typeof input !==
      "object"
  ) {

    return {
      ok:
        false,

      status:
        400,

      error:
        "invalid order data"
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
      ok:
        false,

      status:
        400,

      error:
        "missing name"
    };
  }

  if (!phone) {

    return {
      ok:
        false,

      status:
        400,

      error:
        "invalid phone"
    };
  }

  if (!date) {

    return {
      ok:
        false,

      status:
        400,

      error:
        "invalid date"
    };
  }

  // =========================
  // ROUTE SOURCE
  // =========================
  //
  // quoteId есть:
  //   доверяем только QUOTES.
  //
  // quoteId нет:
  //   обычная ручная заявка.
  // =========================

  let routeData;

  if (
    input.quoteId
  ) {

    routeData =
      await buildQuotedRouteData(
        input,
        env
      );

  } else {

    routeData =
      buildManualRouteData(
        input
      );
  }

  if (
    !routeData.ok
  ) {

    return {
      ok:
        false,

      status:
        routeData.status ||
        400,

      error:
        routeData.error ||
        "invalid route"
    };
  }

  // =========================
  // ORDER ENTITY
  // =========================

  const now =
    Date.now();

  const order = {

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
  // PERSISTENCE
  // =========================

  await saveOrder(
    env,
    order
  );

  // =========================
  // CONSUME QUOTE
  // =========================
  //
  // Удаляем только после того,
  // как заказ успешно сохранён.
  // =========================

  if (
    routeData.quoteId
  ) {

    try {

      await deleteQuote(
        env,
        routeData.quoteId
      );

    } catch (
      error
    ) {

      console.error(
        "QUOTE DELETE ERROR:",
        error
      );
    }
  }

  // =========================
  // TELEGRAM
  // =========================
  //
  // Ошибка Telegram не уничтожает
  // уже созданный заказ.
  // =========================

  try {

    await tgSend(
      env,
      buildTelegramMessage(
        order
      )
    );

  } catch (
    error
  ) {

    console.error(
      "ORDER TELEGRAM ERROR:",
      error
    );
  }

  return {
    ok:
      true,

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