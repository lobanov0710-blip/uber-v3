// =========================================
// DRIVER TRIP OPERATIONAL SERVICE
// =========================================
//
// D3 contracts:
// - verification challenge creation
// - assignment operational phase transition
//
// D4 provider is intentionally absent.
// Therefore no client endpoint can set a
// verification session to "verified".
// =========================================

import {
  createMutationIdempotency
} from "./mutationIdempotency.js";

import {
  getMutationIdempotencyRecord
} from "./mutationIdempotencyRepository.js";

import {
  advanceDriverAssignmentPhase,
  getDriverOperationalAssignment,
  insertTripVerificationChallenge
} from "./driverTripOperationalRepository.js";


const PHASE_TRANSITIONS =
  new Map([
    [
      "assigned",
      "en_route_to_pickup"
    ],
    [
      "en_route_to_pickup",
      "arrived"
    ],
    [
      "arrived",
      "in_trip"
    ]
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


function forbidden(code = "driver_role_required") {
  return {
    ok: false,
    status: 403,
    error: "forbidden",
    code
  };
}


function notFound(code = "assignment_not_found") {
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


function unavailable(code) {
  return {
    ok: false,
    status: 503,
    error: "service unavailable",
    code
  };
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


function createId(prefix) {
  if (!globalThis.crypto?.randomUUID) {
    throw new Error(
      "secure random UUID unavailable"
    );
  }

  return `${prefix}_${crypto.randomUUID()}`;
}


function requireChallengeTtlSeconds(env) {
  const seconds =
    Number(
      env?.TRIP_VERIFICATION_CHALLENGE_TTL_SECONDS
    );

  if (
    !Number.isSafeInteger(
      seconds
    ) ||
    seconds <= 0 ||
    seconds > 60 * 60
  ) {
    return null;
  }

  return seconds;
}


function bytesToBase64Url(bytes) {
  let binary = "";

  for (
    const byte of bytes
  ) {
    binary +=
      String.fromCharCode(
        byte
      );
  }

  return btoa(
    binary
  )
    .replace(
      /\+/g,
      "-"
    )
    .replace(
      /\//g,
      "_"
    )
    .replace(
      /=+$/g,
      ""
    );
}


async function createChallengeDigest() {
  if (
    !globalThis.crypto?.getRandomValues ||
    !globalThis.crypto?.subtle
  ) {
    throw new Error(
      "secure crypto unavailable"
    );
  }

  const random =
    new Uint8Array(
      32
    );

  crypto.getRandomValues(
    random
  );

  const digest =
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        random
      )
    );

  return bytesToBase64Url(
    digest
  );
}


async function prepareIdempotency(
  env,
  driverId,
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
      "trip idempotency record disappeared"
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


export async function createDriverTripVerificationChallenge(
  env,
  user,
  assignmentId,
  input,
  options = {}
) {
  const driver =
    requireDriver(
      user
    );

  if (!driver) {
    return forbidden();
  }

  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input)
      .some(
        key =>
          key !==
            "expectedRevision"
      )
  ) {
    return invalid();
  }

  const expectedRevision =
    Number(
      input.expectedRevision
    );

  if (
    !Number.isSafeInteger(
      expectedRevision
    ) ||
    expectedRevision < 1
  ) {
    return invalid(
      "invalid_revision"
    );
  }

  const assignment =
    await getDriverOperationalAssignment(
      env,
      driver.id,
      assignmentId
    );

  if (!assignment) {
    return notFound();
  }

  if (
    assignment.state !==
      "active" ||
    assignment.revokedAt !==
      null ||
    assignment.orderStatus !==
      "taken" ||
    assignment.phase !==
      "assigned"
  ) {
    return conflict(
      "verification_challenge_not_available"
    );
  }

  if (
    assignment.revision !==
      expectedRevision
  ) {
    return conflict(
      "assignment_revision_conflict"
    );
  }

  const ttlSeconds =
    requireChallengeTtlSeconds(
      env
    );

  if (!ttlSeconds) {
    return unavailable(
      "trip_verification_ttl_not_configured"
    );
  }

  const idempotency =
    await prepareIdempotency(
      env,
      driver.id,
      {
        key:
          options.idempotencyKey,
        operation:
          "driver.assignment.verification_challenge.create",
        target:
          assignment.id,
        body: {
          expectedRevision
        }
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

  const expiresAt =
    now +
    ttlSeconds *
      1000;

  if (
    !Number.isSafeInteger(
      expiresAt
    )
  ) {
    throw new Error(
      "invalid trip verification expiry"
    );
  }

  const result =
    await insertTripVerificationChallenge(
      env,
      {
        driverId:
          driver.id,
        assignmentId:
          assignment.id,
        expectedRevision,
        verificationSessionId:
          createId(
            "verification"
          ),
        challengeDigest:
          await createChallengeDigest(),
        expiresAt,
        createdAt:
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


export async function changeDriverAssignmentPhase(
  env,
  user,
  assignmentId,
  input,
  options = {}
) {
  const driver =
    requireDriver(
      user
    );

  if (!driver) {
    return forbidden();
  }

  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input)
      .some(
        key =>
          ![
            "phase",
            "verificationSessionId",
            "expectedRevision"
          ].includes(key)
      )
  ) {
    return invalid();
  }

  const targetPhase =
    clean(
      input.phase
    )
      .toLowerCase();

  const expectedRevision =
    Number(
      input.expectedRevision
    );

  const verificationSessionId =
    input.verificationSessionId == null
      || clean(
        input.verificationSessionId
      ) === ""
      ? null
      : clean(
          input.verificationSessionId
        );

  if (
    !Number.isSafeInteger(
      expectedRevision
    ) ||
    expectedRevision < 1
    ||
    ![
      ...PHASE_TRANSITIONS.values()
    ].includes(
      targetPhase
    )
    ||
    (
      verificationSessionId !== null
      &&
      !/^verification_[A-Za-z0-9_-]{8,100}$/.test(
        verificationSessionId
      )
    )
    ||
    (
      targetPhase ===
        "en_route_to_pickup"
      &&
      verificationSessionId ===
        null
    )
  ) {
    return invalid();
  }

  const assignment =
    await getDriverOperationalAssignment(
      env,
      driver.id,
      assignmentId
    );

  if (!assignment) {
    return notFound();
  }

  if (
    assignment.state !==
      "active" ||
    assignment.revokedAt !==
      null
  ) {
    return conflict(
      "assignment_not_active"
    );
  }

  if (
    assignment.revision !==
      expectedRevision
  ) {
    return conflict(
      "assignment_revision_conflict"
    );
  }

  const expectedTarget =
    PHASE_TRANSITIONS.get(
      assignment.phase
    );

  if (
    expectedTarget !==
      targetPhase
  ) {
    return conflict(
      "invalid_phase_transition"
    );
  }

  if (
    assignment.orderStatus !==
      "taken"
  ) {
    return conflict(
      "order_state_conflict"
    );
  }

  const idempotency =
    await prepareIdempotency(
      env,
      driver.id,
      {
        key:
          options.idempotencyKey,
        operation:
          "driver.assignment.phase",
        target:
          assignment.id,
        body: {
          phase:
            targetPhase,
          verificationSessionId,
          expectedRevision
        }
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
    await advanceDriverAssignmentPhase(
      env,
      {
        driverId:
          driver.id,
        assignmentId:
          assignment.id,
        expectedRevision,
        expectedPhase:
          assignment.phase,
        targetPhase,
        verificationSessionId,
        changedAt:
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
