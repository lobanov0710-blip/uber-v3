// =========================================
// DRIVER REGISTRATION SERVICE
// =========================================
//
// Self-service operations use only the
// authenticated staff principal. driverId,
// role and registration status are never
// accepted from client input.
// =========================================

import {
  getDriverProfile,
  getDriverVehicle,
  insertDriverVehicle,
  listDriverVehicles,
  updateDriverRegistrationProfile,
  updateDriverVehicle
} from "./driverRegistrationRepository.js";


const VEHICLE_CLASSES =
  new Set([
    "comfort",
    "business",
    "minivan"
  ]);

const BAGGAGE_CAPACITIES =
  new Set([
    "reduced",
    "standard",
    "large"
  ]);

const USAGE_BASES =
  new Set([
    "owner",
    "rental",
    "other"
  ]);

const PROFILE_INPUT_KEYS =
  new Set([
    "fullName",
    "birthDate",
    "region",
    "expectedRevision"
  ]);

const VEHICLE_CREATE_KEYS =
  new Set([
    "vin",
    "plate",
    "make",
    "model",
    "color",
    "vehicleClass",
    "capacity",
    "baggageCapacity",
    "usageBasis"
  ]);

const VEHICLE_PATCH_KEYS =
  new Set([
    ...VEHICLE_CREATE_KEYS,
    "expectedRevision"
  ]);

const CRITICAL_VEHICLE_FIELDS =
  new Set([
    "vin",
    "plate",
    "usageBasis"
  ]);


function clean(value) {
  return String(value ?? "").trim();
}

function invalid(code = "invalid_request") {
  return {
    ok: false,
    status: 400,
    error: "invalid request",
    code
  };
}

function forbidden(code = "forbidden") {
  return {
    ok: false,
    status: 403,
    error: "forbidden",
    code
  };
}

function notFound(code = "not_found") {
  return {
    ok: false,
    status: 404,
    error: "not found",
    code
  };
}

function conflict(code) {
  return {
    ok: false,
    status: 409,
    error: "conflict",
    code
  };
}

function requireDriver(user) {
  if (
    !user ||
    typeof user !== "object" ||
    clean(user.id) === "" ||
    clean(user.role).toLowerCase() !== "driver"
  ) {
    return null;
  }

  return {
    id: clean(user.id)
  };
}

function onlyKeys(input, allowed) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input)
  ) {
    return false;
  }

  return Object.keys(input)
    .every(key => allowed.has(key));
}

function validFullName(value) {
  const text = clean(value);

  return (
    text.length >= 2 &&
    text.length <= 100 &&
    !/[\u0000-\u001F\u007F]/.test(text)
  );
}

function validRegion(value) {
  const text = clean(value);

  return (
    text.length >= 1 &&
    text.length <= 120 &&
    !/[\u0000-\u001F\u007F]/.test(text)
  );
}

function validBirthDate(value, nowMs = Date.now()) {
  const text = clean(value);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return false;
  }

  const [year, month, day] =
    text
      .split("-")
      .map(Number);

  const timestamp =
    Date.UTC(
      year,
      month - 1,
      day
    );

  const date =
    new Date(timestamp);

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return false;
  }

  return timestamp <= nowMs;
}

function validRevision(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 1;
}

function normalizeVin(value) {
  const vin = clean(value).toUpperCase();

  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) {
    return null;
  }

  return vin;
}

function normalizeVehicle(input) {
  const vin = normalizeVin(input.vin);
  const plate = clean(input.plate);
  const make = clean(input.make);
  const model = clean(input.model);
  const color =
    input.color == null || clean(input.color) === ""
      ? null
      : clean(input.color);
  const vehicleClass = clean(input.vehicleClass).toLowerCase();
  const capacity = Number(input.capacity);
  const baggageCapacity = clean(input.baggageCapacity).toLowerCase();
  const usageBasis = clean(input.usageBasis).toLowerCase();

  if (
    !vin ||
    plate.length < 1 ||
    plate.length > 32 ||
    make.length < 1 ||
    make.length > 80 ||
    model.length < 1 ||
    model.length > 80 ||
    (color !== null && color.length > 80) ||
    !VEHICLE_CLASSES.has(vehicleClass) ||
    !Number.isSafeInteger(capacity) ||
    capacity < 1 ||
    capacity > 20 ||
    !BAGGAGE_CAPACITIES.has(baggageCapacity) ||
    !USAGE_BASES.has(usageBasis)
  ) {
    return null;
  }

  return {
    vin,
    plate,
    make,
    model,
    color,
    vehicleClass,
    capacity,
    baggageCapacity,
    usageBasis
  };
}

function createId(prefix) {
  if (!globalThis.crypto?.randomUUID) {
    throw new Error("secure random UUID unavailable");
  }

  return `${prefix}_${crypto.randomUUID()}`;
}


export async function getDriverMe(env, user) {
  const driver = requireDriver(user);

  if (!driver) {
    return forbidden("driver_role_required");
  }

  const profile =
    await getDriverProfile(
      env,
      driver.id
    );

  if (!profile) {
    return conflict("driver_profile_missing");
  }

  const vehicles =
    await listDriverVehicles(
      env,
      driver.id
    );

  return {
    ok: true,
    profile,
    vehicles
  };
}


