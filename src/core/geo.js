// =========================
// GEO + ROUTING
// =========================
//
// Geocoding:
// Nominatim / OpenStreetMap
//
// Routing:
// Mapbox Directions API
//
// Output:
// - from / to
// - distance, km
// - duration, minutes
// - GeoJSON LineString
//
// =========================


// =========================
// CONFIG
// =========================

const USER_AGENT =
  "TransferService52/1.0 (https://transfer-servis52.ru)";

const NOMINATIM_URL =
  "https://nominatim.openstreetmap.org/search";

const MAPBOX_DIRECTIONS_URL =
  "https://api.mapbox.com/directions/v5/mapbox/driving";

const GEOCODE_TIMEOUT_MS =
  10000;

const ROUTING_TIMEOUT_MS =
  15000;


// =========================
// CACHE
// =========================

const geoCache =
  new Map();


// =========================
// TEXT
// =========================

function cleanText(
  value
) {

  return String(
    value || ""
  )
    .replace(
      /[^\p{L}\p{N}\s,.\-]/gu,
      " "
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}


// =========================
// QUERY VALIDATION
// =========================

function isValidQuery(
  value
) {

  if (!value) {
    return false;
  }

  if (
    value.length < 3 ||
    value.length > 200
  ) {
    return false;
  }

  if (
    /^[0-9\s]+$/.test(
      value
    )
  ) {
    return false;
  }

  return true;
}


// =========================
// MAPBOX TOKEN
// =========================

function getMapboxToken(
  env
) {

  const token =
    String(
      env?.MAPBOX_ACCESS_TOKEN ||
      ""
    )
      .trim();

  if (!token) {

    throw new Error(
      "MAPBOX_ACCESS_TOKEN is not configured"
    );
  }

  return token;
}


// =========================
// GEOCODING
// =========================

async function geocode(
  query
) {

  const normalized =
    cleanText(
      query
    );

  if (
    !isValidQuery(
      normalized
    )
  ) {
    return null;
  }


  // =========================
  // CACHE
  // =========================

  const cacheKey =
    normalized
      .toLowerCase();

  if (
    geoCache.has(
      cacheKey
    )
  ) {

    console.log(
      "GEOCODE CACHE HIT:",
      normalized
    );

    return geoCache.get(
      cacheKey
    );
  }


  // =========================
  // URL
  // =========================

  const url =
    NOMINATIM_URL +
    "?format=jsonv2" +
    "&limit=1" +
    "&addressdetails=1" +
    "&accept-language=ru" +
    `&q=${encodeURIComponent(normalized)}`;


  // =========================
  // TIMEOUT
  // =========================

  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () => {

        controller.abort();

      },
      GEOCODE_TIMEOUT_MS
    );


  try {

    console.log(
      "GEOCODE TRY:",
      normalized
    );

    const response =
      await fetch(
        url,
        {
          method:
            "GET",

          headers: {

            Accept:
              "application/json",

            "User-Agent":
              USER_AGENT
          },

          signal:
            controller.signal
        }
      );


    if (
      !response.ok
    ) {

      console.error(
        "NOMINATIM HTTP ERROR:",
        response.status
      );

      return null;
    }


    const data =
      await response
        .json()
        .catch(
          () => null
        );


    if (
      !Array.isArray(
        data
      ) ||
      data.length === 0
    ) {

      console.warn(
        "NOMINATIM EMPTY:",
        normalized
      );

      return null;
    }


    const item =
      data[0];


    // =========================
    // COORDINATES
    // =========================

    const lat =
      Number(
        item.lat
      );

    const lon =
      Number(
        item.lon
      );


    if (
      !Number.isFinite(
        lat
      ) ||
      !Number.isFinite(
        lon
      )
    ) {

      console.error(
        "NOMINATIM INVALID COORDS:",
        normalized
      );

      return null;
    }


    // =========================
    // RESULT
    // =========================

    const result = {

      lat,

      lon,

      displayName:
        String(
          item.display_name ||
          normalized
        )
    };


    console.log(
      "GEOCODE OK:",
      {
        query:
          normalized,

        lat,

        lon
      }
    );


    geoCache.set(
      cacheKey,
      result
    );


    return result;

  } catch (
    error
  ) {

    console.error(
      "GEOCODE ERROR:",
      normalized,
      {
        name:
          error?.name,

        message:
          error?.message
      }
    );

    return null;

  } finally {

    clearTimeout(
      timeout
    );
  }
}


