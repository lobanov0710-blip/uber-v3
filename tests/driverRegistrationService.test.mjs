import assert from "node:assert/strict";

import {
  createDriverVehicle,
  getDriverMe,
  patchDriverVehicle,
  putDriverRegistration
} from "../src/core/driverRegistrationService.js";


const DRIVER_ID =
  "staff_driver123";

const NOW =
  1800000000000;


function createFakeDb() {

  const state = {
    profile: {
      staff_account_id:
        DRIVER_ID,

      normalized_phone:
        "+79991234567",

      registration_status:
        "draft",

      identity_status:
        "pending",

      full_name:
        null,

      birth_date:
        null,

      region:
        null,

      revision:
        1,

      submitted_at:
        null,

      availability_state:
        "off_line",

      active_vehicle_id:
        null,

      availability_revision:
        1
    },

    vehicles:
      []
  };


  return {
    state,

    prepare(
      sql
    ) {

      return {
        sql,
        args:
          [],

        bind(
          ...args
        ) {

          this.args =
            args;

          return this;
        },

        async first() {

          if (
            /FROM\s+driver_profiles\s+p/i.test(
              this.sql
            )
          ) {

            return this.args[0] ===
              DRIVER_ID
              ? {
                  ...state.profile
                }
              : null;
          }


          if (
            /FROM\s+vehicles/i.test(
              this.sql
            )
          ) {

            const [
              vehicleId,
              driverId
            ] =
              this.args;


            const vehicle =
              state.vehicles.find(
                item =>
                  item.id ===
                    vehicleId
                  &&
                  item.driver_id ===
                    driverId
              );


            return vehicle
              ? {
                  ...vehicle
                }
              : null;
          }


          throw new Error(
            "unexpected fake D1 first"
          );
        },

        async all() {

          if (
            /FROM\s+vehicles/i.test(
              this.sql
            )
          ) {

            const driverId =
              this.args[0];


            return {
              success:
                true,

              results:
                state.vehicles
                  .filter(
                    item =>
                      item.driver_id ===
                        driverId
                  )
                  .map(
                    item => ({
                      ...item
                    })
                  )
            };
          }


          throw new Error(
            "unexpected fake D1 all"
          );
        },

        async run() {

          if (
            /UPDATE\s+driver_profiles/i.test(
              this.sql
            )
          ) {

            const [
              driverId,
              expectedRevision,
              fullName,
              birthDate,
              region,
              updatedAt
            ] =
              this.args;


            if (
              driverId !==
                DRIVER_ID
              ||
              state.profile.revision !==
                expectedRevision
              ||
              ![
                "draft",
                "changes_required"
              ].includes(
                state.profile
                  .registration_status
              )
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


            state.profile.full_name =
              fullName;

            state.profile.birth_date =
              birthDate;

            state.profile.region =
              region;

            state.profile.revision +=
              1;

            state.profile.updated_at =
              updatedAt;


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
            /INSERT\s+INTO\s+vehicles/i.test(
              this.sql
            )
          ) {

            const [
              id,
              driverId,
              vin,
              plate,
              make,
              model,
              color,
              vehicleClass,
              capacity,
              baggageCapacity,
              createdAt,
              usageBasis
            ] =
              this.args;


            state.vehicles.push({
              id,
              driver_id:
                driverId,
              vin,
              plate,
              make,
              model,
              color,
              class:
                vehicleClass,
              capacity,
              baggage_capacity:
                baggageCapacity,
              usage_basis:
                usageBasis,
              status:
                "draft",
              revision:
                1,
              created_at:
                createdAt,
              updated_at:
                createdAt
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


          if (
            /UPDATE\s+vehicles/i.test(
              this.sql
            )
          ) {

            const [
              vehicleId,
              driverId,
              expectedRevision,
              vin,
              plate,
              make,
              model,
              color,
              vehicleClass,
              capacity,
              baggageCapacity,
              usageBasis,
              criticalChange,
              updatedAt
            ] =
              this.args;


            const vehicle =
              state.vehicles.find(
                item =>
                  item.id ===
                    vehicleId
                  &&
                  item.driver_id ===
                    driverId
              );


            if (
              !vehicle
              ||
              vehicle.revision !==
                expectedRevision
              ||
              [
                "suspended",
                "rejected"
              ].includes(
                vehicle.status
              )
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


            vehicle.vin =
              vin;

            vehicle.plate =
              plate;

            vehicle.make =
              make;

            vehicle.model =
              model;

            vehicle.color =
              color;

            vehicle.class =
              vehicleClass;

            vehicle.capacity =
              capacity;

            vehicle.baggage_capacity =
              baggageCapacity;

            vehicle.usage_basis =
              usageBasis;


            if (
              criticalChange === 1
              &&
              [
                "approved",
                "photo_check_required"
              ].includes(
                vehicle.status
              )
            ) {

              vehicle.status =
                "pending_review";
            }


            vehicle.revision +=
              1;

            vehicle.updated_at =
              updatedAt;


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
            "unexpected fake D1 run"
          );
        }
      };
    }
  };
}


const DB =
  createFakeDb();


const driverUser = {
  id:
    DRIVER_ID,

  role:
    "driver"
};


const me =
  await getDriverMe(
    {
      DB
    },
    driverUser
  );


assert.equal(
  me.ok,
  true
);

assert.equal(
  me.profile.driverId,
  DRIVER_ID
);

assert.equal(
  me.profile.phone,
  "+79991234567"
);

assert.deepEqual(
  me.vehicles,
  []
);


const registration =
  await putDriverRegistration(
    {
      DB
    },
    driverUser,
    {
      fullName:
        "Иван Иванов",

      birthDate:
        "1990-05-20",

      region:
        "Нижегородская область",

      expectedRevision:
        1
    },
    {
      nowMs:
        NOW
    }
  );


assert.equal(
  registration.ok,
  true
);

assert.equal(
  registration.profile.revision,
  2
);

assert.equal(
  registration.profile.fullName,
  "Иван Иванов"
);


const injectedStatus =
  await putDriverRegistration(
    {
      DB
    },
    driverUser,
    {
      fullName:
        "Иван Иванов",

      birthDate:
        "1990-05-20",

      region:
        "Нижегородская область",

      expectedRevision:
        2,

      status:
        "approved"
    },
    {
      nowMs:
        NOW + 1
    }
  );


assert.equal(
  injectedStatus.status,
  400
);


const vehicleInput = {
  vin:
    "XTA210990Y1234567",

  plate:
    "A123AA52",

  make:
    "LADA",

  model:
    "Vesta",

  color:
    "Черный",

  vehicleClass:
    "comfort",

  capacity:
    4,

  baggageCapacity:
    "standard",

  usageBasis:
    "owner"
};


const firstVehicle =
  await createDriverVehicle(
    {
      DB
    },
    driverUser,
    vehicleInput,
    {
      nowMs:
        NOW + 10
    }
  );


assert.equal(
  firstVehicle.ok,
  true
);

assert.equal(
  firstVehicle.vehicle.vin,
  vehicleInput.vin
);


const secondVehicle =
  await createDriverVehicle(
    {
      DB
    },
    driverUser,
    {
      ...vehicleInput,
      plate:
        "B456BB52"
    },
    {
      nowMs:
        NOW + 20
    }
  );


assert.equal(
  secondVehicle.ok,
  true,
  "duplicate VIN is not an approved rejection rule"
);

assert.notEqual(
  firstVehicle.vehicle.id,
  secondVehicle.vehicle.id
);


DB.state.vehicles[0].status =
  "approved";

DB.state.profile.active_vehicle_id =
  firstVehicle.vehicle.id;

DB.state.profile.availability_state =
  "on_line";


const activeCriticalChange =
  await patchDriverVehicle(
    {
      DB
    },
    driverUser,
    firstVehicle.vehicle.id,
    {
      vin:
        "XTA210990Y7654321",

      expectedRevision:
        1
    },
    {
      nowMs:
        NOW + 30
    }
  );


assert.equal(
  activeCriticalChange.status,
  409
);

assert.equal(
  activeCriticalChange.code,
  "active_vehicle_change_forbidden"
);


DB.state.profile.active_vehicle_id =
  null;

DB.state.profile.availability_state =
  "off_line";


const wrongRevision =
  await patchDriverVehicle(
    {
      DB
    },
    driverUser,
    firstVehicle.vehicle.id,
    {
      vin:
        "XTA210990Y7654321",

      expectedRevision:
        99
    },
    {
      nowMs:
        NOW + 40
    }
  );


assert.equal(
  wrongRevision.status,
  409
);

assert.equal(
  wrongRevision.code,
  "revision_conflict"
);


const approvedCriticalChange =
  await patchDriverVehicle(
    {
      DB
    },
    driverUser,
    firstVehicle.vehicle.id,
    {
      vin:
        "XTA210990Y7654321",

      expectedRevision:
        1
    },
    {
      nowMs:
        NOW + 50
    }
  );


assert.equal(
  approvedCriticalChange.ok,
  true
);

assert.equal(
  approvedCriticalChange.vehicle.status,
  "pending_review"
);

assert.equal(
  approvedCriticalChange.vehicle.revision,
  2
);


const nonDriver =
  await getDriverMe(
    {
      DB
    },
    {
      id:
        "staff_admin123",

      role:
        "admin"
    }
  );


assert.equal(
  nonDriver.status,
  403
);


console.log(
  "✓ DRIVER REGISTRATION SERVICE TESTS PASSED"
);
