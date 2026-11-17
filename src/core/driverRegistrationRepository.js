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

// D1 meta.changes includes trigger writes. SQL changes() reports only the
// immediately preceding top-level mutation; read it inside the same batch.
function writtenVehicle(result) {
  const rows = result?.results;
  const count = rows?.[0]?.written;
  if (result?.success !== true || !Array.isArray(rows) || rows.length !== 1 ||
      !Number.isSafeInteger(count) || count < 0 || count > 1) {
    throw new Error("invalid driver vehicle write count");
  }
  return count;
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
    modelYear: row.model_year ?? null,
    powertrain: row.powertrain ?? null,
    color: row.color == null ? null : clean(row.color),
    vehicleClass: row.class == null ? null : clean(row.class).toLowerCase(),
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
          model_year,
          powertrain,
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
          model_year,
          powertrain,
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

// Internal, owner-scoped metadata for the upcoming system-classified contract.
// Values are declarations only; they do not constitute document verification.
export async function getDriverVehicleClassificationDetails(env, driverId, vehicleId) {
  const driver = requireText(driverId, "id");
  const vehicle = requireText(vehicleId, "vehicleId");
  const row = await requireDatabase(env).prepare(`
    SELECT id, driver_id, make, model, model_year, powertrain, class, revision
    FROM vehicles WHERE id = ?1 AND driver_id = ?2
  `).bind(vehicle, driver).first();
  if (!row) return null;
  if (row.model_year !== null && (!Number.isSafeInteger(row.model_year) || row.model_year < 1 || row.model_year > 9999)) {
    throw new Error("Invalid stored vehicle year");
  }
  if (!Number.isSafeInteger(row.revision) || row.revision < 1) throw new Error("Invalid stored vehicle revision");
  return { vehicleId: row.id, make: row.make, model: row.model, modelYear: row.model_year,
    powertrain: row.powertrain, vehicleClass: row.class, revision: row.revision };
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

  const insert =
    db
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
          usage_basis,
          model_year,
          powertrain
        )
        SELECT
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
          ?12,
          ?13,
          ?14
        WHERE EXISTS (SELECT 1 FROM staff_accounts sa
          WHERE sa.id = ?2 AND sa.role = 'driver' AND sa.status = 'active')
      `)
      .bind(
        requireText(vehicle.id, "vehicleId"),
        driver,
        requireText(vehicle.vin, "vin"),
        requireText(vehicle.plate, "plate"),
        requireText(vehicle.make, "make"),
        requireText(vehicle.model, "model"),
        vehicle.color == null ? null : clean(vehicle.color),
        vehicle.vehicleClass == null ? null : requireText(vehicle.vehicleClass, "class"),
        Number(vehicle.capacity),
        requireText(vehicle.baggageCapacity, "baggageCapacity"),
        createdAt,
        requireText(vehicle.usageBasis, "usageBasis"),
        vehicle.modelYear ?? null,
        vehicle.powertrain ?? null
      );

  const results = await db.batch([insert, db.prepare('SELECT changes() AS written')]);

  if (writtenVehicle(results[1]) !== 1) {
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
    modelYear,
    capacity,
    baggageCapacity,
    usageBasis,
    expectedRevision,
    criticalChange,
    classificationChange = false,
    requestId,
    updatedAt
  }
) {
  const driver = requireText(driverId, "id");
  const vehicle = requireText(vehicleId, "vehicleId");
  const revision = requireRevision(expectedRevision);
  const timestamp = requireTimestamp(updatedAt);
  const db = requireDatabase(env);

  const mutation =
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
          model_year = ?15,
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
          AND EXISTS (SELECT 1 FROM staff_accounts sa
            WHERE sa.id = ?2 AND sa.role = 'driver' AND sa.status = 'active')
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
        vehicleClass == null ? null : requireText(vehicleClass, "class"),
        Number(capacity),
        requireText(baggageCapacity, "baggageCapacity"),
        requireText(usageBasis, "usageBasis"),
        criticalChange ? 1 : 0,
        timestamp,
        modelYear ?? null
      );

  let results;
  if (classificationChange) {
    const auditId = 'audit_' + crypto.randomUUID();
    const safeRequestId = requestId ?? ('req_' + crypto.randomUUID());
    results = await db.batch([
      mutation,
      db.prepare('SELECT changes() AS written'),
      db.prepare(`INSERT INTO audit_events
        (id,actor_account_id,action,target_type,target_id,outcome,request_id,created_at)
        SELECT ?1,?2,'driver.vehicle_reverification_required','vehicle',?3,'success',?4,?5
        WHERE changes() = 1`).bind(auditId, driver, vehicle, safeRequestId, timestamp),
      db.prepare(`UPDATE driver_availability SET state='off_line',revision=revision+1,updated_at=?1
        WHERE driver_id=?2 AND active_vehicle_id=?3
          AND EXISTS (SELECT 1 FROM audit_events WHERE id=?4)`)
        .bind(timestamp, driver, vehicle, auditId)
    ]);
  } else {
    results = await db.batch([mutation, db.prepare('SELECT changes() AS written')]);
  }

  const changed = writtenVehicle(results[1]);
  const persisted =
    await getDriverVehicle(
      env,
      driver,
      vehicle
    );

  if (changed === 1) {
    const active = classificationChange ? await db.prepare(`SELECT id FROM order_assignments
      WHERE vehicle_id=?1 AND driver_id=?2 AND state='active' AND revoked_at IS NULL LIMIT 1`)
      .bind(vehicle, driver).first() : null;
    return {
      ok: true,
      vehicle: persisted,
      requiresDispatcherReassignment: active != null
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
