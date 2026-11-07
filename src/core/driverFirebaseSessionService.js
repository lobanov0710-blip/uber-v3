// =========================================
// DRIVER FIREBASE SESSION SERVICE
// =========================================
//
// Approved D2:
// verified Firebase Phone identity
//   -> authoritative backend mapping
//   -> existing staff access/refresh session.
//
// Client-supplied role/phone/driverId are
// rejected. Registration remains draft for
// a newly created driver.
// =========================================

import {
  signJWT
} from "./auth.js";

import {
  createRefreshToken,
  hashStaffPassword
} from "./staffAuthCrypto.js";

import {
  STAFF_ACCESS_TTL_SECONDS,
  STAFF_REFRESH_TTL_MS
} from "./staffAuthService.js";

import {
  digestFirebaseIdToken,
  verifyFirebaseIdToken
} from "./firebaseIdTokenVerifier.js";

import {
  verifyFirebaseAppCheckToken
} from "./firebaseAppCheckVerifier.js";

import {
  commitExistingFirebaseExchange,
  commitNewFirebaseExchange,
  findDriverFirebaseIdentity,
  isFirebaseExchangeReplay
} from "./driverFirebaseAuthRepository.js";

import {
  consumeDriverExchangeRateLimit,
  createRateLimitBucketKey
} from "./driverExchangeRateLimit.js";


const ALLOWED_INPUT_KEYS =
  new Set([
    "firebaseIdToken",
    "installationId"
  ]);

const RATE_WINDOW_MS =
  60 * 1000;

const INSTALLATION_RATE_LIMIT =
  5;

const PHONE_RATE_LIMIT =
  5;

const IP_RATE_LIMIT =
  20;

const RATE_PENALTY_STEP_MS =
  15 * 1000;

const RATE_MAX_PENALTY_MS =
  5 * 60 * 1000;


function clean(
  value
) {

  return String(
    value ?? ""
  )
    .trim();
}


function invalidRequest(
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


function unauthorized(
  code =
    "invalid_firebase_identity"
) {

  return {
    ok:
      false,

    status:
      401,

    error:
      "authentication failed",

    code
  };
}


function forbidden(
  code
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


function conflict(
  code
) {

  return {
    ok:
      false,

    status:
      409,

    error:
      "authentication conflict",

    code
  };
}


function unavailable(
  code
) {

  return {
    ok:
      false,

    status:
      503,

    error:
      "authentication unavailable",

    code
  };
}


function rateLimited(
  blockedUntil,
  now
) {

  const retryAfterMs =
    Number.isSafeInteger(
      blockedUntil
    )
    &&
    blockedUntil >
      now
      ? blockedUntil -
        now
      : RATE_PENALTY_STEP_MS;


  return {
    ok:
      false,

    status:
      429,

    error:
      "too many requests",

    code:
      "driver_session_exchange_rate_limited",

    retryAfterMs
  };
}


async function enforceRateLimit(
  env,
  category,
  subject,
  now,
  limit,
  options
) {

  const normalized =
    clean(
      subject
    );


  if (!normalized) {

    return {
      allowed:
        true,

      blockedUntil:
        null
    };
  }


  const createBucket =
    options.createRateLimitBucketKey ??
    createRateLimitBucketKey;


  const consume =
    options.consumeRateLimit ??
    consumeDriverExchangeRateLimit;


  const bucketKey =
    await createBucket(
      category,
      normalized
    );


  return consume(
    env,
    {
      bucketKey,
      now,
      limit,
      windowMs:
        RATE_WINDOW_MS,

      penaltyStepMs:
        RATE_PENALTY_STEP_MS,

      maxPenaltyMs:
        RATE_MAX_PENALTY_MS
    }
  );
}


function parseInput(
  input
) {

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

    return null;
  }


  for (
    const key of Object.keys(
      input
    )
  ) {

    if (
      !ALLOWED_INPUT_KEYS.has(
        key
      )
    ) {

      return null;
    }
  }


  const firebaseIdToken =
    clean(
      input.firebaseIdToken
    );


  const installationId =
    clean(
      input.installationId
    )
      .toLowerCase();


  if (
    !firebaseIdToken
    ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      installationId
    )
  ) {

    return null;
  }


  return {
    firebaseIdToken,
    installationId
  };
}


function requireCrypto() {

  if (
    !globalThis.crypto
    ||
    !globalThis.crypto.subtle
    ||
    typeof globalThis.crypto
      .randomUUID !==
      "function"
    ||
    typeof globalThis.crypto
      .getRandomValues !==
      "function"
  ) {

    throw new Error(
      "secure crypto unavailable"
    );
  }


  return globalThis.crypto;
}


function createRandomId(
  prefix
) {

  return (
    prefix +
    "_" +
    requireCrypto()
      .randomUUID()
  );
}


