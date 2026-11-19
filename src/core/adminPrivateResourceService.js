// =========================================
// ADMIN PRIVATE RESOURCE SERVICE
// =========================================
//
// Private documents/photos never receive a
// permanent public URL. Access requires the
// relevant authoritative admin permission
// and every successful read is audited.
// =========================================

import {
  adminCan,
  resolveAdminAccess
} from "./adminAuthorization.js";

import {
  auditAdminPrivateResourceRead,
  getAdminPrivateResourceMetadata
} from "./adminPrivateResourceRepository.js";


const IDENTITY_DOCUMENT_KINDS =
  new Set([
    "passport_selfie",
    "identity_reference_selfie"
  ]);


function clean(value) {
  return String(value ?? "")
    .trim();
}


function forbidden(code = "permission_required") {
  return {
    ok: false,
    status: 403,
    error: "forbidden",
    code
  };
}


function notFound(code = "private_resource_not_found") {
  return {
    ok: false,
    status: 404,
    error: "not found",
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


export async function readAdminPrivateResource(
  env,
  user,
  {
    driverId,
    resourceType,
    resourceId
  },
  options = {}
) {
  const access =
    await resolveAdminAccess(
      env,
      user
    );


  if (
    access?.ok !== true
  ) {
    return forbidden(
      access?.code ||
      "admin_role_required"
    );
  }


  const type =
    clean(
      resourceType
    )
      .toLowerCase();


  if (
    ![
      "document",
      "vehicle_photo"
    ].includes(
      type
    )
  ) {
    return notFound();
  }


  const preliminaryAllowed =
    access.isOwner === true
    ||
    (
      type === "document"
      &&
      (
        adminCan(
          access,
          "drivers.verify_documents"
        )
        ||
        adminCan(
          access,
          "drivers.verify_identity"
        )
      )
    )
    ||
    (
      type === "vehicle_photo"
      &&
      adminCan(
        access,
        "vehicles.verify"
      )
    );


  if (!preliminaryAllowed) {
    return forbidden();
  }


  const metadata =
    await getAdminPrivateResourceMetadata(
      env,
      {
        driverId:
          clean(
            driverId
          ),

        resourceType:
          type,

        resourceId:
          clean(
            resourceId
          )
      }
    );


  if (!metadata) {
    return notFound();
  }


  if (
    !access.isOwner
    &&
    type === "document"
  ) {

    const requiredPermission =
      IDENTITY_DOCUMENT_KINDS.has(
        metadata.kind
      )
        ? "drivers.verify_identity"
        : "drivers.verify_documents";


    if (
      !adminCan(
        access,
        requiredPermission
      )
    ) {
      return forbidden();
    }
  }


  const bucket =
    env?.DRIVER_PRIVATE_FILES;


  if (
    !bucket
    ||
    typeof bucket.get !==
      "function"
  ) {
    return unavailable(
      "driver_private_storage_not_configured"
    );
  }


  const object =
    await bucket.get(
      metadata.privateObjectKey
    );


  if (!object) {
    return unavailable(
      "private_resource_object_missing"
    );
  }


  const readAt =
    Number.isSafeInteger(
      options.nowMs
    )
      ? options.nowMs
      : Date.now();


  await auditAdminPrivateResourceRead(
    env,
    {
      actorAccountId:
        access.accountId,

      resourceType:
        type,

      resourceId:
        metadata.id,

      requestId:
        clean(
          options.requestId
        ),

      readAt
    }
  );


  const contentType =
    clean(
      object?.httpMetadata
        ?.contentType
    )
      .toLowerCase()
    ||
    "application/octet-stream";


  return {
    ok: true,

    resource: {
      id:
        metadata.id,

      type,

      kind:
        metadata.kind,

      contentType,

      body:
        object.body
    }
  };
}
