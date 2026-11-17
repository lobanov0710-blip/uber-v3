// Pure decision logic. A class is a candidate, never an approval or line admission.
// Callers must resolve an authoritative, immutable rule version on the server.
const CLASSES = new Set(["comfort", "business", "minivan"]);
const POWERTRAINS = new Set(["combustion", "hybrid", "battery_electric"]);

function text(value, max) {
  return typeof value === "string" && value.length > 0 && value.length <= max &&
    value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}

function year(value) {
  return Number.isSafeInteger(value) && value >= 1 && value <= 9999;
}

/**
 * Evaluate only the supplied server-side rule version. A null rule denotes no
 * corresponding model. Matching deliberately does not guess aliases or models.
 * The caller must derive powertrainVerified from trusted server-side moderation,
 * never from a driver-supplied flag. Notes and documents still require review.
 */
export function evaluateVehicleClassification(input, rule) {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      !text(input.make, 80) || !text(input.model, 80) || !year(input.year) ||
      !POWERTRAINS.has(input.powertrain)) {
    return { ok: false, error: "invalid_input" };
  }

  if (input.powertrain === "battery_electric") {
    return { ok: true, outcome: "excluded", reason: "battery_electric" };
  }
  if (input.powertrainVerified !== true) {
    return { ok: true, outcome: "manual_review", reason: "powertrain_unverified" };
  }
  if (rule === null) {
    return { ok: true, outcome: "manual_review", reason: "model_not_found" };
  }
  if (!rule || typeof rule !== "object" || Array.isArray(rule) ||
      !text(rule.make, 80) || !text(rule.model, 80) || !year(rule.minYear) ||
      !CLASSES.has(rule.vehicleClass) || !text(rule.version, 128) ||
      rule.make !== input.make || rule.model !== input.model) {
    return { ok: false, error: "invalid_rule" };
  }
  if (input.year < rule.minYear) {
    return { ok: true, outcome: "manual_review", reason: "year_below_minimum", ruleVersion: rule.version };
  }
  return { ok: true, outcome: "candidate", vehicleClass: rule.vehicleClass, ruleVersion: rule.version };
}
