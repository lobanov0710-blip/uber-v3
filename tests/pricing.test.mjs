import assert from "node:assert/strict";

import {
  calculatePrice,
  normalizeTariff
} from "../src/core/pricing.js";

// ========================================
// SIMPLE TEST RUNNER
// ========================================

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✘ ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

// ========================================
// TARIFF NORMALIZATION
// ========================================

test("comfort tariff is valid", () => {
  assert.equal(
    normalizeTariff("comfort"),
    "comfort"
  );
});

test("business tariff is valid", () => {
  assert.equal(
    normalizeTariff("business"),
    "business"
  );
});

test("minivan tariff is valid", () => {
  assert.equal(
    normalizeTariff("minivan"),
    "minivan"
  );
});

test("unknown tariff is rejected", () => {
  assert.equal(
    normalizeTariff("econom"),
    null
  );
});

// ========================================
// COMFORT
// 55 RUB / KM
// ========================================

test("Comfort: minimum price", () => {
  const result =
    calculatePrice(
      20,
      "comfort"
    );

  assert.equal(result.ok, true);
  assert.equal(result.pricePerKm, 55);
  assert.equal(result.coefficient, 1.60);
  assert.equal(result.price, 4000);
});

test("Comfort: under 100 km", () => {
  const result =
    calculatePrice(
      80,
      "comfort"
    );

  assert.equal(result.coefficient, 1.60);
  assert.equal(result.price, 7040);
});

test("Comfort: 100-200 km", () => {
  const result =
    calculatePrice(
      150,
      "comfort"
    );

  assert.equal(result.coefficient, 1.30);
  assert.equal(result.price, 10725);
});

test("Comfort: 200-300 km", () => {
  const result =
    calculatePrice(
      250,
      "comfort"
    );

  assert.equal(result.coefficient, 1.15);
  assert.equal(result.price, 15813);
});

test("Comfort: 300+ km", () => {
  const result =
    calculatePrice(
      400,
      "comfort"
    );

  assert.equal(result.coefficient, 1.00);
  assert.equal(result.price, 22000);
});

// ========================================
// BUSINESS
// 75 RUB / KM
// ========================================

test("Business: minimum price", () => {
  const result =
    calculatePrice(
      20,
      "business"
    );

  assert.equal(result.ok, true);
  assert.equal(result.pricePerKm, 75);
  assert.equal(result.coefficient, 1.60);
  assert.equal(result.price, 6000);
});

test("Business: under 100 km", () => {
  const result =
    calculatePrice(
      80,
      "business"
    );

  assert.equal(result.coefficient, 1.60);
  assert.equal(result.price, 9600);
});

test("Business: 100-200 km", () => {
  const result =
    calculatePrice(
      150,
      "business"
    );

  assert.equal(result.coefficient, 1.30);
  assert.equal(result.price, 14625);
});

test("Business: 200-300 km", () => {
  const result =
    calculatePrice(
      250,
      "business"
    );

  assert.equal(result.coefficient, 1.15);
  assert.equal(result.price, 21563);
});

test("Business: 300+ km", () => {
  const result =
    calculatePrice(
      400,
      "business"
    );

  assert.equal(result.coefficient, 1.00);
  assert.equal(result.price, 30000);
});

// ========================================
// MINIVAN
// 80 RUB / KM
// ========================================

test("Minivan: minimum price", () => {
  const result =
    calculatePrice(
      20,
      "minivan"
    );

  assert.equal(result.ok, true);
  assert.equal(result.pricePerKm, 80);
  assert.equal(result.coefficient, 1.60);
  assert.equal(result.price, 5000);
});

test("Minivan: under 100 km", () => {
  const result =
    calculatePrice(
      80,
      "minivan"
    );

  assert.equal(result.coefficient, 1.60);
  assert.equal(result.price, 10240);
});

test("Minivan: 100-200 km", () => {
  const result =
    calculatePrice(
      150,
      "minivan"
    );

  assert.equal(result.coefficient, 1.30);
  assert.equal(result.price, 15600);
});

test("Minivan: 200-300 km", () => {
  const result =
    calculatePrice(
      250,
      "minivan"
    );

  assert.equal(result.coefficient, 1.15);
  assert.equal(result.price, 23000);
});

test("Minivan: 300+ km", () => {
  const result =
    calculatePrice(
      400,
      "minivan"
    );

  assert.equal(result.coefficient, 1.00);
  assert.equal(result.price, 32000);
});

// ========================================
// BOUNDARIES
// ========================================

test("99.9 km uses 1.60", () => {
  const result =
    calculatePrice(
      99.9,
      "comfort"
    );

  assert.equal(
    result.coefficient,
    1.60
  );
});

test("100 km uses 1.30", () => {
  const result =
    calculatePrice(
      100,
      "comfort"
    );

  assert.equal(
    result.coefficient,
    1.30
  );
});

test("200 km uses 1.15", () => {
  const result =
    calculatePrice(
      200,
      "comfort"
    );

  assert.equal(
    result.coefficient,
    1.15
  );
});

test("300 km uses 1.00", () => {
  const result =
    calculatePrice(
      300,
      "comfort"
    );

  assert.equal(
    result.coefficient,
    1.00
  );
});

// ========================================
// INVALID INPUT
// ========================================

test("zero distance is rejected", () => {
  const result =
    calculatePrice(
      0,
      "comfort"
    );

  assert.equal(result.ok, false);
});

test("negative distance is rejected", () => {
  const result =
    calculatePrice(
      -100,
      "comfort"
    );

  assert.equal(result.ok, false);
});

test("invalid tariff is rejected", () => {
  const result =
    calculatePrice(
      400,
      "econom"
    );

  assert.equal(result.ok, false);
});

console.log("");

if (!process.exitCode) {
  console.log(
    "✓ ALL PRICING TESTS PASSED"
  );
}