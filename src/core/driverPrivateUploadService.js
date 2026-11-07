// =========================================
// DRIVER PRIVATE UPLOAD / SUBMISSION SERVICE
// =========================================

import {
  getDriverProfile,
  getDriverVehicle,
  listDriverVehicles
} from "./driverRegistrationRepository.js";

import {
  claimDriverUploadSession,
  finalizeDriverUploadResource,
  getDriverRegistrationMaterials,
  getDriverUploadSession,
  insertDriverUploadSession,
  releaseDriverUploadClaim,
  submitDriverRegistration
} from "./driverPrivateUploadRepository.js";


const DRIVER_DOCUMENT_KINDS =
  new Set([
    "passport_main",
    "passport_registration",
    "passport_selfie",
    "identity_reference_selfie",
    "driver_license_front",
    "driver_license_back"
  ]);

const VEHICLE_DOCUMENT_KINDS =
  new Set([
    "sts_front",
    "sts_back",
    "rental_contract",
    "osago",
    "taxi_permit",
    "diagnostic_card",
    "other"
  ]);

const REQUIRED_DRIVER_DOCUMENTS = [
  "passport_main",
  "passport_registration",
  "passport_selfie",
  "identity_reference_selfie",
  "driver_license_front",
  "driver_license_back"
];

const REQUIRED_VEHICLE_PHOTOS = [
  "left",
  "front",
  "right",
  "rear",
  "open_trunk",
  "rear_cabin",
  "front_cabin"
];

const VEHICLE_PHOTO_KINDS =
  new Set(
    REQUIRED_VEHICLE_PHOTOS
  );

const IMAGE_CONTENT_TYPES =
  new Set([
    "image/jpeg",
    "image/png",
    "image/webp"
  ]);

const DOCUMENT_CONTENT_TYPES =
  new Set([
    ...IMAGE_CONTENT_TYPES,
    "application/pdf"
  ]);

const UPLOAD_INPUT_KEYS =
  new Set([
    "resourceType",
    "kind",
    "vehicleId",
    "contentType",
    "contentLength"
  ]);

const SUBMIT_INPUT_KEYS =
  new Set([
    "expectedRevision"
  ]);

const UPLOAD_TTL_MS =
  10 * 60 * 1000;


function clean(value) {
  return String(value ?? "").trim();
}

function invalid(code = "invalid_request") {
  return {
    ok: false,
    status: 400,
    error: "invalid request",
    code
  };
}

function forbidden(code = "forbidden") {
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

function conflict(code, details = null) {
  return {
    ok: false,
    status: 409,
    error: "conflict",
    code,
    ...(details ? { details } : {})
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
    clean(user.id) === "" ||
    clean(user.role).toLowerCase() !== "driver"
  ) {
    return null;
  }

  return {
    id: clean(user.id)
  };
}

function onlyKeys(input, allowed) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input)
  ) {
    return false;
  }

  return Object.keys(input)
    .every(key => allowed.has(key));
}

function createId(prefix) {
  if (!globalThis.crypto?.randomUUID) {
    throw new Error(
      "secure random UUID unavailable"
    );
  }

  return `${prefix}_${crypto.randomUUID()}`;
}

function requireUploadLimit(env) {
  const value =
    Number(
      env?.DRIVER_UPLOAD_MAX_BYTES
    );

  if (
    !Number.isSafeInteger(value) ||
    value <= 0
  ) {
    return null;
  }

  return value;
}

function normalizeContentType(value) {
  return clean(value)
    .toLowerCase()
    .split(";")[0]
    .trim();
}

function isAcceptedMaterialStatus(status) {
  return (
    status === "pending" ||
    status === "verified"
  );
}

function activeMaterialKinds(
  materials,
  predicate = () => true
) {
  const kinds =
    new Set();

  for (const material of materials) {
    if (
      predicate(material) &&
      isAcceptedMaterialStatus(
        clean(material.status)
          .toLowerCase()
      )
    ) {
      kinds.add(
        clean(material.kind)
          .toLowerCase()
      );
    }
  }

  return kinds;
}