// =========================
// MAPBOX RESPONSE
// =========================

function normalizeMapboxRoute(
  data
) {

  if (
    !data ||
    typeof data !==
      "object"
  ) {

    return null;
  }


  console.log(
    "MAPBOX RESPONSE:",
    {
      code:
        data.code || null,

      routes:
        Array.isArray(
          data.routes
        )
          ? data.routes.length
          : 0
    }
  );


  if (
    data.code !== "Ok"
  ) {

    console.error(
      "MAPBOX API ERROR:",
      {
        code:
          data.code || null,

        message:
          data.message || null
      }
    );

    return null;
  }


  if (
    !Array.isArray(
      data.routes
    ) ||
    data.routes.length === 0
  ) {

    console.error(
      "MAPBOX EMPTY ROUTES"
    );

    return null;
  }


  const route =
    data.routes[0];


  // =========================
  // DISTANCE / DURATION
  // =========================

  const distanceMeters =
    Number(
      route.distance
    );

  const durationSeconds =
    Number(
      route.duration
    );


  if (
    !Number.isFinite(
      distanceMeters
    ) ||
    distanceMeters <= 0
  ) {

    console.error(
      "MAPBOX INVALID DISTANCE:",
      route.distance
    );

    return null;
  }


  if (
    !Number.isFinite(
      durationSeconds
    ) ||
    durationSeconds <= 0
  ) {

    console.error(
      "MAPBOX INVALID DURATION:",
      route.duration
    );

    return null;
  }


  // =========================
  // GEOMETRY
  // =========================

  const geometry =
    route.geometry;


  if (
    !geometry ||
    geometry.type !==
      "LineString" ||
    !Array.isArray(
      geometry.coordinates
    ) ||
    geometry.coordinates.length <
      2
  ) {

    console.error(
      "MAPBOX INVALID GEOMETRY"
    );

    return null;
  }


  return {

    provider:
      "mapbox",

    distanceMeters,

    durationSeconds,

    geometry: {

      type:
        "LineString",

      coordinates:
        geometry.coordinates
    }
  };
}


// =========================
// MAPBOX REQUEST
// =========================

async function requestMapboxRoute(
  fromPoint,
  toPoint,
  token
) {

  // Mapbox использует:
  //
  // longitude,latitude
  //
  // НЕ latitude,longitude.

  const from =
    `${fromPoint.lon},${fromPoint.lat}`;

  const to =
    `${toPoint.lon},${toPoint.lat}`;


  const coordinates =
    `${from};${to}`;


  // =========================
  // URL
  // =========================

  const url =
    new URL(
      `${MAPBOX_DIRECTIONS_URL}/${coordinates}`
    );


  url.searchParams.set(
    "alternatives",
    "false"
  );

  url.searchParams.set(
    "geometries",
    "geojson"
  );

  url.searchParams.set(
    "overview",
    "full"
  );

  url.searchParams.set(
    "steps",
    "false"
  );

  // Позволяем Mapbox найти
  // ближайшую пригодную дорогу,
  // даже если Nominatim вернул
  // центр населённого пункта.
  url.searchParams.set(
    "radiuses",
    "unlimited;unlimited"
  );

  url.searchParams.set(
    "access_token",
    token
  );


  // =========================
  // IMPORTANT
  // =========================
  //
  // URL не выводим в console.log,
  // потому что он содержит secret token.
  //
  // =========================


  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () => {

        controller.abort();

      },
      ROUTING_TIMEOUT_MS
    );


  try {

    console.log(
      "ROUTING TRY:",
      "MAPBOX"
    );

    console.log(
      "ROUTING COORDS:",
      {
        from,
        to
      }
    );


    const response =
      await fetch(
        url.toString(),
        {
          method:
            "GET",

          headers: {
            Accept:
              "application/json"
          },

          signal:
            controller.signal
        }
      );


    // =========================
    // HTTP ERROR
    // =========================

    if (
      !response.ok
    ) {

      const errorBody =
        await response
          .text()
          .catch(
            () => ""
          );


      console.error(
        "MAPBOX HTTP ERROR:",
        {
          status:
            response.status,

          statusText:
            response.statusText,

          body:
            errorBody.slice(
              0,
              500
            )
        }
      );


      return null;
    }


    // =========================
    // JSON
    // =========================

    const data =
      await response
        .json()
        .catch(
          error => {

            console.error(
              "MAPBOX JSON ERROR:",
              error
            );

            return null;
          }
        );


    return normalizeMapboxRoute(
      data
    );

  } catch (
    error
  ) {

    console.error(
      "MAPBOX REQUEST ERROR:",
      {
        name:
          error?.name,

        message:
          error?.message
      }
    );


    return null;

  } finally {

    clearTimeout(
      timeout
    );
  }
}


