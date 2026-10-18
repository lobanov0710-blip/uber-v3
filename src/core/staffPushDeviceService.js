// =========================================
// STAFF PUSH DEVICE SERVICE
// =========================================
//
// Application layer for authenticated staff
// push-device registration.
//
// The client is NOT allowed to choose:
// - account id
// - session family id
//
// Both values come from the authoritative
// staff authorization result.
// =========================================

import {
  upsertStaffPushDevice,
  deleteStaffPushDevice
} from "./staffPushDeviceRepository.js";


// =========================================
// CONSTANTS
// =========================================

const INSTALLATION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_FCM_TOKEN_LENGTH =
  4096;


// =========================================
// RESULTS
// =========================================

function invalidRequest() {

  return {
    ok: false,
    status: 400,
    error:
      "invalid push device request"
  };
}


function invalidPrincipal() {

  return {
    ok: false,
    status: 500,
    error:
      "invalid staff principal"
  };
}


// =========================================
// PRINCIPAL
// =========================================

function parsePrincipal(
  auth
) {

  const accountId =
    String(
      auth?.user?.id ??
      ""
    )
      .trim();


  const sessionFamilyId =
    String(
      auth?.session?.familyId ??
      ""
    )
      .trim();


  if (
    !accountId
    ||
    accountId.length > 100
    ||
    !sessionFamilyId
    ||
    sessionFamilyId.length > 100
  ) {

    return null;
  }


  return {
    accountId,
    sessionFamilyId
  };
}


// =========================================
// INSTALLATION ID
// =========================================

function parseInstallationId(
  value
) {

  const installationId =
    String(
      value ??
      ""
    )
      .trim()
      .toLowerCase();


  if (
    !INSTALLATION_ID_PATTERN.test(
      installationId
    )
  ) {

    return null;
  }


  return installationId;
}


// =========================================
// TOKEN
// =========================================

function parseFcmToken(
  value
) {

  if (
    typeof value !==
      "string"
  ) {

    return null;
  }


  const token =
    value.trim();


  if (
    !token
    ||
    token.length >
      MAX_FCM_TOKEN_LENGTH
    ||
    /\s/.test(
      token
    )
  ) {

    return null;
  }


  return token;
}


// =========================================
// REGISTER / UPDATE
// =========================================

export async function registerStaffPushDevice(
  env,
  auth,
  input
) {

  const principal =
    parsePrincipal(
      auth
    );


  if (!principal) {

    return invalidPrincipal();
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
  ) {

    return invalidRequest();
  }


  const installationId =
    parseInstallationId(
      input.installationId
    );


  const platform =
    String(
      input.platform ??
      ""
    )
      .trim()
      .toLowerCase();


  const fcmToken =
    parseFcmToken(
      input.token
    );


  if (
    !installationId
    ||
    platform !==
      "android"
    ||
    !fcmToken
  ) {

    return invalidRequest();
  }


  await upsertStaffPushDevice(
    env,
    {
      installationId,

      accountId:
        principal.accountId,

      sessionFamilyId:
        principal.sessionFamilyId,

      platform,

      fcmToken,

      updatedAt:
        Date.now()
    }
  );


  return {
    ok: true
  };
}


// =========================================
// UNREGISTER
// =========================================

export async function unregisterStaffPushDevice(
  env,
  auth,
  input
) {

  const principal =
    parsePrincipal(
      auth
    );


  if (!principal) {

    return invalidPrincipal();
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
  ) {

    return invalidRequest();
  }


  const installationId =
    parseInstallationId(
      input.installationId
    );


  if (!installationId) {

    return invalidRequest();
  }


  await deleteStaffPushDevice(
    env,
    principal.accountId,
    installationId
  );


  return {
    ok: true
  };
}
