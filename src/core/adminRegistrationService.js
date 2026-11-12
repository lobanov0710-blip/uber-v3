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
  listRegistrationQueue
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
