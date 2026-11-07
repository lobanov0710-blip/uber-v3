// =========================================
// VEHICLE PHOTO CONTROL SERVICE
// =========================================

import {
  adminCan,
  resolveAdminAccess
} from "./adminAuthorization.js";

import {
  createMutationIdempotency
} from "./mutationIdempotency.js";

import {
  getMutationIdempotencyRecord
} from "./mutationIdempotencyRepository.js";

import {
  createVehiclePhotoCheck,
  generateDueMonthlyPhotoChecks,
  getAdminVehiclePhotoCheckBundle,
  getVehiclePhotoControlState,
  listDriverOpenPhotoChecks,
  reviewVehiclePhotoCheck
} from "./vehiclePhotoControlRepository.js";

import {
  addOneCalendarMonthUtc,
  PHOTO_CONTROL_GRACE_MS
} from "./photoControlSchedule.js";

const KINDS =
  new Set([
    "monthly",
    "complaint",
    "manual"
  ]);

const UNPLANNED_RESTRICTIONS =
  new Set([
    "after_current_trip",
    "immediate"
  ]);

const INPUT_KEYS =
  new Set([
    "kind",
    "reason",
    "restrictionMode",
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


function notFound(code = "vehicle_not_found") {
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


  const kind =
    clean(input.kind)
      .toLowerCase();

  const reason =
    clean(input.reason);

  const suppliedRestriction =
    clean(
      input.restrictionMode
    )
      .toLowerCase();

  const expectedRevision =
    Number(
      input.expectedRevision
    );


  if (
    !KINDS.has(kind) ||
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


  let restrictionMode;


  if (
    kind === "monthly"
  ) {
    if (
      suppliedRestriction &&
      suppliedRestriction !==
        "grace_period"
    ) {
      return null;
    }

    restrictionMode =
      "grace_period";

  } else {

    if (
      !UNPLANNED_RESTRICTIONS.has(
        suppliedRestriction
      )
    ) {
      return null;
    }

    restrictionMode =
      suppliedRestriction;
  }


  return {
    kind,
    reason,
    restrictionMode,
    expectedRevision
  };
}


async function prepareIdempotency(
  env,
  actorAccountId,
  key,
  vehicleId,
  body
) {
  const prepared =
    await createMutationIdempotency({
      key,
      operation:
        "admin.vehicle.photo_check.create",
      target:
        vehicleId,
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
        actorAccountId,
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
        "completed" &&
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
  actorAccountId,
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
        actorAccountId,
        operation:
          idempotency.operation,
        keyDigest:
          idempotency.keyDigest
      }
    );


  if (!existing) {
    throw new Error(
      "photo control idempotency record disappeared"
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
      "completed" &&
    existing.result
  ) {
    return existing.result;
  }


  return conflict(
    "idempotency_in_progress"
  );
}


export async function requestVehiclePhotoCheck(
  env,
  user,
  vehicleId,
  input,
  options = {}
) {
  const access =
    await resolveAdminAccess(
      env,
      user
    );


  if (
    access?.ok !== true ||
    !adminCan(
      access,
      "vehicles.verify"
    )
  ) {
    return forbidden(
      access?.code ||
      "permission_required"
    );
  }


  const parsed =
    parseInput(
      input
    );


  if (!parsed) {
    return invalid();
  }


  const normalizedVehicleId =
    clean(vehicleId);


  if (
    !/^vehicle_[A-Za-z0-9_-]{8,100}$/.test(
      normalizedVehicleId
    )
  ) {
    return invalid(
      "invalid_vehicle_id"
    );
  }


  const idempotency =
    await prepareIdempotency(
      env,
      access.accountId,
      options.idempotencyKey,
      normalizedVehicleId,
      parsed
    );


  if (!idempotency.ok) {
    return idempotency.response;
  }


  const current =
    await getVehiclePhotoControlState(
      env,
      normalizedVehicleId
    );


  if (!current) {
    return notFound();
  }


  if (
    current.revision !==
      parsed.expectedRevision
  ) {
    return conflict(
      "vehicle_revision_conflict"
    );
  }


  if (
    ![
      "approved",
      "photo_check_required",
      "suspended"
    ].includes(
      current.status
    )
  ) {
    return unprocessable(
      "vehicle_not_eligible_for_photo_check"
    );
  }


  const now =
    Number.isSafeInteger(
      options.nowMs
    )
      ? options.nowMs
      : Date.now();


  if (
    !Number.isSafeInteger(now) ||
    now <= 0
  ) {
    throw new Error(
      "invalid photo control timestamp"
    );
  }


  const graceUntil =
    parsed.kind === "monthly"
      ? now +
        PHOTO_CONTROL_GRACE_MS
      : now;


  if (
    !Number.isSafeInteger(
      graceUntil
    )
  ) {
    throw new Error(
      "invalid photo control grace"
    );
  }


  const result =
    await createVehiclePhotoCheck(
      env,
      {
        actorAccountId:
          access.accountId,
        vehicleId:
          normalizedVehicleId,
        expectedRevision:
          parsed.expectedRevision,
        checkId:
          createId(
            "photo-check"
          ),
        kind:
          parsed.kind,
        reason:
          parsed.reason,
        restrictionMode:
          parsed.restrictionMode,
        dueAt:
          now,
        graceUntil,
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
    access.accountId,
    idempotency.value,
    result
  );
}

// =========================================
// PHOTO-CONTROL LIFECYCLE
// =========================================

const REVIEW_DECISIONS =
  new Set([
    "passed",
    "failed",
    "manual_review"
  ]);

const REVIEW_INPUT_KEYS =
  new Set([
    "decision",
    "expectedRevision",
    "note"
  ]);

const REQUIRED_PHOTO_KINDS = [
  "left",
  "front",
  "right",
  "rear",
  "open_trunk",
  "rear_cabin",
  "front_cabin"
];


function normalizeReviewInput(
  input
) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input)
      .some(
        key =>
          !REVIEW_INPUT_KEYS
            .has(key)
      )
  ) {
    return null;
  }


  const decision =
    clean(input.decision)
      .toLowerCase();

  const expectedRevision =
    Number(
      input.expectedRevision
    );

  const note =
    input.note == null ||
    clean(input.note) === ""
      ? null
      : clean(input.note);


  if (
    !REVIEW_DECISIONS.has(
      decision
    ) ||
    !Number.isSafeInteger(
      expectedRevision
    ) ||
    expectedRevision < 1 ||
    (
      note !== null &&
      (
        note.length > 1000 ||
        /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(
          note
        )
      )
    )
  ) {
    return null;
  }


  return {
    decision,
    expectedRevision,
    note
  };
}


async function requireVehicleVerifyAccess(
  env,
  user
) {
  const access =
    await resolveAdminAccess(
      env,
      user
    );


  if (
    access?.ok !== true ||
    !adminCan(
      access,
      "vehicles.verify"
    )
  ) {
    return {
      ok: false,
      response:
        forbidden(
          access?.code ||
          "permission_required"
        )
    };
  }


  return {
    ok: true,
    access
  };
}


async function prepareReviewIdempotency(
  env,
  actorAccountId,
  key,
  target,
  body
) {
  const prepared =
    await createMutationIdempotency({
      key,
      operation:
        "admin.vehicle.photo_check.review",
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
        actorAccountId,
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
        "completed" &&
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


export async function getAdminVehiclePhotoCheck(
  env,
  user,
  vehicleId,
  photoCheckId
) {
  const resolved =
    await requireVehicleVerifyAccess(
      env,
      user
    );


  if (!resolved.ok) {
    return resolved.response;
  }


  const bundle =
    await getAdminVehiclePhotoCheckBundle(
      env,
      clean(vehicleId),
      clean(photoCheckId)
    );


  if (!bundle) {
    return notFound(
      "photo_check_not_found"
    );
  }


  return {
    ok: true,
    photoCheck:
      bundle
  };
}


export async function getDriverPhotoChecks(
  env,
  user
) {
  if (
    !user ||
    typeof user !== "object" ||
    Array.isArray(user) ||
    clean(user.role)
      .toLowerCase() !==
      "driver" ||
    !clean(user.id)
  ) {
    return forbidden(
      "driver_role_required"
    );
  }


  const photoChecks =
    await listDriverOpenPhotoChecks(
      env,
      clean(user.id)
    );


  return {
    ok: true,
    photoChecks
  };
}


export async function reviewAdminVehiclePhotoCheck(
  env,
  user,
  vehicleId,
  photoCheckId,
  input,
  options = {}
) {
  const resolved =
    await requireVehicleVerifyAccess(
      env,
      user
    );


  if (!resolved.ok) {
    return resolved.response;
  }


  const parsed =
    normalizeReviewInput(
      input
    );


  if (!parsed) {
    return invalid();
  }


  const normalizedVehicleId =
    clean(vehicleId);

  const normalizedCheckId =
    clean(photoCheckId);


  if (
    !/^vehicle_[A-Za-z0-9_-]{8,100}$/.test(
      normalizedVehicleId
    ) ||
    !/^photo-check_[A-Za-z0-9_-]{8,120}$/.test(
      normalizedCheckId
    )
  ) {
    return invalid(
      "invalid_photo_check"
    );
  }


  const idempotency =
    await prepareReviewIdempotency(
      env,
      resolved.access.accountId,
      options.idempotencyKey,
      `${normalizedVehicleId}:${normalizedCheckId}`,
      parsed
    );


  if (!idempotency.ok) {
    return idempotency.response;
  }


  const bundle =
    await getAdminVehiclePhotoCheckBundle(
      env,
      normalizedVehicleId,
      normalizedCheckId
    );


  if (!bundle) {
    return notFound(
      "photo_check_not_found"
    );
  }


  if (
    bundle.revision !==
      parsed.expectedRevision
  ) {
    return conflict(
      "photo_check_revision_conflict"
    );
  }


  if (
    bundle.result ===
      "passed"
  ) {
    return conflict(
      "photo_check_already_passed"
    );
  }


  if (
    parsed.decision ===
      "passed"
  ) {
    const present =
      new Set(
        bundle.photos.map(
          photo =>
            photo.kind
        )
      );


    const missingPhotoKinds =
      REQUIRED_PHOTO_KINDS
        .filter(
          kind =>
            !present.has(kind)
        );


    if (
      missingPhotoKinds.length >
        0
    ) {
      return {
        ok: false,
        status: 422,
        error:
          "unprocessable entity",
        code:
          "photo_check_incomplete",
        details: {
          missingPhotoKinds
        }
      };
    }
  }


  const now =
    Number.isSafeInteger(
      options.nowMs
    )
      ? options.nowMs
      : Date.now();


  if (
    !Number.isSafeInteger(now) ||
    now <= 0
  ) {
    throw new Error(
      "invalid photo control review timestamp"
    );
  }


  const nextDueAt =
    parsed.decision ===
      "passed"
      ? addOneCalendarMonthUtc(
          now
        )
      : null;


  const result =
    await reviewVehiclePhotoCheck(
      env,
      {
        actorAccountId:
          resolved.access.accountId,
        vehicleId:
          normalizedVehicleId,
        photoCheckId:
          normalizedCheckId,
        expectedRevision:
          parsed.expectedRevision,
        expectedVehicleRevision:
          bundle.vehicleRevision,
        decision:
          parsed.decision,
        note:
          parsed.note,
        reviewedAt:
          now,
        nextDueAt,
        reviewId:
          createId(
            "photo-check-review"
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
    resolved.access.accountId,
    idempotency.value,
    result
  );
}


export async function runMonthlyPhotoControlDueGeneration(
  env,
  options = {}
) {
  const now =
    Number.isSafeInteger(
      options.nowMs
    )
      ? options.nowMs
      : Date.now();


  return generateDueMonthlyPhotoChecks(
    env,
    {
      nowMs:
        now,
      graceMs:
        PHOTO_CONTROL_GRACE_MS,
      limit:
        options.limit
    }
  );
}

