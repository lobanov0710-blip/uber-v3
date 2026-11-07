// =========================================
// DRIVER AVAILABILITY SERVICE
// =========================================

import {
  createMutationIdempotency
} from "./mutationIdempotency.js";

import {
  getMutationIdempotencyRecord
} from "./mutationIdempotencyRepository.js";

import {
  getDriverAvailabilityState,
  getOwnedVehicleEligibility,
  updateDriverAvailability
} from "./driverAvailabilityRepository.js";


const INPUT_KEYS =
  new Set([
    "activeVehicleId",
    "requestedState",
    "expectedRevision"
  ]);

const STATES =
  new Set([
    "off_line",
    "on_line"
  ]);


function clean(value) {
  return String(value ?? "")
    .trim();
}


function invalid(code = "invalid_request") {
  return {
    ok: false,
    status: 400,
    error: "invalid request",
    code
  };
}


function forbidden(code) {
  return {
    ok: false,
    status: 403,
    error: "forbidden",
    code
  };
}


function notFound(code) {
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


function unprocessable(code) {
  return {
    ok: false,
    status: 422,
    error: "unprocessable entity",
    code
  };
}


function createId(prefix) {
  if (!globalThis.crypto?.randomUUID) {
    throw new Error(
      "secure random UUID unavailable"
    );
  }

  return `${prefix}_${crypto.randomUUID()}`;
}


function requireDriver(user) {
  if (
    !user ||
    typeof user !== "object" ||
    Array.isArray(user) ||
    clean(user.role)
      .toLowerCase() !==
      "driver" ||
    !clean(user.id)
  ) {
    return null;
  }

  return {
    id:
      clean(user.id)
  };
}


function parseInput(input) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input)
      .some(
        key =>
          !INPUT_KEYS.has(key)
      )
  ) {
    return null;
  }

  const requestedState =
    clean(
      input.requestedState
    )
      .toLowerCase();

  const expectedRevision =
    Number(
      input.expectedRevision
    );

  const activeVehicleId =
    input.activeVehicleId == null
      || clean(
        input.activeVehicleId
      ) === ""
      ? null
      : clean(
          input.activeVehicleId
        );

  if (
    !STATES.has(
      requestedState
    )
    ||
    !Number.isSafeInteger(
      expectedRevision
    )
    ||
    expectedRevision < 1
    ||
    (
      activeVehicleId !== null
      &&
      !/^vehicle_[A-Za-z0-9_-]{8,100}$/.test(
        activeVehicleId
      )
    )
    ||
    (
      requestedState ===
        "on_line"
      &&
      activeVehicleId ===
        null
    )
  ) {
    return null;
  }

  return {
    activeVehicleId,
    requestedState,
    expectedRevision
  };
}


async function prepareIdempotency(
  env,
  driverId,
  key,
  body
) {
  const prepared =
    await createMutationIdempotency({
      key,
      operation:
        "driver.availability.update",
      target:
        driverId,
      body
    });

  if (
    prepared?.ok !== true
  ) {
    return {
      ok: false,
      response:
        prepared
    };
  }

  const existing =
    await getMutationIdempotencyRecord(
      env,
      {
        actorAccountId:
          driverId,
        operation:
          prepared.operation,
        keyDigest:
          prepared.keyDigest
      }
    );

  if (existing) {
    if (
      existing.requestDigest !==
        prepared.requestDigest
    ) {
      return {
        ok: false,
        response:
          conflict(
            "idempotency_key_reused"
          )
      };
    }

    if (
      existing.state ===
        "completed"
      &&
      existing.result
    ) {
      return {
        ok: false,
        response:
          existing.result
      };
    }

    return {
      ok: false,
      response:
        conflict(
          "idempotency_in_progress"
        )
    };
  }

  return {
    ok: true,
    value: {
      ...prepared,
      claimId:
        createId(
          "idem-claim"
        )
    }
  };
}


async function resolveRepositoryResult(
  env,
  driverId,
  idempotency,
  repositoryResult
) {
  if (
    repositoryResult.kind !==
      "existing_idempotency"
  ) {
    return repositoryResult.result;
  }

  const existing =
    await getMutationIdempotencyRecord(
      env,
      {
        actorAccountId:
          driverId,
        operation:
          idempotency.operation,
        keyDigest:
          idempotency.keyDigest
      }
    );

  if (!existing) {
    throw new Error(
      "availability idempotency record disappeared"
    );
  }

  if (
    existing.requestDigest !==
      idempotency.requestDigest
  ) {
    return conflict(
      "idempotency_key_reused"
    );
  }

  if (
    existing.state ===
      "completed"
    &&
    existing.result
  ) {
    return existing.result;
  }

  return conflict(
    "idempotency_in_progress"
  );
}


export async function putDriverAvailability(
  env,
  user,
  input,
  options = {}
) {
  const driver =
    requireDriver(
      user
    );

  if (!driver) {
    return forbidden(
      "driver_role_required"
    );
  }

  const parsed =
    parseInput(
      input
    );

  if (!parsed) {
    return invalid();
  }

  const current =
    await getDriverAvailabilityState(
      env,
      driver.id
    );

  if (!current) {
    return notFound(
      "driver_profile_not_found"
    );
  }

  const idempotency =
    await prepareIdempotency(
      env,
      driver.id,
      options.idempotencyKey,
      parsed
    );

  if (!idempotency.ok) {
    return idempotency.response;
  }

  if (
    current.revision ===
      null
  ) {
    return conflict(
      "driver_availability_missing"
    );
  }

  if (
    current.revision !==
      parsed.expectedRevision
  ) {
    return conflict(
      "availability_revision_conflict"
    );
  }

  if (
    parsed.requestedState === "on_line" &&
    current.registrationStatus !==
      "approved"
  ) {
    return unprocessable(
      "driver_not_approved"
    );
  }

  if (
    parsed.requestedState === "on_line" &&
    current.identityStatus !==
      "verified"
  ) {
    return unprocessable(
      "identity_verification_required"
    );
  }

  if (
    current.state ===
      "on_line"
    &&
    parsed.activeVehicleId !==
      null
    &&
    parsed.activeVehicleId !==
      current.activeVehicleId
  ) {
    return conflict(
      "active_vehicle_switch_requires_offline"
    );
  }

  if (
    parsed.activeVehicleId !==
      null
  ) {
    const vehicle =
      await getOwnedVehicleEligibility(
        env,
        driver.id,
        parsed.activeVehicleId
      );

    if (!vehicle) {
      return notFound(
        "vehicle_not_found"
      );
    }

    if (
      parsed.requestedState === "on_line" &&
      vehicle.status !==
        "approved"
    ) {
      return unprocessable(
        "vehicle_not_approved"
      );
    }
  }

  const now =
    Number.isSafeInteger(
      options.nowMs
    )
      ? options.nowMs
      : Date.now();

  const result =
    await updateDriverAvailability(
      env,
      {
        driverId:
          driver.id,

        ...parsed,

        updatedAt:
          now,

        requestId:
          clean(
            options.requestId
          ),

        auditId:
          createId(
            "audit"
          ),

        idempotency:
          idempotency.value
      }
    );

  return resolveRepositoryResult(
    env,
    driver.id,
    idempotency.value,
    result
  );
}
