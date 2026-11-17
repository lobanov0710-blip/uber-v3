import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateVehicleClassification as evaluate } from "../src/core/vehicleClassification.js";

const rule = { make: "Toyota", model: "Camry", minYear: 2020, vehicleClass: "comfort", version: "catalog-v1" };
const input = { make: "Toyota", model: "Camry", year: 2020, powertrain: "hybrid", powertrainVerified: true };

test("an exact eligible rule returns a candidate and its version, not approval", () => {
  assert.deepEqual(evaluate(input, rule), { ok: true, outcome: "candidate", vehicleClass: "comfort", ruleVersion: "catalog-v1" });
  assert.deepEqual(evaluate({ ...input, year: 2021, powertrain: "combustion" }, rule).outcome, "candidate");
});

test("missing model or year below the rule requires manual review without assigning class", () => {
  assert.deepEqual(evaluate(input, null), { ok: true, outcome: "manual_review", reason: "model_not_found" });
  assert.deepEqual(evaluate({ ...input, year: 2019 }, rule), { ok: true, outcome: "manual_review", reason: "year_below_minimum", ruleVersion: "catalog-v1" });
});

test("battery-electric variant is excluded even when the same model has a matching hybrid rule", () => {
  assert.deepEqual(evaluate({ ...input, powertrain: "battery_electric" }, rule), { ok: true, outcome: "excluded", reason: "battery_electric" });
  assert.equal(evaluate(input, rule).outcome, "candidate");
});

test("unknown fuel or year cannot be treated as an approved class", () => {
  for (const patch of [{ powertrain: null }, { powertrain: "electric" }, { year: "2020" }, { year: NaN }, { year: 0 }]) {
    assert.deepEqual(evaluate({ ...input, ...patch }, rule), { ok: false, error: "invalid_input" });
  }
});

test("unverified vehicle powertrain never yields a class candidate", () => {
  for (const powertrainVerified of [false, null, undefined, "true"]) {
    assert.deepEqual(evaluate({ ...input, powertrainVerified }, rule),
      { ok: true, outcome: "manual_review", reason: "powertrain_unverified" });
  }
});

test("wrong model, wrong brand, missing version or unapproved class fail closed", () => {
  for (const patch of [{ make: "Other" }, { model: "Other" }, { version: "" }, { vehicleClass: "economy" }, { minYear: "2020" }]) {
    assert.deepEqual(evaluate(input, { ...rule, ...patch }), { ok: false, error: "invalid_rule" });
  }
});

test("the selected rule version controls the result without changing an earlier snapshot", () => {
  const old = evaluate(input, rule);
  const changed = evaluate(input, { ...rule, minYear: 2022, version: "catalog-v2" });
  assert.equal(old.outcome, "candidate");
  assert.equal(old.ruleVersion, "catalog-v1");
  assert.equal(changed.outcome, "manual_review");
  assert.equal(changed.ruleVersion, "catalog-v2");
});
