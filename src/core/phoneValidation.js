/**
 * Basic phone format validation. Does not confirm an active subscriber.
 * Keep behavior aligned with Android PassengerValidator.isValidPhone().
 */
export function isValidPhone(value) {
  if (typeof value !== "string") return false;
  const source = value.trim();
  if (!source || source.length > 40 || !/^\+?[0-9 ()\-.]+$/.test(source)) {
    return false;
  }
  let digits = "";
  let opened = false;
  let inside = 0;
  for (const char of source) {
    if (char >= "0" && char <= "9") {
      digits += char;
      if (opened) inside++;
    } else if (char === "(") {
      if (opened) return false;
      opened = true;
      inside = 0;
    } else if (char === ")") {
      if (!opened || inside === 0) return false;
      opened = false;
    }
  }
  // New bookings require a Russian +7 or 8 number, with exactly 11 digits.
  // A local ten-digit number and a bare 7 prefix are intentionally rejected.
  if (opened || digits.length !== 11) return false;
  if (!source.startsWith("+7") && !source.startsWith("8")) return false;
  if (digits[1] < "2") return false;
  const national = digits.slice(1);
  if (["0123456789", "1234567890", "9876543210"].includes(national)) {
    return false;
  }
  if (/^(\d)\1+$/.test(national)) return false;
  return true;
}
