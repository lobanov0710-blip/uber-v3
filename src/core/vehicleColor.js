// Free text, not a guessed palette. Legacy reads may still contain null.
export function normalizeVehicleColor(value) {
  if (typeof value !== 'string') return null;
  const color = value.trim();
  return color.length >= 1 && color.length <= 80 && !/[\u0000-\u001f\u007f]/.test(color)
    ? color : null;
}