// =========================
// BUILD ROUTE
// =========================

async function buildRoute(
  fromPoint,
  toPoint,
  env
) {

  let token;


  try {

    token =
      getMapboxToken(
        env
      );

  } catch (
    error
  ) {

    console.error(
      "MAPBOX CONFIG ERROR:",
      error?.message
    );

    return null;
  }


  const route =
    await requestMapboxRoute(
      fromPoint,
      toPoint,
      token
    );


  if (
    route
  ) {

    console.log(
      "ROUTING PROVIDER:",
      "MAPBOX"
    );

    return route;
  }


  console.error(
    "MAPBOX ROUTING FAILED"
  );


  return null;
}


// =========================
// MAIN GEO CALCULATION
// =========================

export async function geoCalculate(
  body,
  env
) {

  const from =
    cleanText(
      body?.from
    );

  const to =
    cleanText(
      body?.to
    );


  // =========================
  // VALIDATE INPUT
  // =========================

  if (
    !isValidQuery(
      from
    ) ||
    !isValidQuery(
      to
    )
  ) {

    return {

      ok:
        false,

      error:
        "invalid address"
    };
  }


  // =========================
  // GEOCODE FROM
  // =========================

  const fromPoint =
    await geocode(
      from
    );


  if (
    !fromPoint
  ) {

    return {

      ok:
        false,

      error:
        "Не удалось определить адрес отправления"
    };
  }


  // =========================
  // GEOCODE TO
  // =========================

  const toPoint =
    await geocode(
      to
    );


  if (
    !toPoint
  ) {

    return {

      ok:
        false,

      error:
        "Не удалось определить адрес назначения"
    };
  }


  // =========================
  // DIAGNOSTICS
  // =========================

  console.log(
    "GEOCODE RESULT:",
    {

      from,

      to,

      fromPoint: {

        lat:
          fromPoint.lat,

        lon:
          fromPoint.lon
      },

      toPoint: {

        lat:
          toPoint.lat,

        lon:
          toPoint.lon
      }
    }
  );


  // =========================
  // ROAD ROUTE
  // =========================

  const route =
    await buildRoute(
      fromPoint,
      toPoint,
      env
    );


  if (
    !route
  ) {

    return {

      ok:
        false,

      error:
        "Не удалось построить автомобильный маршрут"
    };
  }


  // =========================
  // UNITS
  // =========================

  const distanceKm =
    route.distanceMeters /
    1000;


  const durationMinutes =
    Math.round(
      route.durationSeconds /
      60
    );


  // =========================
  // VALIDATE ROUTE
  // =========================

  if (
    !Number.isFinite(
      distanceKm
    ) ||
    distanceKm <= 0 ||
    !Number.isFinite(
      durationMinutes
    ) ||
    durationMinutes <= 0
  ) {

    console.error(
      "INVALID NORMALIZED ROUTE:",
      {
        distanceKm,
        durationMinutes
      }
    );


    return {

      ok:
        false,

      error:
        "Некорректные данные маршрута"
    };
  }


  // =========================
  // RESULT
  // =========================

  return {

    ok:
      true,


    // =========================
    // FROM
    // =========================

    from: {

      query:
        from,

      lat:
        fromPoint.lat,

      lon:
        fromPoint.lon,

      displayName:
        fromPoint.displayName
    },


    // =========================
    // TO
    // =========================

    to: {

      query:
        to,

      lat:
        toPoint.lat,

      lon:
        toPoint.lon,

      displayName:
        toPoint.displayName
    },


    // =========================
    // ROUTE INFO
    // =========================

    distance:
      Number(
        distanceKm.toFixed(
          1
        )
      ),


    duration:
      durationMinutes,


    routingProvider:
      route.provider,


    // =========================
    // MAP
    // =========================

    route: {

      type:
        "LineString",

      coordinates:
        route.geometry
          .coordinates
    }
  };
}