// =========================================
// DRIVER REGISTRATION REPOSITORY
// =========================================

function requireDatabase(env) {
  if (!env?.DB) {
    throw new Error("D1 DB binding is not configured");
  }
  return env.DB;
}

function clean(value) {
  return String(value ?? "").trim();
}

function requireText(value, field) {
  const text = clean(value);
  if (!text) {
    throw new Error(`invalid driver ${field}`);
  }
  return text;
}

function requireRevision(value) {
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new Error("invalid driver revision");
  }
  return revision;
}

function requireTimestamp(value) {
  const timestamp = Number(value);
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) {
    throw new Error("invalid driver timestamp");
  }
  return timestamp;
}

function changes(result) {
  if (result?.success !== true) {
    throw new Error("driver D1 operation failed");
  }

  const value = Number(result?.meta?.changes ?? 0);
  if (!Number.isSafeInteger(value) || value < 0 || value > 1) {
    throw new Error("invalid driver D1 change count");
  }

  return value;
}

function mapProfile(row) {
  if (!row) {
    return null;
  }

  return {
    driverId: clean(row.staff_account_id),
    phone: clean(row.normalized_phone),
    registrationStatus: clean(row.registration_status).toLowerCase(),
    identityStatus: clean(row.identity_status).toLowerCase(),
    fullName: row.full_name == null ? null : clean(row.full_name),
    birthDate: row.birth_date == null ? null : clean(row.birth_date),
    region: row.region == null ? null : clean(row.region),
    revision: Number(row.revision),
    submittedAt:
      row.submitted_at == null
        ? null
        : Number(row.submitted_at),
    availability: {
      state: clean(row.availability_state || "off_line").toLowerCase(),
      activeVehicleId:
        row.active_vehicle_id == null
          ? null
          : clean(row.active_vehicle_id),
      revision:
        row.availability_revision == null
          ? null
          : Number(row.availability_revision)
    }
  };
}

function mapVehicle(row) {
  if (!row) {
    return null;
  }

  return {
    id: clean(row.id),
    driverId: clean(row.driver_id),
    vin: clean(row.vin),
    plate: clean(row.plate),
    make: clean(row.make),
    model: clean(row.model),
    color: row.color == null ? null : clean(row.color),
    vehicleClass: clean(row.class).toLowerCase(),
    capacity: Number(row.capacity),
    baggageCapacity: clean(row.baggage_capacity).toLowerCase(),
    usageBasis:
      row.usage_basis == null
        ? null
        : clean(row.usage_basis).toLowerCase(),
    status: clean(row.status).toLowerCase(),
    revision: Number(row.revision),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at)
  };
}

export async function getDriverProfile(env, driverId) {
  const id = requireText(driverId, "id");
  const db = requireDatabase(env);

  const row =
    await db
      .prepare(`
        SELECT
          p.staff_account_id,
          p.normalized_phone,
          p.registration_status,
          p.identity_status,
          p.full_name,
          p.birth_date,
          p.region,
          p.revision,
          p.submitted_at,

          a.state AS availability_state,
          a.active_vehicle_id,
          a.revision AS availability_revision

        FROM driver_profiles p

        LEFT JOIN driver_availability a
          ON a.driver_id = p.staff_account_id

        WHERE p.staff_account_id = ?1
        LIMIT 1
      `)
      .bind(id)
      .first();

  return mapProfile(row);
}

export async function listDriverVehicles(env, driverId) {
  const id = requireText(driverId, "id");
  const db = requireDatabase(env);

  const result =
    await db
      .prepare(`
        SELECT
          id,
          driver_id,
          vin,
          plate,
          make,
          model,
          color,
          class,
          capacity,
          baggage_capacity,
          usage_basis,
          status,
          revision,
          created_at,
          updated_at

        FROM vehicles

        WHERE driver_id = ?1

        ORDER BY created_at ASC
      `)
      .bind(id)
      .all();

  if (result?.success !== true || !Array.isArray(result?.results)) {
    throw new Error("driver vehicle list failed");
  }

  return result.results
    .map(mapVehicle)
    .filter(Boolean);
}

export async function getDriverVehicle(env, driverId, vehicleId) {
  const driver = requireText(driverId, "id");
  const vehicle = requireText(vehicleId, "vehicleId");
  const db = requireDatabase(env);

  const row =
    await db
      .prepare(`
        SELECT
          id,
          driver_id,
          vin,
          plate,
          make,
          model,
          color,
          class,
          capacity,
          baggage_capacity,
          usage_basis,
          status,
          revision,
          created_at,
          updated_at

        FROM vehicles

        WHERE id = ?1
          AND driver_id = ?2

        LIMIT 1
      `)
      .bind(vehicle, driver)
      .first();

  return mapVehicle(row);
}

