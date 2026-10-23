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
  if (opened || digits.length < 10 || digits.length > 15) return false;
  if (source.startsWith("+") && digits.startsWith("0")) return false;
  if (source.startsWith("+7") && digits.length !== 11) return false;

  const russianStyle = digits[0] === "7" || digits[0] === "8";
  if (russianStyle && digits.length === 11 && digits[1] < "2") return false;
  const national = russianStyle && digits.length === 11 ? digits.slice(1) : digits;
  if (["0123456789", "1234567890", "9876543210"].includes(national)) {
    return false;
  }
  if (/^(\d)\1+$/.test(national)) return false;
  return true;
}
