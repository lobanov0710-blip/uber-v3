// =========================================
// ORDER ASSIGNMENT SERVICE
// =========================================

import {
  adminCan,
  resolveAdminAccess
} from "./adminAuthorization.js";

import {
  assignOrderToDriverVehicle,
  getAssignmentCandidateEligibility,
  getOrderAssignmentState,
  listActiveAssignmentsForDriver,
  reassignOrderToDriverVehicle
} from "./orderAssignmentRepository.js";

import {
  createMutationIdempotency
} from "./mutationIdempotency.js";

import {
  getMutationIdempotencyRecord
} from "./mutationIdempotencyRepository.js";


const INPUT_KEYS =
  new Set([
    "driverId",
    "vehicleId",
    "reason",
    "expectedRevision"
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


function forbidden(code = "permission_required") {
  return {
    ok: false,
    status: 403,
    error: "forbidden",
    code
  };
}


function notFound(code = "order_not_found") {
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

  const driverId =
    clean(
      input.driverId
    );

  const vehicleId =
    clean(
      input.vehicleId
    );

  const reason =
    clean(
      input.reason
    );

  const expectedRevision =
    Number(
      input.expectedRevision
    );

  if (
    !/^staff_[A-Za-z0-9_-]{8,94}$/.test(
      driverId
    ) ||
    !/^vehicle_[A-Za-z0-9_-]{8,100}$/.test(
      vehicleId
    ) ||
    reason.length < 1 ||
    reason.length > 500 ||
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(
      reason
    ) ||
    !Number.isSafeInteger(
      expectedRevision
    ) ||
    expectedRevision < 1
  ) {
    return null;
  }

  return {
    driverId,
    vehicleId,
    reason,
    expectedRevision
  };
}


async function requireAdminPermission(
  env,
  user,
  permission
) {
  const access =
    await resolveAdminAccess(
      env,
      user
    );

  if (
    access?.ok !== true
  ) {
    return {
      ok: false,
      response:
        forbidden(
          access?.code ||
          "admin_role_required"
        )
    };
  }

  if (
    !adminCan(
      access,
      permission
    )
  ) {
    return {
      ok: false,
      response:
        forbidden()
    };
  }

  return {
    ok: true,
    access
  };
}


async function checkCandidate(
  env,
  driverId,
  vehicleId
) {
  const candidate =
    await getAssignmentCandidateEligibility(
      env,
      driverId,
      vehicleId
    );

  if (!candidate) {
    return notFound(
      "driver_not_found"
    );
  }

  if (
    candidate.registrationStatus !==
      "approved"
  ) {
    return unprocessable(
      "driver_not_approved"
    );
  }

  if (
    candidate.identityStatus !==
      "verified"
  ) {
    return unprocessable(
      "identity_verification_required"
    );
  }

  if (
    !candidate.vehicleId
  ) {
    return notFound(
      "vehicle_not_found"
    );
  }

  if (
    candidate.vehicleStatus !==
      "approved"
  ) {
    return unprocessable(
      "vehicle_not_approved"
    );
  }

  if (
    candidate.availabilityState ===
      "on_line"
    &&
    candidate.activeVehicleId
    &&
    candidate.activeVehicleId !==
      vehicleId
  ) {
    return conflict(
      "active_vehicle_mismatch"
    );
  }

  return null;
}


async function prepareIdempotency(
  env,
  access,
  {
    key,
    operation,
    target,
    body
  }
) {
  const prepared =
    await createMutationIdempotency({
      key,
      operation,
      target,
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
          access.accountId,
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
  access,
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
          access.accountId,
        operation:
          idempotency.operation,
        keyDigest:
          idempotency.keyDigest
      }
    );

  if (!existing) {
    throw new Error(
      "assignment idempotency record disappeared"
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


export async function listDriverAssignments(
  env,
  user,
  input = {}
) {
  if (
    !user ||
    clean(user.role)
      .toLowerCase() !==
      "driver" ||
    !clean(user.id)
  ) {
    return forbidden(
      "driver_role_required"
    );
  }

  const limit =
    input.limit == null
      ? 100
      : Number(
          input.limit
        );

  if (
    !Number.isSafeInteger(
      limit
    ) ||
    limit < 1 ||
    limit > 200
  ) {
    return invalid(
      "invalid_limit"
    );
  }

  const assignments =
    await listActiveAssignmentsForDriver(
      env,
      clean(user.id),
      limit
    );

  return {
    ok: true,
    count:
      assignments.length,
    assignments
  };
}


export async function assignOrderByAdmin(
  env,
  user,
  orderId,
  input,
  options = {}
) {
  const authorization =
    await requireAdminPermission(
      env,
      user,
      "orders.assign"
    );

  if (!authorization.ok) {
    return authorization.response;
  }

  const parsed =
    parseInput(
      input
    );

  if (!parsed) {
    return invalid();
  }

  const state =
    await getOrderAssignmentState(
      env,
      orderId
    );

  if (!state) {
    return notFound();
  }

  if (
    state.orderRevision !==
      parsed.expectedRevision
  ) {
    return conflict(
      "order_revision_conflict"
    );
  }

  if (
    state.orderStatus !==
      "new"
    ||
    state.orderDriverId !==
      null
    ||
    state.assignment !==
      null
  ) {
    return conflict(
      "order_not_assignable"
    );
  }

  const candidateError =
    await checkCandidate(
      env,
      parsed.driverId,
      parsed.vehicleId
    );

  if (candidateError) {
    return candidateError;
  }

  const idempotency =
    await prepareIdempotency(
      env,
      authorization.access,
      {
        key:
          options.idempotencyKey,
        operation:
          "admin.order.assign",
        target:
          clean(orderId),
        body:
          parsed
      }
    );

  if (!idempotency.ok) {
    return idempotency.response;
  }

  const now =
    Number.isSafeInteger(
      options.nowMs
    )
      ? options.nowMs
      : Date.now();

  const result =
    await assignOrderToDriverVehicle(
      env,
      {
        actorAccountId:
          authorization.access
            .accountId,

        orderId:
          clean(orderId),

        ...parsed,

        assignedAt:
          now,

        assignmentId:
          createId(
            "assignment"
          ),

        auditId:
          createId(
            "audit"
          ),

        requestId:
          clean(
            options.requestId
          ),

        idempotency:
          idempotency.value
      }
    );

  return resolveRepositoryResult(
    env,
    authorization.access,
    idempotency.value,
    result
  );
}


export async function reassignOrderByAdmin(
  env,
  user,
  orderId,
  input,
  options = {}
) {
  const authorization =
    await requireAdminPermission(
      env,
      user,
      "orders.reassign"
    );

  if (!authorization.ok) {
    return authorization.response;
  }

  const parsed =
    parseInput(
      input
    );

  if (!parsed) {
    return invalid();
  }

  const state =
    await getOrderAssignmentState(
      env,
      orderId
    );

  if (!state) {
    return notFound();
  }

  if (
    state.orderRevision !==
      parsed.expectedRevision
  ) {
    return conflict(
      "order_revision_conflict"
    );
  }

  if (
    state.orderStatus !==
      "taken"
    ||
    !state.assignment
  ) {
    return conflict(
      "order_not_reassignable"
    );
  }

  if (
    state.assignment.driverId ===
      parsed.driverId
    &&
    state.assignment.vehicleId ===
      parsed.vehicleId
  ) {
    return conflict(
      "assignment_unchanged"
    );
  }

  const candidateError =
    await checkCandidate(
      env,
      parsed.driverId,
      parsed.vehicleId
    );

  if (candidateError) {
    return candidateError;
  }

  const idempotency =
    await prepareIdempotency(
      env,
      authorization.access,
      {
        key:
          options.idempotencyKey,
        operation:
          "admin.order.reassign",
        target:
          clean(orderId),
        body:
          parsed
      }
    );

  if (!idempotency.ok) {
    return idempotency.response;
  }

  const now =
    Number.isSafeInteger(
      options.nowMs
    )
      ? options.nowMs
      : Date.now();

  const result =
    await reassignOrderToDriverVehicle(
      env,
      {
        actorAccountId:
          authorization.access
            .accountId,

        orderId:
          clean(orderId),

        ...parsed,

        assignedAt:
          now,

        assignmentId:
          createId(
            "assignment"
          ),

        auditId:
          createId(
            "audit"
          ),

        requestId:
          clean(
            options.requestId
          ),

        idempotency:
          idempotency.value
      }
    );

  return resolveRepositoryResult(
    env,
    authorization.access,
    idempotency.value,
    result
  );
}
