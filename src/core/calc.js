export function calc(expr) {
  if (!expr) return null;

  const clean = String(expr).replace(/[^0-9+\-*/().]/g, "");

  if (!clean) return null;

  try {
    // безопасный eval через Function (ограниченный вход)
    return Function(`"use strict"; return (${clean})`)();
  } catch {
    return null;
  }
}