function missingKinds(required, present) {
  return required
    .filter(
      kind =>
        !present.has(kind)
    );
}


export async function issueDriverPrivateUpload(
  env,
  user,
  input,
  options = {}
) {
  const driver =
    requireDriver(user);

  if (!driver) {
    return forbidden(
      "driver_role_required"
    );
  }

  if (
    !onlyKeys(
      input,
      UPLOAD_INPUT_KEYS
    )
  ) {
    return invalid();
  }

  const resourceType =
    clean(input.resourceType)
      .toLowerCase();

  const kind =
    clean(input.kind)
      .toLowerCase();

  const vehicleId =
    input.vehicleId == null
      ? null
      : clean(input.vehicleId);

  const contentType =
    normalizeContentType(
      input.contentType
    );

  const contentLength =
    Number(
      input.contentLength
    );

  const maxBytes =
    requireUploadLimit(env);

  if (!maxBytes) {
    return unavailable(
      "driver_upload_limit_not_configured"
    );
  }

  if (
    !Number.isSafeInteger(
      contentLength
    ) ||
    contentLength <= 0 ||
    contentLength > maxBytes
  ) {
    return invalid(
      "invalid_upload_size"
    );
  }

  let allowedContentTypes;

  if (
    resourceType === "document"
  ) {
    if (
      !DRIVER_DOCUMENT_KINDS.has(kind) &&
      !VEHICLE_DOCUMENT_KINDS.has(kind)
    ) {
      return invalid(
        "invalid_document_kind"
      );
    }

    allowedContentTypes =
      (
        kind === "passport_selfie" ||
        kind === "identity_reference_selfie"
      )
        ? IMAGE_CONTENT_TYPES
        : DOCUMENT_CONTENT_TYPES;

  } else if (
    resourceType ===
      "vehicle_photo"
  ) {

    if (
      !VEHICLE_PHOTO_KINDS.has(
        kind
      )
    ) {
      return invalid(
        "invalid_vehicle_photo_kind"
      );
    }

    allowedContentTypes =
      IMAGE_CONTENT_TYPES;

  } else {

    return invalid(
      "invalid_resource_type"
    );
  }

  if (
    !allowedContentTypes.has(
      contentType
    )
  ) {
    return invalid(
      "invalid_content_type"
    );
  }

  const vehicleScoped =
    resourceType ===
      "vehicle_photo"
    ||
    VEHICLE_DOCUMENT_KINDS.has(
      kind
    );

  if (
    vehicleScoped &&
    !vehicleId
  ) {
    return invalid(
      "vehicle_required"
    );
  }

  if (
    !vehicleScoped &&
    vehicleId
  ) {
    return invalid(
      "vehicle_not_allowed"
    );
  }

  if (vehicleId) {
    const vehicle =
      await getDriverVehicle(
        env,
        driver.id,
        vehicleId
      );

    if (!vehicle) {
      return notFound(
        "vehicle_not_found"
      );
    }

    if (
      vehicle.status === "rejected" ||
      vehicle.status === "suspended"
    ) {
      return conflict(
        "vehicle_not_editable"
      );
    }
  }

  const now =
    Number.isSafeInteger(
      options.nowMs
    )
      ? options.nowMs
      : Date.now();

  const uploadId =
    createId(
      "upload"
    );

  const privateObjectKey =
    [
      "drivers",
      driver.id,
      "uploads",
      uploadId,
      resourceType,
      kind
    ].join("/");

  const upload =
    await insertDriverUploadSession(
      env,
      {
        id:
          uploadId,

        driverId:
          driver.id,

        vehicleId,

        resourceType,

        kind,

        privateObjectKey,

        contentType,

        expectedBytes:
          contentLength,

        createdAt:
          now,

        expiresAt:
          now +
          UPLOAD_TTL_MS
      }
    );

  return {
    ok: true,

    upload: {
      id:
        upload.id,

      method:
        "PUT",

      path:
        `/v1/driver/uploads/${upload.id}`,

      contentType:
        upload.contentType,

      contentLength:
        upload.expectedBytes,

      expiresAt:
        upload.expiresAt
    }
  };
}


