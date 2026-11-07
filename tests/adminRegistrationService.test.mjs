import assert from "node:assert/strict";

import {
  beginAdminRegistrationReview,
  getAdminRegistrationQueue
} from "../src/core/adminRegistrationService.js";


function createDb({
  ownerAccountId = null,
  permissions = {}
} = {}) {

  const registrations = [
    {
      staff_account_id:
        "staff_driver123",
      full_name:
        "Иван Иванов",
      region:
        "Нижегородская область",
      registration_status:
        "submitted",
      identity_status:
        "pending",
      revision:
        3,
      submitted_at:
        1800000000000,
      updated_at:
        1800000000000
    }
  ];


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
              ownerAccountId
              &&
              this.args[0] ===
                ownerAccountId
            )
              ? {
                  account_id:
                    ownerAccountId
                }
              : null;
          }


          throw new Error(
            "unexpected first query"
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
                (
                  permissions[
                    this.args[0]
                  ] ||
                  []
                )
                  .map(
                    permission => ({
                      permission
                    })
                  )
            };
          }


          if (
            /FROM\s+driver_profiles/i.test(
              this.sql
            )
          ) {

            return {
              success:
                true,

              results:
                registrations.map(
                  row => ({
                    ...row
                  })
                )
            };
          }


          throw new Error(
            "unexpected all query"
          );
        }
      };
    },

    async batch(statements) {

      return statements.map(
        statement => {

          if (
            /UPDATE\s+driver_profiles/i.test(
              statement.sql
            )
          ) {

            const [
              driverId,
              expectedRevision,
              reviewedAt
            ] =
              statement.args;


            const row =
              registrations.find(
                item =>
                  item.staff_account_id ===
                    driverId
              );


            if (
              !row
              ||
              row.registration_status !==
                "submitted"
              ||
              row.revision !==
                expectedRevision
            ) {

              return {
                success:
                  true,

                meta: {
                  changes:
                    0
                }
              };
            }


            row.registration_status =
              "under_review";

            row.revision +=
              1;

            row.updated_at =
              reviewedAt;


            return {
              success:
                true,

              meta: {
                changes:
                  1
              }
            };
          }


          if (
            /INSERT\s+INTO\s+moderation_reviews/i.test(
              statement.sql
            )
          ) {

            return {
              success:
                true,

              meta: {
                changes:
                  1
              }
            };
          }


          if (
            /INSERT\s+INTO\s+audit_events/i.test(
              statement.sql
            )
          ) {

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
            "unexpected batch statement"
          );
        }
      );
    }
  };
}


const ownerUser = {
  id:
    "staff_owner123",
  role:
    "admin"
};

const dispatcherReadOnly = {
  id:
    "staff_dispatcher123",
  role:
    "admin"
};

const dispatcherReviewer = {
  id:
    "staff_reviewer123",
  role:
    "admin"
};


const ownerDb =
  createDb({
    ownerAccountId:
      ownerUser.id
  });


const ownerQueue =
  await getAdminRegistrationQueue(
    {
      DB:
        ownerDb
    },
    ownerUser,
    {}
  );


assert.equal(
  ownerQueue.ok,
  true
);

assert.equal(
  ownerQueue.count,
  1
);


const readOnlyDb =
  createDb({
    permissions: {
      [dispatcherReadOnly.id]: [
        "drivers.read"
      ]
    }
  });


const readOnlyQueue =
  await getAdminRegistrationQueue(
    {
      DB:
        readOnlyDb
    },
    dispatcherReadOnly,
    {}
  );


assert.equal(
  readOnlyQueue.ok,
  true
);


const readOnlyReview =
  await beginAdminRegistrationReview(
    {
      DB:
        readOnlyDb
    },
    dispatcherReadOnly,
    "staff_driver123",
    {
      expectedRevision:
        3
    },
    {
      nowMs:
        1800000001000,
      requestId:
        "req_readonly"
    }
  );


assert.equal(
  readOnlyReview.status,
  403
);


const reviewerDb =
  createDb({
    permissions: {
      [dispatcherReviewer.id]: [
        "drivers.read",
        "drivers.verify_documents"
      ]
    }
  });


const reviewerReview =
  await beginAdminRegistrationReview(
    {
      DB:
        reviewerDb
    },
    dispatcherReviewer,
    "staff_driver123",
    {
      expectedRevision:
        3
    },
    {
      nowMs:
        1800000002000,
      requestId:
        "req_reviewer"
    }
  );


assert.equal(
  reviewerReview.ok,
  true
);

assert.equal(
  reviewerReview.registration.status,
  "under_review"
);

assert.equal(
  reviewerReview.registration.revision,
  4
);


const invalidStatus =
  await getAdminRegistrationQueue(
    {
      DB:
        readOnlyDb
    },
    dispatcherReadOnly,
    {
      status:
        "approved"
    }
  );


assert.equal(
  invalidStatus.status,
  400
);


const injectedField =
  await beginAdminRegistrationReview(
    {
      DB:
        ownerDb
    },
    ownerUser,
    "staff_driver123",
    {
      expectedRevision:
        3,
      decision:
        "approved"
    },
    {
      nowMs:
        1800000003000
    }
  );


assert.equal(
  injectedField.status,
  400
);


console.log(
  "✓ ADMIN REGISTRATION MODERATION SERVICE TESTS PASSED"
);
