// =========================================
// ADMIN ITEM MODERATION SERVICE
// =========================================

import {
  adminCan,
  resolveAdminAccess
} from "./adminAuthorization.js";

import {
  addOneCalendarMonthUtc
} from "./photoControlSchedule.js";

import {
  finalizeDriverRegistrationModeration,
  getAdminRegistrationReviewBundle,
  moderateDocument,
  moderateVehicle,
  moderateVehiclePhoto,
  startRegistrationReviewIdempotent
} from "./adminItemModerationRepository.js";

import {
  createMutationIdempotency
} from "./mutationIdempotency.js";

import {
  getMutationIdempotencyRecord
} from "./mutationIdempotencyRepository.js";


const DOCUMENT_DECISIONS =
  new Set([
    "verified",
    "changes_required",
    "rejected"
  ]);

const VEHICLE_DECISIONS =
  new Set([
    "approved",
    "changes_required",
    "rejected"
  ]);

const FINAL_DECISIONS =
  new Set([
    "approved",
    "changes_required",
    "rejected"
  ]);

const REQUIRED_DRIVER_DOCUMENTS =
  new Set([
    "passport_main",
    "passport_registration",
    "passport_selfie",
    "identity_reference_selfie",
    "driver_license_front",
    "driver_license_back"
  ]);

