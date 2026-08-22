import { saveOrder } from "./db.js";
import { tgSend } from "./telegram.js";

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

const ALLOWED_TARIFFS = new Set([
  "comfort",
  "comfort_plus",
  "comfort+",
  "business",
  "minivan"
]);

// =========================
// TEXT NORMALIZATION
// =========================
function cleanText(value, maxLength = 500) {

  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

// =========================
// COMMENT
// =========================
function cleanComment(value) {

  return String(value ?? "")
    .replace(
      /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,
      ""
    )
    .trim()
    .slice(0, 2000);
}

// =========================
// PHONE
// =========================
function normalizePhone(value) {

  const source =
    String(value ?? "").trim();

  const digits =
    source.replace(/\D/g, "");

  if (
    digits.length < 10 ||
    digits.length > 15
  ) {
    return null;
  }

  return source.slice(0, 40);
}

// =========================
// NUMBER
// =========================
function optionalNumber(value) {

  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return null;
  }

  const number = Number(value);

  if (
    !Number.isFinite(number) ||
    number < 0
  ) {
    return null;
  }

  return number;
}

// =========================
// TARIFF
// =========================
function normalizeTariff(value) {

  const tariff =
    String(value || "comfort")
      .toLowerCase()
      .trim();

  if (!ALLOWED_TARIFFS.has(tariff)) {
    return "comfort";
  }

  return tariff;
}

// =========================
// ROUTE PARSER
// =========================
function parseRoute(route) {

  const text = cleanText(
    route,
    300
  );

  if (!text) {
    return {
      from: "",
      to: ""
    };
  }

  const parts = text
    .split(/\s*(?:→|->)\s*/)
    .map(item => item.trim())
    .filter(Boolean);

  if (parts.length < 2) {
    return {
      from: "",
      to: ""
    };
  }

  return {
    from: parts[0],
    to: parts.slice(1).join(" → ")
  };
}

// =========================
// TELEGRAM FORMATTERS
// =========================

function tariffLabel(value) {

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

function formatPrice(value) {

  const number =
    Number(value);

  if (!Number.isFinite(number)) {
    return "";
  }

  return new Intl.NumberFormat(
    "ru-RU",
    {
      maximumFractionDigits: 0
    }
  ).format(number);
}

function formatDistance(value) {

  const number =
    Number(value);

  if (!Number.isFinite(number)) {
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

function formatDuration(value) {

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
    return `${hours} ч ${minutes} мин`;
  }

  if (hours > 0) {
    return `${hours} ч`;
  }

  return `${minutes} мин`;
}

function formatDate(value) {

  const source =
    String(value || "").trim();

  const match =
    source.match(
      /^(\d{4})-(\d{2})-(\d{2})$/
    );

  if (!match) {
    return source;
  }

  const [, year, month, day] =
    match;

  return `${day}.${month}.${year}`;
}

// =========================
// TELEGRAM MESSAGE
// =========================

function buildTelegramMessage(order) {

  const lines = [
    "🚖 Новая заявка",
    "",
    `🆔 ID: ${order.id}`,
    `👤 Клиент: ${order.name}`,
    `📞 Телефон: ${order.phone}`,
    "",
    `📍 Маршрут: ${order.route}`,
    `📅 Дата поездки: ${formatDate(order.date)}`,
    `🚘 Тариф: ${tariffLabel(order.tariff)}`
  ];

  if (order.distance !== null) {

    lines.push(
      `🛣 Расстояние: ${formatDistance(order.distance)} км`
    );
  }

  if (order.duration !== null) {

    lines.push(
      `⏱ Время в пути: ${formatDuration(order.duration)}`
    );
  }

  if (order.price !== null) {

    lines.push(
      `💰 Стоимость: ${formatPrice(order.price)} ₽`
    );
  }

  if (order.comment) {

    lines.push(
      "",
      `💬 Комментарий: ${order.comment}`
    );
  }

  return lines.join("\n");
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

  const name =
    cleanText(input.name, 100);

  const phone =
    normalizePhone(input.phone);

  const route =
    cleanText(input.route, 300);

  const date =
    cleanText(input.date, 40);

  const comment =
    cleanComment(input.comment);

  // =========================
  // REQUIRED FIELDS
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

  if (!route) {

    return {
      ok: false,
      status: 400,
      error: "missing route"
    };
  }

  if (!date) {

    return {
      ok: false,
      status: 400,
      error: "missing date"
    };
  }

  // =========================
  // CALCULATOR DATA
  // =========================
  const parsedRoute =
    parseRoute(route);

  const from =
    cleanText(
      input.from || parsedRoute.from,
      150
    );

  const to =
    cleanText(
      input.to || parsedRoute.to,
      150
    );

  const tariff =
    normalizeTariff(input.tariff);

  const distance =
    optionalNumber(input.distance);

  const duration =
    optionalNumber(input.duration);

  const price =
    optionalNumber(input.price);

  const now =
    Date.now();

  // =========================
  // ORDER ENTITY
  // =========================
  const order = {

    id: crypto.randomUUID(),

    name,
    phone,

    route,
    from,
    to,

    date,
    comment,

    tariff,

    distance,
    duration,
    price,

    status: ORDER_STATUS.NEW,

    driverId: null,

    createdAt: now,
    updatedAt: now
  };

  // =========================
  // PERSISTENCE
  // =========================
  await saveOrder(
    env,
    order
  );

  // =========================
  // TELEGRAM
  // =========================
  //
  // Ошибка Telegram НЕ должна уничтожать
  // уже созданную заявку.
  //
  try {

    await tgSend(
      env,
      buildTelegramMessage(order)
    );

  } catch (error) {

    console.error(
      "ORDER TELEGRAM ERROR:",
      error
    );
  }

  return {
    ok: true,
    order
  };
}

// =========================
// PUBLIC RESPONSE
// =========================
//
// Телефон, имя и другие персональные
// данные обратно клиенту не возвращаем.
//
export function orderReceipt(order) {

  return {
    id: order.id,
    status: order.status,
    createdAt: order.createdAt
  };
}