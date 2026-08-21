import { fetchJSON } from "./http.js";

const USER_AGENT = "UberV3-TransferService/2.0 (contact: admin@site.ru)";

// =========================
// MEMORY CACHE (PRO)
// =========================
const geoCache = new Map();

// =========================
// CLEAN TEXT (PRO)
// =========================
function cleanText(s) {
  return String(s || "")
    .replace(/[^\p{L}\p{N}\s,.-]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

// =========================
// VALIDATION (ANTI SPAM)
// =========================
function isValidQuery(q) {
  if (!q) return false;
  if (q.length < 3) return false;

  // если только цифры/мусор
  if (/^[0-9\s]+$/.test(q)) return false;

  return true;
}

// =========================
// GEOCODE (PRO RETRY + CACHE)
// =========================
async function geo(q) {

  const key = q.toLowerCase();

  if (geoCache.has(key)) {
    return geoCache.get(key);
  }

  const url =
    `https://nominatim.openstreetmap.org/search?` +
    `format=json&limit=1&q=${encodeURIComponent(q)}`;

  for (let i = 0; i < 3; i++) {
    try {

      const res = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          "Accept": "application/json"
        }
      });

      const data = await res.json().catch(() => []);

      if (Array.isArray(data) && data.length > 0) {

        const lat = Number(data[0].lat);
        const lon = Number(data[0].lon);

        if (Number.isFinite(lat) && Number.isFinite(lon)) {

          const result = { lat, lon };
          geoCache.set(key, result);

          return result;
        }
      }

    } catch (e) {
      console.warn("GEOCODE RETRY", i + 1, q);
    }
  }

  return null;
}

// =========================
// MAIN FUNCTION
// =========================
export async function geoCalculate(body) {

  let from = cleanText(body?.from);
  let to = cleanText(body?.to);

  if (!isValidQuery(from) || !isValidQuery(to)) {
    return { ok: false, error: "invalid input" };
  }

  try {

    const a = await geo(from);
    const b = await geo(to);

    console.log("GEOCODE:", { from, to, a, b });

    // =========================
    // FALLBACK GEO
    // =========================
    if (!a || !b) {
      return {
        ok: true,
        distance: 10,
        duration: 20,
        price: 500,
        route: {
          coordinates: [
            [37.6173, 55.7558],
            [37.6273, 55.7658]
          ]
        }
      };
    }

    // =========================
    // OSRM ROUTE
    // =========================
    const url =
      `https://router.project-osrm.org/route/v1/driving/` +
      `${a.lon},${a.lat};${b.lon},${b.lat}` +
      `?overview=full&geometries=geojson`;

    let data = null;

    try {
      data = await fetchJSON(url);
    } catch (e) {
      console.warn("OSRM FAIL");
    }

    const route = data?.routes?.[0];

    // =========================
    // ROUTE FALLBACK
    // =========================
    if (!route?.geometry?.coordinates?.length) {

      return {
        ok: true,
        distance: 50,
        duration: 60,
        price: 2500,
        route: {
          coordinates: [
            [a.lon, a.lat],
            [b.lon, b.lat]
          ]
        }
      };
    }

    // =========================
    // NORMAL RESULT
    // =========================
    const distanceKm = route.distance / 1000;
    const durationMin = Math.round(route.duration / 60);

    return {
      ok: true,
      distance: Number(distanceKm.toFixed(1)),
      duration: durationMin,
      price: Math.max(3000, Math.round(distanceKm * 55)),
      route: {
        coordinates: route.geometry.coordinates
      }
    };

  } catch (e) {

    console.error("geoCalculate ERROR:", e);

    return {
      ok: true,
      distance: 0,
      duration: 0,
      price: 0,
      route: {
        coordinates: [
          [37.6173, 55.7558],
          [37.6273, 55.7658]
        ]
      }
    };
  }
}