import { fetchJSON } from "./http.js";

const USER_AGENT =
  "TransferService52/1.0 (https://transfer-servis52.ru)";

const geoCache = new Map();

// =========================
// NORMALIZE QUERY
// =========================
function cleanText(value) {
  return String(value || "")
    .replace(/[^\p{L}\p{N}\s,.\-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// =========================
// VALIDATE QUERY
// =========================
function isValidQuery(value) {
  if (!value) return false;
  if (value.length < 3) return false;
  if (value.length > 200) return false;

  if (/^[0-9\s]+$/.test(value)) {
    return false;
  }

  return true;
}

// =========================
// GEOCODING
// =========================
async function geocode(query) {
  const normalized = cleanText(query);

  if (!isValidQuery(normalized)) {
    return null;
  }

  const cacheKey =
    normalized.toLowerCase();

  if (geoCache.has(cacheKey)) {
    return geoCache.get(cacheKey);
  }

  const url =
    "https://nominatim.openstreetmap.org/search" +
    "?format=jsonv2" +
    "&limit=1" +
    "&accept-language=ru" +
    `&q=${encodeURIComponent(normalized)}`;

  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () => controller.abort(),
      8000
    );

  try {
    const response =
      await fetch(
        url,
        {
          method: "GET",

          headers: {
            "Accept": "application/json",
            "User-Agent": USER_AGENT
          },

          signal: controller.signal
        }
      );

    if (!response.ok) {
      console.error(
        "NOMINATIM HTTP ERROR:",
        response.status
      );

      return null;
    }

    const data =
      await response
        .json()
        .catch(() => null);

    if (
      !Array.isArray(data) ||
      data.length === 0
    ) {
      return null;
    }

    const item = data[0];

    const lat =
      Number(item.lat);

    const lon =
      Number(item.lon);

    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lon)
    ) {
      return null;
    }

    const result = {
      lat,
      lon,

      displayName:
        String(
          item.display_name ||
          normalized
        )
    };

    geoCache.set(
      cacheKey,
      result
    );

    return result;

  } catch (error) {
    console.error(
      "GEOCODE ERROR:",
      normalized,
      error
    );

    return null;

  } finally {
    clearTimeout(timeout);
  }
}

// =========================
// VALHALLA ROAD ROUTE
// =========================
async function buildRoute(
  fromPoint,
  toPoint
) {
  const url =
    "https://valhalla1.openstreetmap.de/route";

  const requestBody = {
    locations: [
      {
        lat: fromPoint.lat,
        lon: fromPoint.lon,
        type: "break"
      },
      {
        lat: toPoint.lat,
        lon: toPoint.lon,
        type: "break"
      }
    ],

    costing: "auto",

    format: "osrm",

    shape_format: "geojson",

    directions_type: "none",

    units: "kilometers"
  };

  let data;

  try {
    data =
      await fetchJSON(
        url,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",

            "Accept":
              "application/json",

            "X-Client-Id":
              "transfer-servis52.ru"
          },

          body:
            JSON.stringify(
              requestBody
            )
        },
        1
      );

  } catch (error) {
    console.error(
      "VALHALLA REQUEST ERROR:",
      error
    );

    return null;
  }

  console.log(
    "VALHALLA RESPONSE:",
    {
      code: data?.code,
      routes:
        Array.isArray(data?.routes)
          ? data.routes.length
          : 0
    }
  );

  if (
    !data ||
    !Array.isArray(data.routes) ||
    data.routes.length === 0
  ) {
    console.error(
      "VALHALLA INVALID RESPONSE:",
      data
    );

    return null;
  }

  const route =
    data.routes[0];

  const distance =
    Number(route.distance);

  const duration =
    Number(route.duration);

  const geometry =
    route.geometry;

  if (
    !Number.isFinite(distance) ||
    distance <= 0 ||
    !Number.isFinite(duration) ||
    duration <= 0 ||
    !geometry ||
    geometry.type !== "LineString" ||
    !Array.isArray(
      geometry.coordinates
    ) ||
    geometry.coordinates.length < 2
  ) {
    console.error(
      "VALHALLA INVALID ROUTE:",
      route
    );

    return null;
  }

  return {
    distance,
    duration,
    geometry
  };
}

// =========================
// MAIN GEO CALCULATION
// =========================
export async function geoCalculate(body) {
  const from =
    cleanText(body?.from);

  const to =
    cleanText(body?.to);

  if (
    !isValidQuery(from) ||
    !isValidQuery(to)
  ) {
    return {
      ok: false,
      error: "invalid address"
    };
  }

  // =========================
  // GEOCODE START
  // =========================
  const fromPoint =
    await geocode(from);

  if (!fromPoint) {
    return {
      ok: false,
      error:
        "Не удалось определить адрес отправления"
    };
  }

  // =========================
  // GEOCODE DESTINATION
  // =========================
  const toPoint =
    await geocode(to);

  if (!toPoint) {
    return {
      ok: false,
      error:
        "Не удалось определить адрес назначения"
    };
  }

  console.log(
    "GEOCODE RESULT:",
    {
      from,
      to,
      fromPoint,
      toPoint
    }
  );

  // =========================
  // REAL ROAD ROUTE
  // =========================
  const route =
    await buildRoute(
      fromPoint,
      toPoint
    );

  if (!route) {
    return {
      ok: false,
      error:
        "Не удалось построить автомобильный маршрут"
    };
  }

  const distanceKm =
    route.distance / 1000;

  const durationMinutes =
    Math.round(
      route.duration / 60
    );

  if (
    !Number.isFinite(distanceKm) ||
    distanceKm <= 0 ||
    !Number.isFinite(durationMinutes) ||
    durationMinutes <= 0
  ) {
    return {
      ok: false,
      error:
        "Некорректные данные маршрута"
    };
  }

  // =========================
  // GEO RESULT ONLY
  // =========================
  return {
    ok: true,

    from: {
      query: from,
      lat: fromPoint.lat,
      lon: fromPoint.lon,
      displayName:
        fromPoint.displayName
    },

    to: {
      query: to,
      lat: toPoint.lat,
      lon: toPoint.lon,
      displayName:
        toPoint.displayName
    },

    distance:
      Number(
        distanceKm.toFixed(1)
      ),

    duration:
      durationMinutes,

    route: {
      type: "LineString",

      coordinates:
        route.geometry.coordinates
    }
  };
}