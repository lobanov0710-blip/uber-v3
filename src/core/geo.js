const MAPBOX_GEOCODING_URL =
  "https://api.mapbox.com/search/geocode/v6/forward";

const MAPBOX_DIRECTIONS_URL =
  "https://api.mapbox.com/directions/v5/mapbox/driving";

const GEOCODE_TIMEOUT_MS =
  10_000;

const ROUTING_TIMEOUT_MS =
  15_000;

const ROUTING_SNAP_RADIUS_METERS =
  5_000;

const DEFAULT_PROXIMITY = {
  lon: 44.005257,
  lat: 56.32411
};


// =========================
// QUALITY STOP WORDS
// =========================

const QUALITY_STOP_WORDS =
  new Set([
    "г",
    "город",

    "ул",
    "улица",

    "пр",
    "просп",
    "проспект",

    "пер",
    "переулок",

    "ш",
    "шоссе",

    "д",
    "дом",

    "обл",
    "область",

    "рн",
    "район",

    "пос",
    "поселок",
    "посёлок",

    "дер",
    "деревня",

    "с",
    "село",

    "респ",
    "республика",

    "край",

    "рф",
    "россия",

    "из",
    "в",
    "во",
    "до",
    "от",
    "на"
  ]);


// =========================
// TEXT
// =========================

