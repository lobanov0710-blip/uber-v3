// =========================================
// ADMIN REGISTRATION MODERATION SERVICE
// =========================================
//
// OWNER bypasses permission checks.
// Dispatcher permissions are resolved only
// from authoritative D1 state.
// =========================================

import {
  adminCan,
  resolveAdminAccess
} from "./adminAuthorization.js";

import {
  listRegistrationQueue,
  startRegistrationReview
} from "./adminRegistrationRepository.js";


const QUEUE_STATUSES =
  new Set([
    "",
    "submitted",
    "under_review",
    "changes_required"
  ]);


function clean(
  value
) {

  return String(
    value ?? ""
  )
    .trim();
}


function forbidden(
  code =
    "permission_required"
) {

  return {
    ok:
      false,

    status:
      403,

    error:
      "forbidden",

    code
  };
}


function invalid(
  code =
    "invalid_request"
) {

  return {
    ok:
      false,

    status:
      400,

    error:
      "invalid request",

    code
  };
}


function conflict(
  code
) {

  return {
    ok:
      false,

    status:
      409,

    error:
      "conflict",

    code
  };
}


function createId(
  prefix
) {

  if (
    !globalThis.crypto
    ||
    typeof globalThis.crypto
      .randomUUID !==
      "function"
  ) {

    throw new Error(
      "secure random UUID unavailable"
    );
  }


  return (
    prefix +
    "_" +
    crypto.randomUUID()
  );
}


async function requireAdminAccess(
  env,
  user
) {

  const access =
    await resolveAdminAccess(
      env,
      user
    );


  if (
    access?.ok !==
      true
  ) {

    return {
      ok:
        false,

      response:
        forbidden(
          access?.code ||
          "admin_role_required"
        )
    };
  }


  return {
    ok:
      true,

    access
  };
}


export async function getAdminRegistrationQueue(
  env,
  user,
  input = {}
) {

  const resolved =
    await requireAdminAccess(
      env,
      user
    );


  if (!resolved.ok) {

    return resolved.response;
  }


  if (
    !adminCan(
      resolved.access,
      "drivers.read"
    )
  ) {

    return forbidden();
  }


  const status =
    clean(
      input.status
    )
      .toLowerCase();


  if (
    !QUEUE_STATUSES.has(
      status
    )
  ) {

    return invalid(
      "invalid_registration_status"
    );
  }


  const requestedLimit =
    input.limit ===
      undefined
      ||
      input.limit ===
        null
      ||
      clean(
        input.limit
      ) ===
        ""
      ? 50
      : Number(
          input.limit
        );


  if (
    !Number.isSafeInteger(
      requestedLimit
    )
    ||
    requestedLimit < 1
    ||
    requestedLimit > 200
  ) {

    return invalid(
      "invalid_limit"
    );
  }


  const registrations =
    await listRegistrationQueue(
      env,
      {
        status,
        limit:
          requestedLimit
      }
    );


  return {
    ok:
      true,

    count:
      registrations.length,

    registrations
  };
}


export async function beginAdminRegistrationReview(
  env,
  user,
  driverId,
  input,
  options = {}
) {

  const resolved =
    await requireAdminAccess(
      env,
      user
    );


  if (!resolved.ok) {

    return resolved.response;
  }


  // Starting the moderation process exposes
  // the reviewer to sensitive driver
  // materials. It therefore requires one of
  // the approved sensitive verification
  // permissions. OWNER is always allowed.
  const canReview =
    resolved.access.isOwner ===
      true
    ||
    adminCan(
      resolved.access,
      "drivers.verify_documents"
    )
    ||
    adminCan(
      resolved.access,
      "drivers.verify_identity"
    );


  if (!canReview) {

    return forbidden();
  }


  if (
    !input
    ||
    typeof input !==
      "object"
    ||
    Array.isArray(
      input
    )
    ||
    Object.keys(
      input
    )
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
    )
    ||
    expectedRevision < 1
  ) {

    return invalid(
      "invalid_revision"
    );
  }


  const driver =
    clean(
      driverId
    );


  if (!driver) {

    return invalid(
      "invalid_driver_id"
    );
  }


  const now =
    Number.isSafeInteger(
      options.nowMs
    )
      ? options.nowMs
      : Date.now();


  const result =
    await startRegistrationReview(
      env,
      {
        driverId:
          driver,

        expectedRevision,

        actorAccountId:
          resolved.access.accountId,

        reviewId:
          createId(
            "review"
          ),

        auditId:
          createId(
            "audit"
          ),

        requestId:
          clean(
            options.requestId
          ),

        reviewedAt:
          now
      }
    );


  if (
    result.changed !==
      true
  ) {

    return conflict(
      "registration_review_conflict"
    );
  }


  return {
    ok:
      true,

    registration: {
      driverId:
        driver,

      status:
        "under_review",

      revision:
        expectedRevision +
        1,

      reviewedAt:
        now
    }
  };
}
