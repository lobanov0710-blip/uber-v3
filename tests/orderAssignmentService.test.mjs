import assert from "node:assert/strict";

import {
  assignOrderByAdmin,
  listDriverAssignments
} from "../src/core/orderAssignmentService.js";


const ORDER_ID =
  "order_12345678";

const DRIVER_ID =
  "staff_driver123";

const VEHICLE_ID =
  "vehicle_12345678";


function dbFor({
  permissions = [],
  registrationStatus = "approved",
  identityStatus = "verified",
  vehicleStatus = "approved",
  availabilityState = "off_line",
  activeVehicleId = null
} = {}) {

  return {
    prepare(sql) {

      return {
        sql,
        args: [],

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
            return null;
          }


          if (
            /FROM\s+orders\s+o/i.test(
              this.sql
            )
            &&
            /LEFT\s+JOIN\s+order_assignments/i.test(
              this.sql
            )
          ) {
            return {
              order_id:
                ORDER_ID,
              order_status:
                "new",
              order_driver_id:
                null,
              order_revision:
                1,
              order_updated_at:
                1800000000000,
              assignment_id:
                null,
              assignment_driver_id:
                null,
              assignment_vehicle_id:
                null,
              assignment_state:
                null,
              assignment_revision:
                null,
              assignment_created_at:
                null
            };
          }


          if (
            /FROM\s+driver_profiles\s+p/i.test(
              this.sql
            )
            &&
            /LEFT\s+JOIN\s+vehicles/i.test(
              this.sql
            )
          ) {
            return {
              staff_account_id:
                DRIVER_ID,
              registration_status:
                registrationStatus,
              identity_status:
                identityStatus,
              vehicle_id:
                VEHICLE_ID,
              vehicle_status:
                vehicleStatus,
              availability_state:
                availabilityState,
              active_vehicle_id:
                activeVehicleId
            };
          }


          throw new Error(
            "unexpected assignment service first query"
          );
        },

        async all() {

          if (
            /FROM\s+staff_permissions/i.test(
              this.sql
            )
          ) {
            return {
              success: true,
              results:
                permissions.map(
                  permission => ({
                    permission
                  })
                )
            };
          }


          if (
            /FROM\s+order_assignments\s+a/i.test(
              this.sql
            )
          ) {
            return {
              success: true,
              results: []
            };
          }


          throw new Error(
            "unexpected assignment service all query"
          );
        }
      };
    }
  };
}


const dispatcher = {
  id:
    "staff_dispatcher123",
  role:
    "admin"
};


const noPermission =
  await assignOrderByAdmin(
    {
      DB:
        dbFor()
    },
    dispatcher,
    ORDER_ID,
    {
      driverId:
        DRIVER_ID,
      vehicleId:
        VEHICLE_ID,
      reason:
        "Назначение",
      expectedRevision:
        1
    },
    {
      idempotencyKey:
        "assign-order-12345678"
    }
  );


assert.equal(
  noPermission.status,
  403
);


const unapproved =
  await assignOrderByAdmin(
    {
      DB:
        dbFor({
          permissions: [
            "orders.assign"
          ],
          registrationStatus:
            "under_review"
        })
    },
    dispatcher,
    ORDER_ID,
    {
      driverId:
        DRIVER_ID,
      vehicleId:
        VEHICLE_ID,
      reason:
        "Назначение",
      expectedRevision:
        1
    },
    {
      idempotencyKey:
        "assign-order-12345678"
    }
  );


assert.equal(
  unapproved.status,
  422
);

assert.equal(
  unapproved.code,
  "driver_not_approved"
);


const identityMissing =
  await assignOrderByAdmin(
    {
      DB:
        dbFor({
          permissions: [
            "orders.assign"
          ],
          identityStatus:
            "pending"
        })
    },
    dispatcher,
    ORDER_ID,
    {
      driverId:
        DRIVER_ID,
      vehicleId:
        VEHICLE_ID,
      reason:
        "Назначение",
      expectedRevision:
        1
    },
    {
      idempotencyKey:
        "assign-order-12345678"
    }
  );


assert.equal(
  identityMissing.code,
  "identity_verification_required"
);


const activeMismatch =
  await assignOrderByAdmin(
    {
      DB:
        dbFor({
          permissions: [
            "orders.assign"
          ],
          availabilityState:
            "on_line",
          activeVehicleId:
            "vehicle_other123"
        })
    },
    dispatcher,
    ORDER_ID,
    {
      driverId:
        DRIVER_ID,
      vehicleId:
        VEHICLE_ID,
      reason:
        "Назначение",
      expectedRevision:
        1
    },
    {
      idempotencyKey:
        "assign-order-12345678"
    }
  );


assert.equal(
  activeMismatch.status,
  409
);

assert.equal(
  activeMismatch.code,
  "active_vehicle_mismatch"
);


const missingIdempotency =
  await assignOrderByAdmin(
    {
      DB:
        dbFor({
          permissions: [
            "orders.assign"
          ]
        })
    },
    dispatcher,
    ORDER_ID,
    {
      driverId:
        DRIVER_ID,
      vehicleId:
        VEHICLE_ID,
      reason:
        "Назначение",
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


const driverAssignments =
  await listDriverAssignments(
    {
      DB:
        dbFor()
    },
    {
      id:
        DRIVER_ID,
      role:
        "driver"
    },
    {
      limit:
        20
    }
  );


assert.equal(
  driverAssignments.ok,
  true
);

assert.equal(
  driverAssignments.count,
  0
);


const adminCannotUseDriverFeed =
  await listDriverAssignments(
    {
      DB:
        dbFor()
    },
    dispatcher
  );


assert.equal(
  adminCannotUseDriverFeed.status,
  403
);


console.log(
  "✓ ORDER ASSIGNMENT SERVICE POLICY TESTS PASSED"
);