function bytesToBase64Url(
  bytes
) {

  let binary =
    "";


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


function createRandomPasswordSeed() {

  const bytes =
    new Uint8Array(
      32
    );


  requireCrypto()
    .getRandomValues(
      bytes
    );


  return bytesToBase64Url(
    bytes
  );
}


async function createFirebaseLogin(
  projectId,
  uid
) {

  const digest =
    new Uint8Array(
      await requireCrypto()
        .subtle
        .digest(
          "SHA-256",
          new TextEncoder()
            .encode(
              projectId +
              ":" +
              uid
            )
        )
    );


  return (
    "fb_" +
    bytesToBase64Url(
      digest
    )
      .slice(
        0,
        40
      )
      .toLowerCase()
  );
}


async function createSessionBundle(
  env,
  account,
  now
) {

  if (
    !account
    ||
    account.role !==
      "driver"
    ||
    account.status !==
      "active"
    ||
    !Number.isSafeInteger(
      account.tokenVersion
    )
    ||
    account.tokenVersion < 1
  ) {

    throw new Error(
      "invalid driver account for session"
    );
  }


  const sessionId =
    createRandomId(
      "staff-session"
    );


  const familyId =
    createRandomId(
      "staff-family"
    );


  const refresh =
    await createRefreshToken();


  const refreshExpiresAt =
    now +
    STAFF_REFRESH_TTL_MS;


  if (
    !Number.isSafeInteger(
      refreshExpiresAt
    )
  ) {

    throw new Error(
      "invalid refresh expiration"
    );
  }


  const issuedAtSeconds =
    Math.floor(
      now / 1000
    );


  const accessToken =
    await signJWT(
      env?.JWT_SECRET,
      {
        sub:
          account.id,

        id:
          account.id,

        role:
          account.role,

        scope:
          "staff",

        tokenVersion:
          account.tokenVersion,

        sid:
          sessionId
      },
      STAFF_ACCESS_TTL_SECONDS
    );


  return {
    session: {
      id:
        sessionId,

      accountId:
        account.id,

      familyId,

      refreshTokenHash:
        refresh.refreshTokenHash,

      createdAt:
        now,

      expiresAt:
        refreshExpiresAt
    },

    response: {
      accessToken,

      accessExpiresAt:
        (
          issuedAtSeconds +
          STAFF_ACCESS_TTL_SECONDS
        ) *
        1000,

      refreshToken:
        refresh.refreshToken,

      refreshExpiresAt
    }
  };
}


function publicStaff(
  account
) {

  return {
    id:
      account.id,

    displayName:
      account.displayName,

    role:
      account.role
  };
}


export async function exchangeDriverFirebaseSession(
  env,
  input,
  options = {}
) {

  const parsed =
    parseInput(
      input
    );


  if (!parsed) {

    return invalidRequest();
  }


  const now =
    Number.isSafeInteger(
      options.nowMs
    )
      ? options.nowMs
      : Date.now();


  const requestId =
    clean(
      options.requestId
    )
    ||
    createRandomId(
      "req"
    );


  const installationRate =
    await enforceRateLimit(
      env,
      "installation",
      parsed.installationId,
      now,
      INSTALLATION_RATE_LIMIT,
      options
    );


  if (
    installationRate.allowed !==
      true
  ) {

    return rateLimited(
      installationRate.blockedUntil,
      now
    );
  }


  const clientIp =
    clean(
      options.clientIp
    );


  if (clientIp) {

    const ipRate =
      await enforceRateLimit(
        env,
        "ip",
        clientIp,
        now,
        IP_RATE_LIMIT,
        options
      );


    if (
      ipRate.allowed !==
        true
    ) {

      return rateLimited(
        ipRate.blockedUntil,
        now
      );
    }
  }


  const appCheckToken =
    clean(
      options.appCheckToken
    );


  if (!appCheckToken) {

    return unauthorized(
      "firebase_app_check_required"
    );
  }


  try {

    await (
      options.verifyFirebaseAppCheckToken ??
      verifyFirebaseAppCheckToken
    )(
      env,
      appCheckToken,
      {
        nowMs:
          now,

        fetchImpl:
          options.fetchImpl
      }
    );

  } catch (
    error
  ) {

    if (
      /not configured/i.test(
        String(
          error?.message ??
          ""
        )
      )
    ) {

      return unavailable(
        "firebase_app_check_not_configured"
      );
    }


    return unauthorized(
      "invalid_firebase_app_check"
    );
  }


  let verified;


  try {

    verified =
      await (
        options.verifyFirebaseIdToken ??
        verifyFirebaseIdToken
      )(
        env,
        parsed.firebaseIdToken,
        {
          nowMs:
            now,

          fetchImpl:
            options.fetchImpl
        }
      );

  } catch (
    error
  ) {

    if (
      /not configured/i.test(
        String(
          error?.message ??
          ""
        )
      )
    ) {

      return unavailable(
        "firebase_not_configured"
      );
    }


    return unauthorized();
  }


  const phoneRate =
    await enforceRateLimit(
      env,
      "phone",
      verified.phoneNumber,
      now,
      PHONE_RATE_LIMIT,
      options
    );


  if (
    phoneRate.allowed !==
      true
  ) {

    return rateLimited(
      phoneRate.blockedUntil,
      now
    );
  }


  let tokenDigest;


  try {

    tokenDigest =
      await digestFirebaseIdToken(
        parsed.firebaseIdToken
      );

  } catch (
    error
  ) {

    return unauthorized();
  }


  if (
    await isFirebaseExchangeReplay(
      env,
      tokenDigest
    )
  ) {

    return conflict(
      "firebase_token_replay"
    );
  }


  const identityLookup =
    await findDriverFirebaseIdentity(
      env,
      {
        firebaseUid:
          verified.uid,

        normalizedPhone:
          verified.phoneNumber
      }
    );


  if (
    identityLookup.kind ===
      "conflict"
  ) {

    return conflict(
      "firebase_identity_conflict"
    );
  }


  const tokenExpiresAt =
    verified.expiresAt *
    1000;


  const authTime =
    verified.authTime *
    1000;


  if (
    !Number.isSafeInteger(
      tokenExpiresAt
    )
    ||
    !Number.isSafeInteger(
      authTime
    )
  ) {

    return unauthorized();
  }


  if (
    identityLookup.kind ===
      "match"
  ) {

    const identity =
      identityLookup.identity;


    if (
      identity.firebaseProjectId !==
        verified.projectId
    ) {

      return conflict(
        "firebase_project_conflict"
      );
    }


    const account =
      identity.account;


    if (
      account.role !==
        "driver"
    ) {

      return forbidden(
        "driver_role_required"
      );
    }


    if (
      account.status !==
        "active"
    ) {

      return forbidden(
        "driver_account_blocked"
      );
    }


    const bundle =
      await createSessionBundle(
        env,
        account,
        now
      );


    try {

      await commitExistingFirebaseExchange(
        env,
        {
          firebaseUid:
            verified.uid,

          firebaseProjectId:
            verified.projectId,

          normalizedPhone:
            verified.phoneNumber,

          staffAccountId:
            account.id,

          authTime,

          installationId:
            parsed.installationId,

          tokenDigest,

          tokenExpiresAt,

          now,

          requestId,

          auditId:
            createRandomId(
              "audit"
            ),

          session:
            bundle.session
        }
      );

    } catch (
      error
    ) {

      if (
        await isFirebaseExchangeReplay(
          env,
          tokenDigest
        )
      ) {

        return conflict(
          "firebase_token_replay"
        );
      }


      throw error;
    }


    return {
      ok:
        true,

      created:
        false,

      staff:
        publicStaff(
          account
        ),

      registration: {
        status:
          identity.registrationStatus,

        identityStatus:
          identity.identityStatus
      },

      ...bundle.response
    };
  }


  let passwordSeed =
    createRandomPasswordSeed();


  const passwordVerifier =
    await hashStaffPassword(
      passwordSeed
    );


  passwordSeed =
    null;


  const account = {
    id:
      createRandomId(
        "staff"
      ),

    login:
      await createFirebaseLogin(
        verified.projectId,
        verified.uid
      ),

    displayName:
      "Водитель",

    role:
      "driver",

    status:
      "active",

    tokenVersion:
      1,

    passwordVerifier
  };


  const bundle =
    await createSessionBundle(
      env,
      account,
      now
    );


  try {

    await commitNewFirebaseExchange(
      env,
      {
        firebaseUid:
          verified.uid,

        firebaseProjectId:
          verified.projectId,

        normalizedPhone:
          verified.phoneNumber,

        authTime,

        installationId:
          parsed.installationId,

        tokenDigest,

        tokenExpiresAt,

        now,

        requestId,

        auditId:
          createRandomId(
            "audit"
          ),

        account,

        session:
          bundle.session
      }
    );

  } catch (
    error
  ) {

    if (
      await isFirebaseExchangeReplay(
        env,
        tokenDigest
      )
    ) {

      return conflict(
        "firebase_token_replay"
      );
    }


    return conflict(
      "firebase_identity_conflict"
    );
  }


  return {
    ok:
      true,

    created:
      true,

    staff:
      publicStaff(
        account
      ),

    registration: {
      status:
        "draft",

      identityStatus:
        "pending"
    },

    ...bundle.response
  };
}
