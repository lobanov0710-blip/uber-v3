import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const rule = JSON.parse(readFileSync(
  new URL("../config/passenger-push-waf-proposal.json", import.meta.url), "utf8"
));
assert.equal(rule.status, "PROPOSAL_ONLY_DO_NOT_APPLY");
assert.equal(rule.applyAutomatically, false);
assert.equal(rule.verifiedPlanFeatures, false);
assert.equal(rule.hostname, "transfer-servis52.ru");
const expected = {
  "/api/passenger-push-grant.php": ["POST"],
  "/api/passenger-push-device.php": ["POST", "DELETE"]
};
assert.deepEqual(rule.exactMethodsByPath, expected);
assert.deepEqual(rule.countingCharacteristics, ["IP"]);
assert.ok(Number.isInteger(rule.proposedThreshold.requests));
assert.ok(rule.proposedThreshold.requests > 0);
assert.ok(rule.proposedThreshold.periodSeconds >= 10);
const exact = '(http.host eq "transfer-servis52.ru" and ' +
  '((http.request.uri.path eq "/api/passenger-push-grant.php" and ' +
  'http.request.method eq "POST") or ' +
  '(http.request.uri.path eq "/api/passenger-push-device.php" and ' +
  'http.request.method in {"POST" "DELETE"})))';
assert.equal(rule.matchExpression, exact);
for (const forbidden of [
  "/api/order.php", "/api/order-status.php", "/api/calculate.php",
  "/staff/", "starts_with(", "contains", "http.request.uri.path in {\"/api/\""
]) {
  assert.equal(rule.matchExpression.includes(forbidden), false);
}
assert.equal(Object.keys(rule.exactMethodsByPath).length, 2);
console.log("PASSENGER_PUSH_WAF_SCOPE_PROPOSAL_ONLY=PASS");
