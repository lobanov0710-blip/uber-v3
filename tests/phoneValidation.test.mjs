import assert from "node:assert/strict";
import { isValidPhone } from "../src/core/phoneValidation.js";

for (const value of [
  "+7 (999) 123-45-67", "+79991234567",
  "8 (999) 123-45-67", "89991234567",
  "+7 831 412-34-56"
]) {
  assert.equal(isValidPhone(value), true, "should allow: " + value);
}
for (const value of [
  null, 79991234567, "", "123", "9991234567", "9123456789",
  "79991234567", "123456789012345",
  "+44 (20) 7123-4567", "+1 (415) 555-2671",
  "tel. +7 (999) 123-45-67",
  "тел. +7 (999) 123-45-67", "++79991234567", "8999+1234567",
  "+7 999 123 45", "8 999 123 45", "+7 012 123-45-67",
  "+7 ((999)) 123-45-67", "+7 (999 123-45-67",
  "+7 () 999 123-45-67", "+70000000000", "80000000000",
  "81111111111", "+7;9991234567", "+7\n9991234567"
]) {
  assert.equal(isValidPhone(value), false, "should reject: " + value);
}
console.log("Russian prefix phone-format validation: OK");
