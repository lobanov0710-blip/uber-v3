import assert from "node:assert/strict";

import {
  readAdminPrivateResource
} from "../src/core/adminPrivateResourceService.js";


const DRIVER_ID =
  "staff_driver123";

const OWNER_ID =
  "staff_owner123";


function createDb({
  owner = false,
  permissions = [],
  resource = null
} = {}) {

  const audits = [];


  return {
    audits,

    prepare(sql) {

      return {
        sql,
        args:
          [],

        bind(...args) {
          this.args =
            args;
          return this;
        },

        async first() {

          if (
            /FROM\s+staff_owner_binding/i.test(
              this.sql
            )
          ) {

            return (
              owner &&
              this.args[0] ===
                OWNER_ID
            )
              ? {
                  account_id:
                    OWNER_ID
                }
              : null;
          }


          if (
            /FROM\s+document_resources/i.test(
              this.sql
            )
          ) {

            if (
              !resource ||
              resource.type !==
                "document" ||
              this.args[0] !==
                resource.id ||
              this.args[1] !==
                DRIVER_ID
            ) {
              return null;
            }


            return {
              id:
                resource.id,
              owner_driver_id:
                DRIVER_ID,
              vehicle_id:
                resource.vehicleId ??
                null,
              kind:
                resource.kind,
              status:
                resource.status ??
                "pending",
              private_object_key:
                resource.privateObjectKey
            };
          }


          if (
            /FROM\s+vehicle_photos/i.test(
              this.sql
            )
          ) {

            if (
              !resource ||
              resource.type !==
                "vehicle_photo" ||
              this.args[0] !==
                resource.id ||
              this.args[1] !==
                DRIVER_ID
            ) {
              return null;
            }


            return {
              id:
                resource.id,
              owner_driver_id:
                DRIVER_ID,
              vehicle_id:
                resource.vehicleId,
              kind:
                resource.kind,
              status:
                resource.status ??
                "pending",
              private_object_key:
                resource.privateObjectKey
            };
          }


          throw new Error(
            "unexpected private resource first query"
          );
        },

        async all() {

          if (
            /FROM\s+staff_permissions/i.test(
              this.sql
            )
          ) {

            return {
              success:
                true,
              results:
                permissions.map(
                  permission => ({
                    permission
                  })
                )
            };
          }


          throw new Error(
            "unexpected private resource all query"
          );
        },

        async run() {

          if (
            /INSERT\s+INTO\s+audit_events/i.test(
              this.sql
            )
          ) {

            audits.push({
              targetType:
                this.args[2],
              targetId:
                this.args[3]
            });


            return {
              success:
                true,
              meta: {
                changes:
                  1
              }
            };
          }


          throw new Error(
            "unexpected private resource run"
          );
        }
      };
    }
  };
}


function bucketFor(
  expectedKey
) {

  return {
    async get(key) {

      if (
        key !==
          expectedKey
      ) {
        return null;
      }


      return {
        body:
          new Uint8Array([
            1,
            2,
            3
          ]),

        httpMetadata: {
          contentType:
            "image/jpeg"
        }
      };
    }
  };
}


const passport = {
  type:
    "document",
  id:
    "document_12345678",
  kind:
    "passport_main",
  privateObjectKey:
    "drivers/private/passport"
};


const ownerDb =
  createDb({
    owner:
      true,
    resource:
      passport
  });


const ownerRead =
  await readAdminPrivateResource(
    {
      DB:
        ownerDb,
      DRIVER_PRIVATE_FILES:
        bucketFor(
          passport.privateObjectKey
        )
    },
    {
      id:
        OWNER_ID,
      role:
        "admin"
    },
    {
      driverId:
        DRIVER_ID,
      resourceType:
        "document",
      resourceId:
        passport.id
    },
    {
      nowMs:
        1800000000000,
      requestId:
        "req_owner_read"
    }
  );


assert.equal(
  ownerRead.ok,
  true
);