const REQUIRED_VEHICLE_PHOTOS =
  new Set([
    "left",
    "front",
    "right",
    "rear",
    "open_trunk",
    "rear_cabin",
    "front_cabin"
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


function unprocessable(code, details = null) {
  return {
    ok: false,
    status: 422,
    error: "unprocessable entity",
    code,
    ...(details ? { details } : {})
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


function validRevision(value) {
  const revision =
    Number(value);

  return (
    Number.isSafeInteger(
      revision
    ) &&
    revision >= 1
  );
}


function normalizeNote(value) {
  if (
    value === null ||
    value === undefined ||
    clean(value) === ""
  ) {
    return null;
  }

  const note =
    clean(value);

  if (
    note.length > 1000 ||
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(
      note
    )
  ) {
    return undefined;
  }

  return note;
}


async function requireAccess(
  env,
  user
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

  return {
    ok: true,
    access
  };
}


function canSeeReviewBundle(access) {
  return (
    access?.isOwner === true ||
    adminCan(
      access,
      "drivers.verify_documents"
    ) ||
    adminCan(
      access,
      "drivers.verify_identity"
    ) ||
    adminCan(
      access,
      "vehicles.verify"
    )
  );
}


function canFinalizeRegistration(access) {
  return (
    access?.isOwner === true ||
    (
      adminCan(
        access,
        "drivers.verify_documents"
      ) &&
      adminCan(
        access,
        "drivers.verify_identity"
      ) &&
      adminCan(
        access,
        "vehicles.verify"
      )
    )
  );
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
      "idempotency record disappeared"
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


export async function getAdminRegistrationReview(
  env,
  user,
  driverId
) {
  const resolved =
    await requireAccess(
      env,
      user
    );

  if (!resolved.ok) {
    return resolved.response;
  }

  if (
    !canSeeReviewBundle(
      resolved.access
    )
  ) {
    return forbidden();
  }

  const bundle =
    await getAdminRegistrationReviewBundle(
      env,
      driverId
    );

  if (!bundle) {
    return notFound(
      "registration_not_found"
    );
  }

  return {
    ok: true,
    registration:
      bundle
  };
}


export async function startAdminRegistrationReview(
  env,
  user,
  driverId,
  input,
  options = {}
) {
  const resolved =
    await requireAccess(
      env,
      user
    );

  if (!resolved.ok) {
    return resolved.response;
  }

  const canReview =
    resolved.access.isOwner === true ||
    adminCan(
      resolved.access,
      "drivers.verify_documents"
    ) ||
    adminCan(
      resolved.access,
      "drivers.verify_identity"
    );

  if (!canReview) {
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
      ) ||
    !validRevision(
      input.expectedRevision
    )
  ) {
    return invalid();
  }

  const idempotency =
    await prepareIdempotency(
      env,
      resolved.access,
      {
        key:
          options.idempotencyKey,
        operation:
          "admin.registration.review.start",
        target:
          clean(driverId),
        body:
          input
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
    await startRegistrationReviewIdempotent(
      env,
      {
        actorAccountId:
          resolved.access.accountId,
        driverId:
          clean(driverId),
        expectedRevision:
          Number(
            input.expectedRevision
          ),
        reviewedAt:
          now,
        requestId:
          clean(
            options.requestId
          ),
        reviewId:
          createId(
            "review"
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
    resolved.access,
    idempotency.value,
    result
  );
}


export async function reviewAdminRegistrationItem(
  env,
  user,
  driverId,
  targetType,
  targetId,
  input,
  options = {}
) {
  const resolved =
    await requireAccess(
      env,
      user
    );

  if (!resolved.ok) {
    return resolved.response;
  }

  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input)
      .some(
        key =>
          ![
            "decision",
            "expectedRevision",
            "note"
          ].includes(key)
      )
  ) {
    return invalid();
  }

  const type =
    clean(targetType)
      .toLowerCase();

  const decision =
    clean(input.decision)
      .toLowerCase();

  const note =
    normalizeNote(
      input.note
    );

  if (
    note === undefined ||
    !validRevision(
      input.expectedRevision
    )
  ) {
    return invalid();
  }

  let permission;
  let allowedDecisions;

  if (
    type === "document"
  ) {
    permission =
      "drivers.verify_documents";
    allowedDecisions =
      DOCUMENT_DECISIONS;

  } else if (
    type === "vehicle_photo"
    ||
    type === "vehicle"
  ) {
    permission =
      "vehicles.verify";
    allowedDecisions =
      type === "vehicle"
        ? VEHICLE_DECISIONS
        : DOCUMENT_DECISIONS;

  } else if (
    type === "identity"
  ) {

    // D4 is explicitly not approved. The
    // backend must not manufacture a verified
    // identity from a manual admin click.
    if (
      decision === "verified"
      ||
      decision === "approved"
    ) {
      return conflict(
        "identity_verification_provider_not_approved"
      );
    }

    return conflict(
      "identity_moderation_not_available"
    );

  } else {

    return invalid(
      "invalid_moderation_target"
    );
  }

  if (
    !resolved.access.isOwner &&
    !adminCan(
      resolved.access,
      permission
    )
  ) {
    return forbidden();
  }

  if (
    !allowedDecisions.has(
      decision
    )
  ) {
    return invalid(
      "invalid_moderation_decision"
    );
  }

  // Replay follows current authorization and input validation, before mutable state checks.
  const idempotency =
    await prepareIdempotency(
      env,
      resolved.access,
      {
        key:
          options.idempotencyKey,
        operation:
          `admin.registration.item.${type}`,
        target:
          `${clean(driverId)}:${clean(targetId)}`,
        body:
          input
      }
    );

  if (!idempotency.ok) {
    return idempotency.response;
  }

  const bundle =
    await getAdminRegistrationReviewBundle(
      env,
      driverId
    );

  if (!bundle) {
    return notFound(
      "registration_not_found"
    );
  }

  if (
    bundle.profile
      .registrationStatus !==
      "under_review"
  ) {
    return conflict(
      "registration_not_under_review"
    );
  }

  const revision =
    Number(
      input.expectedRevision
    );

  let target;

  if (
    type === "document"
  ) {
    target =
      bundle.documents.find(
        item =>
          item.id ===
            targetId
      );
  } else if (
    type === "vehicle_photo"
  ) {
    target =
      bundle.photos.find(
        item =>
          item.id ===
            targetId
      );
  } else {
    target =
      bundle.vehicles.find(
        item =>
          item.id ===
            targetId
      );
  }

  if (!target) {
    return notFound(
      "moderation_target_not_found"
    );
  }

  if (
    target.revision !==
      revision
  ) {
    return conflict(
      "moderation_revision_conflict"
    );
  }

  if (
    (
      type === "document" ||
      type === "vehicle_photo"
    )
    &&
    target.status !==
      "pending"
  ) {
    return conflict(
      "moderation_target_not_pending"
    );
  }

  if (
    type === "vehicle" &&
    target.status !==
      "pending_review"
  ) {
    return conflict(
      "vehicle_not_pending_review"
    );
  }

  if (
    type === "vehicle" &&
    decision === "approved"
  ) {
    const verifiedDocumentKinds =
      new Set(
        bundle.documents
          .filter(
            item =>
              item.vehicleId ===
                target.id
              &&
              item.status ===
                "verified"
          )
          .map(
            item =>
              item.kind
          )
      );

    const verifiedPhotoKinds =
      new Set(
        bundle.photos
          .filter(
            item =>
              item.vehicleId ===
                target.id
              &&
              item.status ===
                "verified"
          )
          .map(
            item =>
              item.kind
          )
      );

    const missingDocuments = [
      "sts_front",
      "sts_back",
      ...(
        target.usageBasis ===
          "rental"
          ? [
              "rental_contract"
            ]
          : []
      )
    ]
      .filter(
        kind =>
          !verifiedDocumentKinds.has(
            kind
          )
      );

    const missingPhotos =
      [
        ...REQUIRED_VEHICLE_PHOTOS
      ]
        .filter(
          kind =>
            !verifiedPhotoKinds.has(
              kind
            )
        );

    if (
      !target.usageBasis ||
      missingDocuments.length > 0 ||
      missingPhotos.length > 0
    ) {
      return unprocessable(
        "vehicle_review_incomplete",
        {
          missingUsageBasis:
            !target.usageBasis,
          missingDocuments,
          missingPhotos
        }
      );
    }
  }

  const now =
    Number.isSafeInteger(
      options.nowMs
    )
      ? options.nowMs
      : Date.now();

  const common = {
    actorAccountId:
      resolved.access.accountId,
    driverId:
      clean(driverId),
    expectedRevision:
      revision,
    decision,
    note,
    reviewedAt:
      now,
    requestId:
      clean(
        options.requestId
      ),
    reviewId:
      createId(
        "review"
      ),
    auditId:
      createId(
        "audit"
      ),
    idempotency:
      idempotency.value
  };

  let result;

  if (
    type === "document"
  ) {
    result =
      await moderateDocument(
        env,
        {
          ...common,
          documentId:
            clean(targetId)
        }
      );

  } else if (
    type === "vehicle_photo"
  ) {
    result =
      await moderateVehiclePhoto(
        env,
        {
          ...common,
          photoId:
            clean(targetId)
        }
      );

  } else {
    result =
      await moderateVehicle(
        env,
        {
          ...common,
          vehicleId:
            clean(targetId),
          nextPhotoCheckDueAt:
            decision ===
              "approved"
              ? addOneCalendarMonthUtc(
                  now
                )
              : null
        }
      );
  }

  return resolveRepositoryResult(
    env,
    resolved.access,
    idempotency.value,
    result
  );
}


export async function completeAdminRegistrationReview(
  env,
  user,
  driverId,
  input,
  options = {}
) {
  const resolved =
    await requireAccess(
      env,
      user
    );

  if (!resolved.ok) {
    return resolved.response;
  }

  if (
    !canFinalizeRegistration(
      resolved.access
    )
  ) {
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
            "decision",
            "expectedRevision",
            "note"
          ].includes(key)
      )
  ) {
    return invalid();
  }

  const decision =
    clean(input.decision)
      .toLowerCase();

  const note =
    normalizeNote(
      input.note
    );

  if (
    !FINAL_DECISIONS.has(
      decision
    ) ||
    !validRevision(
      input.expectedRevision
    ) ||
    note === undefined
  ) {
    return invalid();
  }

  // Replay follows current authorization and input validation, before mutable state checks.
  const idempotency =
    await prepareIdempotency(
      env,
      resolved.access,
      {
        key:
          options.idempotencyKey,
        operation:
          "admin.registration.review.complete",
        target:
          clean(driverId),
        body:
          input
      }
    );

  if (!idempotency.ok) {
    return idempotency.response;
  }

  const bundle =
    await getAdminRegistrationReviewBundle(
      env,
      driverId
    );

  if (!bundle) {
    return notFound(
      "registration_not_found"
    );
  }

  if (
    bundle.profile
      .registrationStatus !==
      "under_review"
  ) {
    return conflict(
      "registration_not_under_review"
    );
  }

  if (
    bundle.profile.revision !==
      Number(
        input.expectedRevision
      )
  ) {
    return conflict(
      "moderation_revision_conflict"
    );
  }

  if (
    decision === "approved"
  ) {
    if (
      bundle.profile
        .identityStatus !==
        "verified"
    ) {
      return conflict(
        "identity_verification_required"
      );
    }

    const verifiedDriverKinds =
      new Set(
        bundle.documents
          .filter(
            item =>
              item.vehicleId === null
              &&
              item.status ===
                "verified"
          )
          .map(
            item =>
              item.kind
          )
      );

    const missingDriverDocuments =
      [
        ...REQUIRED_DRIVER_DOCUMENTS
      ]
        .filter(
          kind =>
            !verifiedDriverKinds.has(
              kind
            )
        );

    if (
      missingDriverDocuments.length >
        0
    ) {
      return unprocessable(
        "registration_documents_not_verified",
        {
          missingDriverDocuments
        }
      );
    }

    if (
      !bundle.vehicles.some(
        vehicle =>
          vehicle.status ===
            "approved"
      )
    ) {
      return unprocessable(
        "approved_vehicle_required"
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
    await finalizeDriverRegistrationModeration(
      env,
      {
        actorAccountId:
          resolved.access.accountId,
        driverId:
          clean(driverId),
        expectedRevision:
          Number(
            input.expectedRevision
          ),
        decision,
        note,
        reviewedAt:
          now,
        requestId:
          clean(
            options.requestId
          ),
        reviewId:
          createId(
            "review"
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
    resolved.access,
    idempotency.value,
    result
  );
}
