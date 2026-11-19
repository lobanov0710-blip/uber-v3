import assert from "node:assert/strict";

import {
  putDriverAvailability
} from "../src/core/driverAvailabilityService.js";


const DRIVER_ID =
  "staff_driver123";

const VEHICLE_ID =
  "vehicle_12345678";


function dbFor({
  registrationStatus = "approved",
  identityStatus = "verified",
  state = "off_line",
  activeVehicleId = null,
  revision = 2,
  vehicleStatus = "approved",
  vehicleExists = true,
  photoControlBlocked = false,
  photoControlGrace = false
} = {}) {

  return {
    prepare(sql) {

      return {
        sql,
        args: [],

        bind(...args) {
          this.args = args;
          return this;
        },

        async first() {

          if (
            /FROM\s+driver_profiles\s+p/i.test(
              this.sql
            )
            &&
            /driver_availability/i.test(
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
              active_vehicle_id:
                activeVehicleId,
              state,
              revision,
              updated_at:
                1800000000000
            };
          }


          if (
            /FROM\s+vehicles/i.test(
              this.sql
            )
            &&
            /driver_id\s*=\s*\?2/i.test(
              this.sql
            )
          ) {
            if (!vehicleExists) {
              return null;
            }

            return {
              id:
                VEHICLE_ID,
              driver_id:
                DRIVER_ID,
              status:
                vehicleStatus,
              photo_control_blocked:
                photoControlBlocked ? 1 : 0,
              photo_control_grace:
                photoControlGrace ? 1 : 0
            };
          }


          if (
            /FROM\s+mutation_idempotency/i.test(
              this.sql
            )
          ) {
            return null;
          }


          throw new Error(
            "unexpected availability first query"
          );
        }
      };
    },

    async batch(statements) {
      return statements.map(
        () => ({
          success: true,
          meta: {
            changes: 1
          }
        })
      );
    }
  };
}


const driver = {
  id:
    DRIVER_ID,
  role:
    "driver"
};


const invalidOnline =
  await putDriverAvailability(
    {
      DB:
        dbFor()
    },
    driver,
    {
      activeVehicleId:
        null,
      requestedState:
        "on_line",
      expectedRevision:
        2
    },
    {
      idempotencyKey:
        "availability-12345678"
    }
  );


assert.equal(
  invalidOnline.status,
  400
);


const unapprovedDriver =
  await putDriverAvailability(
    {
      DB:
        dbFor({
          registrationStatus:
            "under_review"
        })
    },
    driver,
    {
      activeVehicleId:
        VEHICLE_ID,
      requestedState:
        "on_line",
      expectedRevision:
        2
    },
    {
      idempotencyKey:
        "availability-12345678"
    }
  );


assert.equal(
  unapprovedDriver.status,
  422
);

assert.equal(
  unapprovedDriver.code,
  "driver_not_approved"
);


const pendingIdentity =
  await putDriverAvailability(
    {
      DB:
        dbFor({
          identityStatus:
            "pending"
        })
    },
    driver,
    {
      activeVehicleId:
        VEHICLE_ID,
      requestedState:
        "on_line",
      expectedRevision:
        2
    },
    {
      idempotencyKey:
        "availability-12345678"
    }
  );


assert.equal(
  pendingIdentity.code,
  "identity_verification_required"
);


const activeSwitch =
  await putDriverAvailability(
    {
      DB:
        dbFor({
          state:
            "on_line",
          activeVehicleId:
            "vehicle_other123"
        })
    },
    driver,
    {
      activeVehicleId:
        VEHICLE_ID,
      requestedState:
        "on_line",
      expectedRevision:
        2
    },
    {
      idempotencyKey:
        "availability-12345678"
    }
  );


assert.equal(
  activeSwitch.status,
  409
);

assert.equal(
  activeSwitch.code,
  "active_vehicle_switch_requires_offline"
);


const vehicleNotApproved =
  await putDriverAvailability(
    {
      DB:
        dbFor({
          vehicleStatus:
            "photo_check_required"
        })
    },
    driver,
    {
      activeVehicleId:
        VEHICLE_ID,
      requestedState:
        "on_line",
      expectedRevision:
        2
    },
    {
      idempotencyKey:
        "availability-12345678"
    }
  );


assert.equal(
  vehicleNotApproved.status,
  422
);

assert.equal(
  vehicleNotApproved.code,
  "vehicle_not_approved"
);


const photoBlocked =
  await putDriverAvailability(
    {
      DB:
        dbFor({
          photoControlBlocked:
            true
        })
    },
    driver,
    {
      activeVehicleId:
        VEHICLE_ID,
      requestedState:
        "on_line",
      expectedRevision:
        2
    },
    {
      idempotencyKey:
        "photo-blocked-key",
      nowMs:
        1800000001000
    }
  );

assert.equal(
  photoBlocked.status,
  422
);

assert.equal(
  photoBlocked.code,
  "vehicle_photo_control_required"
);


const wrongRevision =
  await putDriverAvailability(
    {
      DB:
        dbFor({
          revision:
            3
        })
    },
    driver,
    {
      activeVehicleId:
        VEHICLE_ID,
      requestedState:
        "on_line",
      expectedRevision:
        2
    },
    {
      idempotencyKey:
        "availability-12345678"
    }
  );


assert.equal(
  wrongRevision.status,
  409
);

assert.equal(
  wrongRevision.code,
  "availability_revision_conflict"
);


const missingIdempotency =
  await putDriverAvailability(
    {
      DB:
        dbFor()
    },
    driver,
    {
      activeVehicleId:
        VEHICLE_ID,
      requestedState:
        "on_line",
      expectedRevision:
        2
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


const online =
  await putDriverAvailability(
    {
      DB:
        dbFor()
    },
    driver,
    {
      activeVehicleId:
        VEHICLE_ID,
      requestedState:
        "on_line",
      expectedRevision:
        2
    },
    {
      nowMs:
        1800000001000,
      requestId:
        "req_availability",
      idempotencyKey:
        "availability-12345678"
    }
  );


assert.equal(
  online.ok,
  true
);

assert.deepEqual(
  online.availability,
  {
    state:
      "on_line",
    activeVehicleId:
      VEHICLE_ID,
    revision:
      3,
    updatedAt:
      1800000001000
  }
);


const offlineFromOnline =
  await putDriverAvailability(
    {
      DB:
        dbFor({
          state:
            "on_line",
          activeVehicleId:
            VEHICLE_ID
        })
    },
    driver,
    {
      activeVehicleId:
        null,
      requestedState:
        "off_line",
      expectedRevision:
        2
    },
    {
      nowMs:
        1800000002000,
      requestId:
        "req_offline",
      idempotencyKey:
        "availability-offline-12345678"
    }
  );


assert.equal(
  offlineFromOnline.ok,
  true
);

assert.equal(
  offlineFromOnline.availability.state,
  "off_line"
);

assert.equal(
  offlineFromOnline.availability.activeVehicleId,
  null
);


const adminDenied =
  await putDriverAvailability(
    {},
    {
      id:
        "staff_admin123",
      role:
        "admin"
    },
    {
      activeVehicleId:
        VEHICLE_ID,
      requestedState:
        "on_line",
      expectedRevision:
        1
    }
  );


assert.equal(
  adminDenied.status,
  403
);


console.log(
  "✓ DRIVER AVAILABILITY SERVICE TESTS PASSED"
);
