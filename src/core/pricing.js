// =========================
// TARIFF CONFIG
// =========================

const TARIFFS = {
  comfort: {
    code: "comfort",
    name: "Comfort",
    pricePerKm: 55,
    minimumPrice: 4000
  },

  business: {
    code: "business",
    name: "Business",
    pricePerKm: 75,
    minimumPrice: 6000
  },

  minivan: {
    code: "minivan",
    name: "Minivan",
    pricePerKm: 80,
    minimumPrice: 5000
  }
};

// =========================
// DISTANCE COEFFICIENT
//
// Храним коэффициент как целое число:
// 1.60 = 160
// 1.30 = 130
// 1.15 = 115
// 1.00 = 100
//
// Это защищает расчёт цены
// от floating-point ошибок.
// =========================

function getDistanceCoefficientPercent(
  distanceKm
) {
  const distance =
    Number(distanceKm);

  if (
    !Number.isFinite(distance) ||
    distance <= 0
  ) {
    return null;
  }

  if (distance < 100) {
    return 160;
  }

  if (distance < 200) {
    return 130;
  }

  if (distance < 300) {
    return 115;
  }

  return 100;
}

// =========================
// NORMALIZE TARIFF
// =========================

export function normalizeTariff(value) {
  const tariff =
    String(value || "")
      .trim()
      .toLowerCase();

  if (TARIFFS[tariff]) {
    return tariff;
  }

  return null;
}

// =========================
// GET TARIFF
// =========================

export function getTariff(value) {
  const tariff =
    normalizeTariff(value);

  if (!tariff) {
    return null;
  }

  return TARIFFS[tariff];
}

// =========================
// PRICE CALCULATION
// =========================

export function calculatePrice(
  distanceKm,
  tariffValue
) {
  const distance =
    Number(distanceKm);

  if (
    !Number.isFinite(distance) ||
    distance <= 0
  ) {
    return {
      ok: false,
      error: "invalid distance"
    };
  }

  const tariff =
    getTariff(tariffValue);

  if (!tariff) {
    return {
      ok: false,
      error: "invalid tariff"
    };
  }

  const coefficientPercent =
    getDistanceCoefficientPercent(
      distance
    );

  if (!coefficientPercent) {
    return {
      ok: false,
      error: "invalid coefficient"
    };
  }

  // =========================
  // NORMALIZE DISTANCE
  //
  // geo.js отдаёт расстояние
  // с точностью до 0.1 км.
  //
  // 397.2 км -> 3972
  // =========================

  const distanceTenths =
    Math.round(
      distance * 10
    );

  // =========================
  // RAW PRICE
  //
  // distanceTenths / 10
  // coefficientPercent / 100
  //
  // поэтому делитель = 1000
  // =========================

  const rawNumerator =
    distanceTenths *
    tariff.pricePerKm *
    coefficientPercent;

  const calculatedPrice =
    Math.round(
      rawNumerator / 1000
    );

  // =========================
  // MINIMUM PRICE
  // =========================

  const price =
    Math.max(
      calculatedPrice,
      tariff.minimumPrice
    );

  return {
    ok: true,

    tariff:
      tariff.code,

    tariffName:
      tariff.name,

    distance:
      Number(
        (
          distanceTenths / 10
        ).toFixed(1)
      ),

    pricePerKm:
      tariff.pricePerKm,

    coefficient:
      coefficientPercent / 100,

    minimumPrice:
      tariff.minimumPrice,

    calculatedPrice,

    price
  };
}

// =========================
// PUBLIC TARIFF LIST
// =========================

export function getTariffs() {
  return Object
    .values(TARIFFS)
    .map(item => ({
      code:
        item.code,

      name:
        item.name,

      pricePerKm:
        item.pricePerKm,

      minimumPrice:
        item.minimumPrice
    }));
}