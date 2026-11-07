import assert from "node:assert/strict";

import {
  completeAdminRegistrationReview,
  getAdminRegistrationReview,
  reviewAdminRegistrationItem
} from "../src/core/adminItemModerationService.js";


const OWNER_ID =
  "staff_owner123";

const DRIVER_ID =
  "staff_driver123";


function dbFor({
  owner = true,
  permissions = [],
  identityStatus = "pending",
  vehicleComplete = false,
  includeDocument = true
} = {}) {

  const profile = {
    staff_account_id:
      DRIVER_ID,
    full_name:
      "Иван Иванов",
    birth_date:
      "1990-05-20",
    region:
      "Нижегородская область",
    registration_status:
      "under_review",
    identity_status:
      identityStatus,
    revision:
      4,
    submitted_at:
      1800000000000,
    updated_at:
      1800000001000
  };

  const vehicle = {
    id:
      "vehicle_12345678-1234-4234-8234-123456789012",
    vin:
      "XTA210990Y1234567",
    plate:
      "A123AA52",
    make:
      "LADA",
    model:
      "Vesta",
    class:
      "comfort",
    capacity:
      4,
    baggage_capacity:
      "standard",
    usage_basis:
      "owner",
    status:
      "pending_review",
    revision:
      2,
    updated_at:
      1800000001000
  };

  const document = {
    id:
      "document_12345678-1234-4234-8234-123456789012",
    vehicle_id:
      null,
    kind:
      "passport_main",
    status:
      "pending",
    revision:
      1,
    updated_at:
      1800000001000
  };


  return {
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
            /FROM\s+driver_profiles/i.test(
              this.sql
            )
          ) {
            return {
              ...profile
            };
          }


          throw new Error(
            "unexpected policy first query"
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


          if (
            /FROM\s+vehicles/i.test(
              this.sql
            )
          ) {
            return {
              success:
                true,
              results: [
                {
                  ...vehicle,
                  status:
                    vehicleComplete
                      ? "approved"
                      : vehicle.status
                }
              ]
            };
          }


          if (
            /FROM\s+document_resources/i.test(
              this.sql
            )
          ) {
            return {
              success:
                true,
              results:
                includeDocument
                  ? [
                      {
                        ...document
                      }
                    ]
                  : []
            };
          }


          if (
            /FROM\s+vehicle_photos/i.test(
              this.sql
            )
          ) {
            return {
              success:
                true,
              results:
                []
            };
          }


          if (
            /FROM\s+moderation_reviews/i.test(
              this.sql
            )
          ) {
            return {
              success:
                true,
              results:
                []
            };
          }


          throw new Error(
            "unexpected policy all query"
          );
        }
      };
    }
  };
}


const ownerUser = {
  id:
    OWNER_ID,
  role:
    "admin"
};


const manualIdentityVerify =
  await reviewAdminRegistrationItem(
    {
      DB:
        dbFor()
    },
    ownerUser,
    DRIVER_ID,
    "identity",
    DRIVER_ID,
    {
      decision:
        "verified",
      expectedRevision:
        4
    },
    {
      idempotencyKey:
        "identity-review-12345678"
    }
  );


assert.equal(
  manualIdentityVerify.status,
  409
);

assert.equal(
  manualIdentityVerify.code,
  "identity_verification_provider_not_approved"
);


const dispatcherReadOnly = {
  id:
    "staff_dispatcher123",
  role:
    "admin"
};


const deniedDocumentReview =
  await reviewAdminRegistrationItem(
    {
      DB:
        dbFor({
          owner:
            false,
          permissions: [
            "drivers.read"
          ]
        })
    },
    dispatcherReadOnly,
    DRIVER_ID,
    "document",
    "document_12345678-1234-4234-8234-123456789012",
    {
      decision:
        "verified",
      expectedRevision:
        1
    },
    {
      idempotencyKey:
        "document-review-12345678"
    }
  );


assert.equal(
  deniedDocumentReview.status,
  403
);


const missingIdempotency =
  await reviewAdminRegistrationItem(
    {
      DB:
        dbFor()
    },
    ownerUser,
    DRIVER_ID,
    "document",
    "document_12345678-1234-4234-8234-123456789012",
    {
      decision:
        "verified",
      expectedRevision:
        1
    },
    {}
  );


assert.equal(
  missingIdempotency.status,
  400
);

assert.equal(
  missingIdempotency.code,
  "idempotency_key_required"
);


const finalApprovalWithoutIdentity =
  await completeAdminRegistrationReview(
    {
      DB:
        dbFor({
          identityStatus:
            "pending",
          vehicleComplete:
            true
        })
    },
    ownerUser,
    DRIVER_ID,
    {
      decision:
        "approved",
      expectedRevision:
        4
    },
    {
      idempotencyKey:
        "final-review-12345678"
    }
  );


assert.equal(
  finalApprovalWithoutIdentity.status,
  409
);

assert.equal(
  finalApprovalWithoutIdentity.code,
  "identity_verification_required"
);


const readOnlyDetail =
  await getAdminRegistrationReview(
    {
      DB:
        dbFor({
          owner:
            false,
          permissions: [
            "drivers.read"
          ]
        })
    },
    dispatcherReadOnly,
    DRIVER_ID
  );


assert.equal(
  readOnlyDetail.status,
  403,
  "queue readers must not automatically get sensitive review detail"
);


console.log(
  "✓ ADMIN ITEM MODERATION POLICY TESTS PASSED"
);
