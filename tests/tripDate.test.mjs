import assert from "node:assert/strict";
import {
  normalizeTripDate,
  isBookableTripDate,
  moscowToday
} from "../src/core/tripDate.js";

// Moscow is UTC+3; at 21:00 UTC its next calendar day has begun.
const beforeMidnight = new Date("2026-10-21T20:59:59.000Z");
const afterMidnight = new Date("2026-10-21T21:00:00.000Z");

assert.equal(moscowToday(beforeMidnight), "2026-10-21");
assert.equal(moscowToday(afterMidnight), "2026-10-22");

assert.equal(normalizeTripDate("2024-02-29"), "2024-02-29");
for (const date of [
  "2025-02-29", "2026-02-30", "2026-13-01", "2026-00-01",
  "2026-04-31", "2026-01-00", "2026-10-1", "22.10.2026"
]) {
  assert.equal(normalizeTripDate(date), null, date);
}
assert.equal(isBookableTripDate("2026-10-20", beforeMidnight), false);
assert.equal(isBookableTripDate("2026-10-21", beforeMidnight), true);
assert.equal(isBookableTripDate("2026-10-21", afterMidnight), false);
assert.equal(isBookableTripDate("2026-10-22", afterMidnight), true);
assert.equal(isBookableTripDate("2026-10-23", afterMidnight), true);
assert.equal(isBookableTripDate("2025-02-29", afterMidnight), false);
assert.equal(isBookableTripDate("2024-02-29", new Date("2024-02-28T12:00:00.000Z")), true);

console.log("Trip-date validation in Europe/Moscow: OK");