export async function putDriverRegistration(
  env,
  user,
  input,
  options = {}
) {
  const driver = requireDriver(user);

  if (!driver) {
    return forbidden("driver_role_required");
  }

  if (
    !onlyKeys(input, PROFILE_INPUT_KEYS) ||
    !validFullName(input.fullName) ||
    !validBirthDate(
      input.birthDate,
      Number.isSafeInteger(options.nowMs)
        ? options.nowMs
        : Date.now()
    ) ||
    !validRegion(input.region) ||
    !validRevision(input.expectedRevision)
  ) {
    return invalid();
  }

  const result =
    await updateDriverRegistrationProfile(
      env,
      driver.id,
      {
        fullName: clean(input.fullName),
        birthDate: clean(input.birthDate),
        region: clean(input.region),
        expectedRevision: Number(input.expectedRevision),
        updatedAt:
          Number.isSafeInteger(options.nowMs)
            ? options.nowMs
            : Date.now()
      }
    );

  if (result.ok) {
    return {
      ok: true,
      profile: result.profile
    };
  }

  if (result.reason === "not_found") {
    return conflict("driver_profile_missing");
  }

  if (result.reason === "state") {
    return conflict("registration_not_editable");
  }

  return conflict("revision_conflict");
}


export async function createDriverVehicle(
  env,
  user,
  input,
  options = {}
) {
  const driver = requireDriver(user);

  if (!driver) {
    return forbidden("driver_role_required");
  }

  if (
    !onlyKeys(input, VEHICLE_CREATE_KEYS)
  ) {
    return invalid();
  }

  const normalized =
    normalizeVehicle(input);

  if (!normalized) {
    return invalid("invalid_vehicle");
  }

  const profile =
    await getDriverProfile(
      env,
      driver.id
    );

  if (!profile) {
    return conflict("driver_profile_missing");
  }

  if (profile.registrationStatus === "rejected") {
    return forbidden("registration_rejected");
  }

  try {
    const vehicle =
      await insertDriverVehicle(
        env,
        driver.id,
        {
          id: createId("vehicle"),
          ...normalized,
          createdAt:
            Number.isSafeInteger(options.nowMs)
              ? options.nowMs
              : Date.now()
        }
      );

    return {
      ok: true,
      vehicle
    };

  } catch (error) {
    return conflict("vehicle_create_conflict");
  }
}


export async function patchDriverVehicle(
  env,
  user,
  vehicleId,
  input,
  options = {}
) {
  const driver = requireDriver(user);

  if (!driver) {
    return forbidden("driver_role_required");
  }

  if (
    !onlyKeys(input, VEHICLE_PATCH_KEYS) ||
    !validRevision(input.expectedRevision)
  ) {
    return invalid();
  }

  const providedFields =
    Object.keys(input)
      .filter(key => key !== "expectedRevision");

  if (providedFields.length === 0) {
    return invalid();
  }

  const current =
    await getDriverVehicle(
      env,
      driver.id,
      vehicleId
    );

  if (!current) {
    return notFound("vehicle_not_found");
  }

  const merged = {
    vin:
      Object.hasOwn(input, "vin")
        ? input.vin
        : current.vin,
    plate:
      Object.hasOwn(input, "plate")
        ? input.plate
        : current.plate,
    make:
      Object.hasOwn(input, "make")
        ? input.make
        : current.make,
    model:
      Object.hasOwn(input, "model")
        ? input.model
        : current.model,
    color:
      Object.hasOwn(input, "color")
        ? input.color
        : current.color,
    vehicleClass:
      Object.hasOwn(input, "vehicleClass")
        ? input.vehicleClass
        : current.vehicleClass,
    capacity:
      Object.hasOwn(input, "capacity")
        ? input.capacity
        : current.capacity,
    baggageCapacity:
      Object.hasOwn(input, "baggageCapacity")
        ? input.baggageCapacity
        : current.baggageCapacity,
    usageBasis:
      Object.hasOwn(input, "usageBasis")
        ? input.usageBasis
        : current.usageBasis
  };

  const normalized =
    normalizeVehicle(merged);

  if (!normalized) {
    return invalid("invalid_vehicle");
  }

  const criticalChange =
    providedFields.some(
      field =>
        CRITICAL_VEHICLE_FIELDS.has(field) &&
        clean(current[field === "vehicleClass" ? "vehicleClass" : field])
          .toUpperCase() !==
        clean(normalized[field])
          .toUpperCase()
    );

  const profile =
    await getDriverProfile(
      env,
      driver.id
    );

  if (
    criticalChange &&
    profile?.availability?.activeVehicleId === current.id
  ) {
    return conflict("active_vehicle_change_forbidden");
  }

  const result =
    await updateDriverVehicle(
      env,
      driver.id,
      current.id,
      {
        ...normalized,
        expectedRevision: Number(input.expectedRevision),
        criticalChange,
        updatedAt:
          Number.isSafeInteger(options.nowMs)
            ? options.nowMs
            : Date.now()
      }
    );

  if (result.ok) {
    return {
      ok: true,
      vehicle: result.vehicle
    };
  }

  if (result.reason === "not_found") {
    return notFound("vehicle_not_found");
  }

  if (result.reason === "state") {
    return conflict("vehicle_not_editable");
  }

  return conflict("revision_conflict");
}