export async function completeDriverPrivateUpload(
  env,
  user,
  uploadId,
  {
    contentType,
    bodyBytes,
    requestId
  },
  options = {}
) {
  const driver =
    requireDriver(user);

  if (!driver) {
    return forbidden(
      "driver_role_required"
    );
  }

  const bucket =
    env?.DRIVER_PRIVATE_FILES;

  if (
    !bucket ||
    typeof bucket.put !==
      "function"
  ) {
    return unavailable(
      "driver_private_storage_not_configured"
    );
  }

  const upload =
    await getDriverUploadSession(
      env,
      driver.id,
      uploadId
    );

  if (!upload) {
    return notFound(
      "upload_not_found"
    );
  }

  const now =
    Number.isSafeInteger(
      options.nowMs
    )
      ? options.nowMs
      : Date.now();

  if (
    upload.consumedAt !== null
  ) {
    return conflict(
      "upload_already_consumed"
    );
  }

  if (
    upload.expiresAt <
      now
  ) {
    return conflict(
      "upload_expired"
    );
  }

  const normalizedType =
    normalizeContentType(
      contentType
    );

  if (
    normalizedType !==
      upload.contentType
  ) {
    return invalid(
      "upload_content_type_mismatch"
    );
  }

  if (
    !(bodyBytes instanceof ArrayBuffer)
  ) {
    return invalid(
      "invalid_upload_body"
    );
  }

  if (
    bodyBytes.byteLength !==
      upload.expectedBytes
  ) {
    return invalid(
      "upload_size_mismatch"
    );
  }

  const claimId =
    createId(
      "upload-claim"
    );

  const claim =
    await claimDriverUploadSession(
      env,
      driver.id,
      upload.id,
      {
        claimId,
        claimedAt:
          now
      }
    );

  if (!claim.claimed) {

    if (
      claim.upload?.consumedAt !==
        null
      &&
      claim.upload?.consumedAt !==
        undefined
    ) {
      return conflict(
        "upload_already_consumed"
      );
    }

    if (
      claim.upload?.expiresAt <
        now
    ) {
      return conflict(
        "upload_expired"
      );
    }

    return conflict(
      "upload_in_progress"
    );
  }

  const claimedUpload =
    claim.upload;

  const resourceId =
    createId(
      claimedUpload.resourceType ===
        "document"
        ? "document"
        : "vehicle-photo"
    );

  let objectWritten =
    false;

  try {

    await bucket.put(
      claimedUpload.privateObjectKey,
      bodyBytes,
      {
        httpMetadata: {
          contentType:
            claimedUpload.contentType
        },

        customMetadata: {
          owner:
            driver.id,

          upload:
            claimedUpload.id,

          resource:
            resourceId,

          kind:
            claimedUpload.kind
        }
      }
    );

    objectWritten =
      true;

    const finalized =
      await finalizeDriverUploadResource(
        env,
        claimedUpload,
        {
          claimId,
          resourceId,
          consumedAt:
            now,
          requestId:
            clean(
              requestId
            )
        }
      );

    if (
      finalized.finalized !==
        true
    ) {
      throw new Error(
        "private upload finalization conflict"
      );
    }

  } catch (error) {

    if (
      objectWritten &&
      typeof bucket.delete ===
        "function"
    ) {
      try {
        await bucket.delete(
          claimedUpload.privateObjectKey
        );
      } catch {
        // Best-effort object compensation.
      }
    }

    try {
      await releaseDriverUploadClaim(
        env,
        driver.id,
        claimedUpload.id,
        claimId
      );
    } catch {
      // Best-effort claim compensation.
    }

    throw error;
  }

  return {
    ok: true,

    resource: {
      id:
        resourceId,

      type:
        claimedUpload.resourceType,

      kind:
        claimedUpload.kind,

      vehicleId:
        claimedUpload.vehicleId,

      status:
        "pending"
    }
  };
}