function cleanText(
  value
) {
  return String(
    value || ""
  )
    .normalize(
      "NFKC"
    )
    .replace(
      /[^\p{L}\p{N}\s,.\-\/№'’]/gu,
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
// COORDINATES
// =========================

function isValidCoordinates(
  lon,
  lat
) {
  return (
    Number.isFinite(lon) &&
    Number.isFinite(lat) &&
    lon >= -180 &&
    lon <= 180 &&
    lat >= -90 &&
    lat <= 90
  );
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
    ).trim();

  if (!token) {
    throw new Error(
      "MAPBOX_ACCESS_TOKEN is not configured"
    );
  }

  return token;
}


// =========================
// PROXIMITY
// =========================

function normalizeProximity(
  point
) {
  const lon =
    Number(
      point?.lon
    );

  const lat =
    Number(
      point?.lat
    );

  if (
    !isValidCoordinates(
      lon,
      lat
    )
  ) {
    return null;
  }

  return {
    lon,
    lat
  };
}


// =========================
// COMPARABLE TEXT
// =========================

function normalizeComparableText(
  value
) {
  return String(
    value || ""
  )
    .normalize(
      "NFKC"
    )
    .toLowerCase()
    .replace(
      /ё/g,
      "е"
    )
    .replace(
      /[^\p{L}\p{N}]+/gu,
      " "
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}


// =========================
// MEANINGFUL TOKENS
// =========================

function meaningfulTokens(
  value
) {
  const normalized =
    normalizeComparableText(
      value
    );

  if (!normalized) {
    return [];
  }

  return normalized
    .split(" ")
    .filter(Boolean)
    .filter(
      token => {
        if (
          QUALITY_STOP_WORDS.has(
            token
          )
        ) {
          return false;
        }

        if (
          /^\d+$/.test(
            token
          )
        ) {
          return true;
        }

        return token.length >= 3;
      }
    );
}


// =========================
// LEVENSHTEIN
// =========================

function levenshteinDistance(
  a,
  b
) {
  if (
    a === b
  ) {
    return 0;
  }

  if (!a) {
    return b.length;
  }

  if (!b) {
    return a.length;
  }

  const previous =
    Array.from(
      {
        length:
          b.length + 1
      },
      (
        _,
        index
      ) => index
    );

  const current =
    new Array(
      b.length + 1
    );

  for (
    let i = 1;
    i <= a.length;
    i += 1
  ) {
    current[0] =
      i;

    for (
      let j = 1;
      j <= b.length;
      j += 1
    ) {
      const substitutionCost =
        a[i - 1] ===
        b[j - 1]
          ? 0
          : 1;

      current[j] =
        Math.min(
          current[j - 1] + 1,
          previous[j] + 1,
          previous[j - 1] +
            substitutionCost
        );
    }

    for (
      let j = 0;
      j <= b.length;
      j += 1
    ) {
      previous[j] =
        current[j];
    }
  }

  return previous[
    b.length
  ];
}


// =========================
// TOKEN MATCH
// =========================

function tokensMatch(
  queryToken,
  candidateToken
) {
  if (
    queryToken ===
    candidateToken
  ) {
    return true;
  }

  const queryIsNumber =
    /^\d+$/.test(
      queryToken
    );

  const candidateIsNumber =
    /^\d+$/.test(
      candidateToken
    );

  if (
    queryIsNumber ||
    candidateIsNumber
  ) {
    return false;
  }

  const maxLength =
    Math.max(
      queryToken.length,
      candidateToken.length
    );

  const minLength =
    Math.min(
      queryToken.length,
      candidateToken.length
    );

  if (
    minLength < 4 ||
    Math.abs(
      queryToken.length -
      candidateToken.length
    ) > 2
  ) {
    return false;
  }

  const allowedDistance =
    maxLength <= 7
      ? 1
      : maxLength <= 12
        ? 2
        : 3;

  return (
    levenshteinDistance(
      queryToken,
      candidateToken
    ) <=
    allowedDistance
  );
}


// =========================
// TEXT QUALITY GATE
// =========================

function passesTextQualityGate(
  query,
  feature
) {
  const properties =
    feature?.properties &&
    typeof feature.properties ===
      "object"
      ? feature.properties
      : {};

  const queryTokens =
    meaningfulTokens(
      query
    );

  const candidateText =
    [
      properties.name,
      properties.name_preferred,
      properties.full_address,
      properties.place_formatted
    ]
      .filter(Boolean)
      .join(" ");

  const candidateTokens =
    meaningfulTokens(
      candidateText
    );

  if (
    queryTokens.length === 0 ||
    candidateTokens.length === 0
  ) {
    return false;
  }

  const normalizedQuery =
    normalizeComparableText(
      query
    );

  const normalizedCandidate =
    normalizeComparableText(
      candidateText
    );

  const normalizedName =
    normalizeComparableText(
      properties.name ||
      ""
    );

  // Полное прямое совпадение.
  if (
    normalizedCandidate.includes(
      normalizedQuery
    ) ||
    (
      normalizedName &&
      normalizedQuery.includes(
        normalizedName
      )
    )
  ) {
    return true;
  }

  let matched =
    0;

  for (
    const queryToken of
    queryTokens
  ) {
    const found =
      candidateTokens.some(
        candidateToken =>
          tokensMatch(
            queryToken,
            candidateToken
          )
      );

    if (
      found
    ) {
      matched += 1;
    }
  }

  // Один значимый токен:
  // Москва / Самара / Казань.
  if (
    queryTokens.length === 1
  ) {
    return matched === 1;
  }

  // Два токена:
  // Нижний Новгород.
  // Требуем оба.
  if (
    queryTokens.length === 2
  ) {
    return matched === 2;
  }

  // Более сложный адрес:
  // минимум 60% значимых токенов
  // и минимум два совпадения.
  return (
    matched >= 2 &&
    (
      matched /
      queryTokens.length
    ) >= 0.6
  );
}

// =========================
// ADDRESS NUMBER PARTS
// =========================

function extractAddressNumberParts(
  value
) {
  const matches =
    String(
      value || ""
    )
      .normalize(
        "NFKC"
      )
      .match(
        /\d+/g
      );

  return Array.isArray(
    matches
  )
    ? matches
    : [];
}


// =========================
// ADDRESS NUMBER COMPATIBILITY
// =========================

function hasCompatibleAddressNumber(
  query,
  properties
) {
  const queryNumbers =
    extractAddressNumberParts(
      query
    );

  // В запросе вообще нет номера дома.
  // Тогда address_number не используем
  // как причину отказа.
  if (
    queryNumbers.length === 0
  ) {
    return true;
  }


  // Mapbox v6 для address feature
  // может вернуть нормализованный
  // номер в context.address.
  const explicitAddressNumber =
    properties
      ?.context
      ?.address
      ?.address_number ||
    "";


  let candidateNumbers =
    extractAddressNumberParts(
      explicitAddressNumber
    );


  // Fallback:
  // некоторые ответы не содержат
  // context.address.address_number.
  //
  // Тогда используем name,
  // например:
  // "Красная площадь 1с1".
  if (
    candidateNumbers.length === 0
  ) {
    candidateNumbers =
      extractAddressNumberParts(
        [
          properties?.name,
          properties?.name_preferred
        ]
          .filter(Boolean)
          .join(" ")
      );
  }


  if (
    candidateNumbers.length === 0
  ) {
    return false;
  }


  return candidateNumbers.some(
    candidateNumber =>
      queryNumbers.includes(
        candidateNumber
      )
  );
}

// =========================
// ADDRESS MATCH CODE
// =========================

function passesAddressMatchCode(
  query,
  feature
) {
  const properties =
    feature?.properties &&
    typeof feature.properties ===
      "object"
      ? feature.properties
      : {};

  if (
    properties.feature_type !==
    "address"
  ) {
    return true;
  }

  const matchCode =
    properties.match_code &&
    typeof properties.match_code ===
      "object"
      ? properties.match_code
      : null;


  // match_code может отсутствовать.
  if (
    !matchCode
  ) {
    return true;
  }


  // =========================
  // STREET
  // =========================
  //
  // Неверная улица для поездки
  // неприемлема.
  // =========================

  if (
    matchCode.street ===
    "unmatched"
  ) {
    return false;
  }


  // =========================
  // ADDRESS NUMBER
  // =========================
  //
  // Сам статус "unmatched"
  // недостаточен для отказа при
  // free-form q-запросе.
  //
  // Пример:
  //
  // query:
  // Красная площадь, 1
  //
  // Mapbox:
  // Красная площадь 1с1
  //
  // address_number:
  // unmatched
  //
  // Числовая основа при этом
  // совпадает: 1 → 1с1.
  // =========================

  if (
    matchCode.address_number ===
    "unmatched"
  ) {
    return hasCompatibleAddressNumber(
      query,
      properties
    );
  }


  return true;
}


// =========================
// FEATURE QUALITY
// =========================

function isAcceptableGeocodingFeature(
  query,
  feature
) {
  return (
    passesAddressMatchCode(
      query,
      feature
    ) &&
    passesTextQualityGate(
      query,
      feature
    )
  );
}


// =========================
// NORMALIZE GEOCODE FEATURE
// =========================

function normalizeGeocodingFeature(
  feature,
  fallbackName
) {
  if (
    !feature ||
    typeof feature !==
      "object"
  ) {
    return null;
  }

  const properties =
    feature.properties &&
    typeof feature.properties ===
      "object"
      ? feature.properties
      : {};

  const geometry =
    feature.geometry &&
    typeof feature.geometry ===
      "object"
      ? feature.geometry
      : null;

  let lon =
    Number(
      geometry?.coordinates?.[0]
    );

  let lat =
    Number(
      geometry?.coordinates?.[1]
    );


  // =========================
  // ROUTABLE POINT
  // =========================

  const routablePoints =
    Array.isArray(
      properties
        ?.coordinates
        ?.routable_points
    )
      ? properties.coordinates
          .routable_points
      : [];

  const routablePoint =
    routablePoints.find(
      point =>
        point?.name ===
        "default"
    ) ||
    routablePoints[0] ||
    null;

  if (
    routablePoint
  ) {
    const routableLon =
      Number(
        routablePoint.longitude
      );

    const routableLat =
      Number(
        routablePoint.latitude
      );

    if (
      isValidCoordinates(
        routableLon,
        routableLat
      )
    ) {
      lon =
        routableLon;

      lat =
        routableLat;
    }
  }

  if (
    !isValidCoordinates(
      lon,
      lat
    )
  ) {
    return null;
  }


  // =========================
  // DISPLAY NAME
  // =========================

  const name =
    cleanText(
      properties.name ||
      ""
    );

  const fullAddress =
    cleanText(
      properties.full_address ||
      ""
    );

  const placeFormatted =
    cleanText(
      properties.place_formatted ||
      ""
    );

  let displayName =
    fullAddress;

  if (
    !displayName &&
    name &&
    placeFormatted
  ) {
    displayName =
      `${name}, ${placeFormatted}`;
  }

  if (
    !displayName
  ) {
    displayName =
      name ||
      cleanText(
        fallbackName
      );
  }

  return {
    lat,
    lon,

    displayName,

    featureType:
      String(
        properties.feature_type ||
        ""
      ),

    mapboxId:
      String(
        properties.mapbox_id ||
        feature.id ||
        ""
      )
  };
}


// =========================
// GEOCODING
// =========================

async function geocode(
  query,
  token,
  proximity
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

  const url =
    new URL(
      MAPBOX_GEOCODING_URL
    );

  url.searchParams.set(
    "q",
    normalized
  );

  url.searchParams.set(
    "access_token",
    token
  );

  url.searchParams.set(
    "limit",
    "5"
  );

  url.searchParams.set(
    "language",
    "ru"
  );

  url.searchParams.set(
    "autocomplete",
    "false"
  );

  url.searchParams.set(
    "types",
    "address,street,place,locality,neighborhood"
  );

  const validProximity =
    normalizeProximity(
      proximity
    );

  if (
    validProximity
  ) {
    url.searchParams.set(
      "proximity",
      `${validProximity.lon},${validProximity.lat}`
    );
  }

  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () =>
        controller.abort(),
      GEOCODE_TIMEOUT_MS
    );

  try {
    // Не логируем пользовательский
    // адрес, URL, координаты и token.
    console.log(
      "GEOCODE REQUEST"
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

    if (
      !response.ok
    ) {
      console.error(
        "GEOCODE HTTP ERROR:",
        {
          status:
            response.status
        }
      );

      return null;
    }

    const data =
      await response
        .json()
        .catch(
          () => null
        );

    const features =
      Array.isArray(
        data?.features
      )
        ? data.features
        : [];

    if (
      features.length === 0
    ) {
      console.warn(
        "GEOCODE EMPTY"
      );

      return null;
    }

    for (
      let index = 0;
      index < features.length;
      index += 1
    ) {
      const feature =
        features[index];

      if (
        !isAcceptableGeocodingFeature(
          normalized,
          feature
        )
      ) {
        console.warn(
          "GEOCODE QUALITY REJECT:",
          {
            index,

            featureType:
              feature
                ?.properties
                ?.feature_type ||
              null
          }
        );

        continue;
      }

      const result =
        normalizeGeocodingFeature(
          feature,
          normalized
        );

      if (
        !result
      ) {
        continue;
      }

      console.log(
        "GEOCODE OK:",
        {
          provider:
            "mapbox",

          featureType:
            result.featureType ||
            null
        }
      );

      return result;
    }

    console.warn(
      "GEOCODE NO ACCEPTABLE FEATURE"
    );

    return null;

  } catch (
    error
  ) {
    console.error(
      "GEOCODE REQUEST ERROR:",
      {
        name:
          error?.name ||
          null,

        message:
          error?.name ===
          "AbortError"
            ? "timeout"
            : "request failed"
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
// DIRECTIONS RESPONSE
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

  const code =
    String(
      data.code ||
      ""
    );

  if (
    code !== "Ok"
  ) {
    console.error(
      "DIRECTIONS API ERROR:",
      {
        code:
          code ||
          "UNKNOWN"
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
      "DIRECTIONS EMPTY ROUTES"
    );

    return null;
  }

  const route =
    data.routes[0];

  const distanceMeters =
    Number(
      route?.distance
    );

  const durationSeconds =
    Number(
      route?.duration
    );

  if (
    !Number.isFinite(
      distanceMeters
    ) ||
    distanceMeters <= 0
  ) {
    console.error(
      "DIRECTIONS INVALID DISTANCE"
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
      "DIRECTIONS INVALID DURATION"
    );

    return null;
  }

  const geometry =
    route?.geometry;

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
      "DIRECTIONS INVALID GEOMETRY"
    );

    return null;
  }

  const hasInvalidCoordinate =
    geometry.coordinates.some(
      coordinate => {
        if (
          !Array.isArray(
            coordinate
          ) ||
          coordinate.length < 2
        ) {
          return true;
        }

        return !isValidCoordinates(
          Number(
            coordinate[0]
          ),
          Number(
            coordinate[1]
          )
        );
      }
    );

  if (
    hasInvalidCoordinate
  ) {
    console.error(
      "DIRECTIONS INVALID GEOMETRY COORDINATES"
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
// DIRECTIONS REQUEST
// =========================

async function requestMapboxRoute(
  fromPoint,
  toPoint,
  token
) {
  if (
    !isValidCoordinates(
      Number(
        fromPoint?.lon
      ),
      Number(
        fromPoint?.lat
      )
    ) ||
    !isValidCoordinates(
      Number(
        toPoint?.lon
      ),
      Number(
        toPoint?.lat
      )
    )
  ) {
    console.error(
      "DIRECTIONS INVALID INPUT COORDINATES"
    );

    return null;
  }

  const from =
    `${fromPoint.lon},${fromPoint.lat}`;

  const to =
    `${toPoint.lon},${toPoint.lat}`;

  const coordinates =
    `${from};${to}`;

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

  url.searchParams.set(
    "radiuses",
    `${ROUTING_SNAP_RADIUS_METERS};${ROUTING_SNAP_RADIUS_METERS}`
  );

  url.searchParams.set(
    "access_token",
    token
  );

  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () =>
        controller.abort(),
      ROUTING_TIMEOUT_MS
    );

  try {
    console.log(
      "DIRECTIONS REQUEST"
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

    if (
      !response.ok
    ) {
      console.error(
        "DIRECTIONS HTTP ERROR:",
        {
          status:
            response.status
        }
      );

      return null;
    }

    const data =
      await response
        .json()
        .catch(
          () => null
        );

    return normalizeMapboxRoute(
      data
    );

  } catch (
    error
  ) {
    console.error(
      "DIRECTIONS REQUEST ERROR:",
      {
        name:
          error?.name ||
          null,

        message:
          error?.name ===
          "AbortError"
            ? "timeout"
            : "request failed"
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
  token
) {
  const route =
    await requestMapboxRoute(
      fromPoint,
      toPoint,
      token
    );

  if (
    !route
  ) {
    console.error(
      "MAPBOX ROUTING FAILED"
    );

    return null;
  }

  console.log(
    "ROUTING OK:",
    {
      provider:
        route.provider
    }
  );

  return route;
}


// =========================
// MAIN
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
      error?.message ||
      "configuration error"
    );

    return {
      ok:
        false,

      error:
        "Сервис маршрутизации временно недоступен"
    };
  }


  // =========================
  // FROM
  // =========================

  const fromPoint =
    await geocode(
      from,
      token,
      DEFAULT_PROXIMITY
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
  // TO
  // =========================

  const toPoint =
    await geocode(
      to,
      token,
      fromPoint
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
  // ROUTE
  // =========================

  const route =
    await buildRoute(
      fromPoint,
      toPoint,
      token
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

  const distanceKm =
    route.distanceMeters /
    1000;

  const durationMinutes =
    Math.round(
      route.durationSeconds /
      60
    );

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
      "INVALID NORMALIZED ROUTE"
    );

    return {
      ok:
        false,

      error:
        "Некорректные данные маршрута"
    };
  }


  // =========================
  // PUBLIC CONTRACT
  // =========================

  return {
    ok:
      true,

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

    route: {
      type:
        "LineString",

      coordinates:
        route.geometry
          .coordinates
    }
  };
}