export async function updateDriverRegistrationProfile(
  env,
  driverId,
  {
    fullName,
    birthDate,
    region,
    expectedRevision,
    updatedAt
  }
) {
  const id = requireText(driverId, "id");
  const revision = requireRevision(expectedRevision);
  const timestamp = requireTimestamp(updatedAt);
  const db = requireDatabase(env);

  const result =
    await db
      .prepare(`
        UPDATE driver_profiles

        SET
          full_name = ?3,
          birth_date = ?4,
          region = ?5,
          revision = revision + 1,
          updated_at = ?6

        WHERE staff_account_id = ?1
          AND revision = ?2
          AND registration_status IN (
            'draft',
            'changes_required'
          )
      `)
      .bind(
        id,
        revision,
        requireText(fullName, "fullName"),
        requireText(birthDate, "birthDate"),
        requireText(region, "region"),
        timestamp
      )
      .run();

  const changed = changes(result);
  const profile = await getDriverProfile(env, id);

  if (changed === 1) {
    return {
      ok: true,
      profile
    };
  }

  if (!profile) {
    return {
      ok: false,
      reason: "not_found"
    };
  }

  if (
    profile.registrationStatus !== "draft" &&
    profile.registrationStatus !== "changes_required"
  ) {
    return {
      ok: false,
      reason: "state"
    };
  }

  return {
    ok: false,
    reason: "revision"
  };
}

export async function insertDriverVehicle(
  env,
  driverId,
  vehicle
) {
  const driver = requireText(driverId, "id");
  const db = requireDatabase(env);
  const createdAt = requireTimestamp(vehicle.createdAt);

  const result =
    await db
      .prepare(`
        INSERT INTO vehicles (
          id,
          driver_id,
          vin,
          plate,
          make,
          model,
          color,
          class,
          capacity,
          baggage_capacity,
          status,
          revision,
          created_at,
          updated_at,
          usage_basis
        )
        VALUES (
          ?1,
          ?2,
          ?3,
          ?4,
          ?5,
          ?6,
          ?7,
          ?8,
          ?9,
          ?10,
          'draft',
          1,
          ?11,
          ?11,
          ?12
        )
      `)
      .bind(
        requireText(vehicle.id, "vehicleId"),
        driver,
        requireText(vehicle.vin, "vin"),
        requireText(vehicle.plate, "plate"),
        requireText(vehicle.make, "make"),
        requireText(vehicle.model, "model"),
        vehicle.color == null ? null : clean(vehicle.color),
        requireText(vehicle.vehicleClass, "class"),
        Number(vehicle.capacity),
        requireText(vehicle.baggageCapacity, "baggageCapacity"),
        createdAt,
        requireText(vehicle.usageBasis, "usageBasis")
      )
      .run();

  if (changes(result) !== 1) {
    throw new Error("driver vehicle insert failed");
  }

  const persisted =
    await getDriverVehicle(
      env,
      driver,
      vehicle.id
    );

  if (!persisted) {
    throw new Error("driver vehicle readback failed");
  }

  return persisted;
}

export async function updateDriverVehicle(
  env,
  driverId,
  vehicleId,
  {
    vin,
    plate,
    make,
    model,
    color,
    vehicleClass,
    capacity,
    baggageCapacity,
    usageBasis,
    expectedRevision,
    criticalChange,
    updatedAt
  }
) {
  const driver = requireText(driverId, "id");
  const vehicle = requireText(vehicleId, "vehicleId");
  const revision = requireRevision(expectedRevision);
  const timestamp = requireTimestamp(updatedAt);
  const db = requireDatabase(env);

  const result =
    await db
      .prepare(`
        UPDATE vehicles

        SET
          vin = ?4,
          plate = ?5,
          make = ?6,
          model = ?7,
          color = ?8,
          class = ?9,
          capacity = ?10,
          baggage_capacity = ?11,
          usage_basis = ?12,

          status =
            CASE
              WHEN ?13 = 1
                AND status IN (
                  'approved',
                  'photo_check_required'
                )
              THEN 'pending_review'
              ELSE status
            END,

          revision = revision + 1,
          updated_at = ?14

        WHERE id = ?1
          AND driver_id = ?2
          AND revision = ?3
          AND status NOT IN (
            'suspended',
            'rejected'
          )
      `)
      .bind(
        vehicle,
        driver,
        revision,
        requireText(vin, "vin"),
        requireText(plate, "plate"),
        requireText(make, "make"),
        requireText(model, "model"),
        color == null ? null : clean(color),
        requireText(vehicleClass, "class"),
        Number(capacity),
        requireText(baggageCapacity, "baggageCapacity"),
        requireText(usageBasis, "usageBasis"),
        criticalChange ? 1 : 0,
        timestamp
      )
      .run();

  const changed = changes(result);
  const persisted =
    await getDriverVehicle(
      env,
      driver,
      vehicle
    );

  if (changed === 1) {
    return {
      ok: true,
      vehicle: persisted
    };
  }

  if (!persisted) {
    return {
      ok: false,
      reason: "not_found"
    };
  }

  if (
    persisted.status === "suspended" ||
    persisted.status === "rejected"
  ) {
    return {
      ok: false,
      reason: "state"
    };
  }

  return {
    ok: false,
    reason: "revision"
  };
}
