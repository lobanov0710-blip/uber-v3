/**
 * Trip dates are civil calendar dates in the dispatcher's Europe/Moscow zone.
 * Compare ISO calendar strings, never UTC midnight timestamps.
 */
const MOSCOW_DATE = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Moscow",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

export function normalizeTripDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const date = new Date(value + "T00:00:00.000Z");
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    return null;
  }
  return value;
}

export function moscowToday(now = new Date()) {
  const parts = MOSCOW_DATE.formatToParts(now);
  const component = type => parts.find(item => item.type === type)?.value;
  return component("year") + "-" + component("month") + "-" + component("day");
}

export function isBookableTripDate(value, now = new Date()) {
  const normalized = normalizeTripDate(value);
  return normalized !== null && normalized >= moscowToday(now);
}