assert.equal(
  ownerRead.resource.kind,
  "passport_main"
);

assert.equal(
  Object.hasOwn(
    ownerRead.resource,
    "privateObjectKey"
  ),
  false,
  "private object key must not leave service"
);

assert.equal(
  ownerDb.audits.length,
  1
);


const documentReviewer = {
  id:
    "staff_docreview123",
  role:
    "admin"
};


const docDb =
  createDb({
    permissions: [
      "drivers.verify_documents"
    ],
    resource:
      passport
  });


const docRead =
  await readAdminPrivateResource(
    {
      DB:
        docDb,
      DRIVER_PRIVATE_FILES:
        bucketFor(
          passport.privateObjectKey
        )
    },
    documentReviewer,
    {
      driverId:
        DRIVER_ID,
      resourceType:
        "document",
      resourceId:
        passport.id
    }
  );


assert.equal(
  docRead.ok,
  true
);


const identitySelfie = {
  type:
    "document",
  id:
    "document_identity123",
  kind:
    "identity_reference_selfie",
  privateObjectKey:
    "drivers/private/identity"
};


const docsOnlyIdentityDb =
  createDb({
    permissions: [
      "drivers.verify_documents"
    ],
    resource:
      identitySelfie
  });


const docsOnlyIdentityRead =
  await readAdminPrivateResource(
    {
      DB:
        docsOnlyIdentityDb,
      DRIVER_PRIVATE_FILES:
        bucketFor(
          identitySelfie.privateObjectKey
        )
    },
    documentReviewer,
    {
      driverId:
        DRIVER_ID,
      resourceType:
        "document",
      resourceId:
        identitySelfie.id
    }
  );


assert.equal(
  docsOnlyIdentityRead.status,
  403,
  "document permission must not expose identity selfie"
);


const identityReviewer = {
  id:
    "staff_identityreview123",
  role:
    "admin"
};


const identityDb =
  createDb({
    permissions: [
      "drivers.verify_identity"
    ],
    resource:
      identitySelfie
  });


const identityRead =
  await readAdminPrivateResource(
    {
      DB:
        identityDb,
      DRIVER_PRIVATE_FILES:
        bucketFor(
          identitySelfie.privateObjectKey
        )
    },
    identityReviewer,
    {
      driverId:
        DRIVER_ID,
      resourceType:
        "document",
      resourceId:
        identitySelfie.id
    }
  );


assert.equal(
  identityRead.ok,
  true
);


const photo = {
  type:
    "vehicle_photo",
  id:
    "vehicle-photo_12345678",
  vehicleId:
    "vehicle_12345678",
  kind:
    "front",
  privateObjectKey:
    "drivers/private/vehicle/front"
};


const vehicleReviewer = {
  id:
    "staff_vehiclereview123",
  role:
    "admin"
};


const photoDb =
  createDb({
    permissions: [
      "vehicles.verify"
    ],
    resource:
      photo
  });


const photoRead =
  await readAdminPrivateResource(
    {
      DB:
        photoDb,
      DRIVER_PRIVATE_FILES:
        bucketFor(
          photo.privateObjectKey
        )
    },
    vehicleReviewer,
    {
      driverId:
        DRIVER_ID,
      resourceType:
        "vehicle_photo",
      resourceId:
        photo.id
    }
  );


assert.equal(
  photoRead.ok,
  true
);


const noBucket =
  await readAdminPrivateResource(
    {
      DB:
        ownerDb
    },
    {
      id:
        OWNER_ID,
      role:
        "admin"
    },
    {
      driverId:
        DRIVER_ID,
      resourceType:
        "document",
      resourceId:
        passport.id
    }
  );


assert.equal(
  noBucket.status,
  503
);

assert.equal(
  noBucket.code,
  "driver_private_storage_not_configured"
);


console.log(
  "✓ ADMIN PRIVATE RESOURCE TESTS PASSED"
);