export async function submitDriverRegistrationForReview(
  env,
  user,
  input,
  options = {}
) {
  const driver =
    requireDriver(user);

  if (!driver) {
    return forbidden(
      "driver_role_required"
    );
  }

  if (
    !onlyKeys(
      input,
      SUBMIT_INPUT_KEYS
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

  const profile =
    await getDriverProfile(
      env,
      driver.id
    );

  if (!profile) {
    return conflict(
      "driver_profile_missing"
    );
  }

  if (
    profile.revision !==
      expectedRevision
  ) {
    return conflict(
      "revision_conflict"
    );
  }

  if (
    ![
      "draft",
      "changes_required"
    ].includes(
      profile.registrationStatus
    )
  ) {
    return conflict(
      "registration_not_submittable"
    );
  }

  const missingProfile = [];

  if (!clean(profile.fullName)) {
    missingProfile.push(
      "fullName"
    );
  }

  if (!clean(profile.birthDate)) {
    missingProfile.push(
      "birthDate"
    );
  }

  if (!clean(profile.region)) {
    missingProfile.push(
      "region"
    );
  }

  const vehicles =
    await listDriverVehicles(
      env,
      driver.id
    );

  const materials =
    await getDriverRegistrationMaterials(
      env,
      driver.id
    );

  const driverDocuments =
    activeMaterialKinds(
      materials.documents,
      material =>
        material.vehicleId === null
    );

  const missingDriverDocuments =
    missingKinds(
      REQUIRED_DRIVER_DOCUMENTS,
      driverDocuments
    );

  const completeVehicleIds = [];

  const vehicleDetails = [];

  for (const vehicle of vehicles) {
    const documentKinds =
      activeMaterialKinds(
        materials.documents,
        material =>
          material.vehicleId ===
            vehicle.id
      );

    const photoKinds =
      activeMaterialKinds(
        materials.photos,
        material =>
          material.vehicleId ===
            vehicle.id
      );

    const requiredDocuments = [
      "sts_front",
      "sts_back"
    ];

    if (
      vehicle.usageBasis ===
        "rental"
    ) {
      requiredDocuments.push(
        "rental_contract"
      );
    }

    const missingDocuments =
      missingKinds(
        requiredDocuments,
        documentKinds
      );

    const missingPhotos =
      missingKinds(
        REQUIRED_VEHICLE_PHOTOS,
        photoKinds
      );

    const complete =
      Boolean(
        vehicle.usageBasis
      )
      &&
      missingDocuments.length ===
        0
      &&
      missingPhotos.length ===
        0;

    if (complete) {
      completeVehicleIds.push(
        vehicle.id
      );
    }

    vehicleDetails.push({
      vehicleId:
        vehicle.id,

      complete,

      missingUsageBasis:
        !vehicle.usageBasis,

      missingDocuments,

      missingPhotos
    });
  }

  if (
    missingProfile.length > 0 ||
    missingDriverDocuments.length > 0 ||
    completeVehicleIds.length === 0
  ) {
    return conflict(
      "registration_incomplete",
      {
        missingProfile,
        missingDriverDocuments,
        vehicles:
          vehicleDetails
      }
    );
  }

  const now =
    Number.isSafeInteger(
      options.nowMs
    )
      ? options.nowMs
      : Date.now();

  const result =
    await submitDriverRegistration(
      env,
      driver.id,
      {
        expectedRevision,
        submittedAt:
          now,
        vehicleIds:
          completeVehicleIds,
        requestId:
          clean(
            options.requestId
          )
      }
    );

  if (!result.submitted) {
    return conflict(
      "revision_conflict"
    );
  }

  return {
    ok: true,

    registration: {
      status:
        "submitted",

      submittedAt:
        now,

      vehicleIds:
        completeVehicleIds
    }
  };
}
