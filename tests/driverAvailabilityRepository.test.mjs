import assert from "node:assert/strict";

import {
  updateDriverAvailability
} from "../src/core/driverAvailabilityRepository.js";


function fakeDb(
  changes = [
    1,
    1,
    1,
    1
  ]
) {

  const calls = [];

  return {
    calls,

    prepare(sql) {

      const statement = {
        sql,
        args: [],

        bind(...args) {
          this.args =
            args;
          calls.push(this);
          return this;
        },

        async run() {
          return {
            success: true,
            meta: {
              changes: 1
            }
          };
        }
      };

      return statement;
    },

    async batch(statements) {
      return statements.map(
        (_, index) => ({
          success: true,
          meta: {
            changes:
              changes[index] ??
              1
          }
        })
      );
    }
  };
}


const DB =
  fakeDb();


const result =
  await updateDriverAvailability(
    {
      DB
    },
    {
      driverId:
        "staff_driver123",
      requestedState:
        "on_line",
      activeVehicleId:
        "vehicle_12345678",
      expectedRevision:
        2,
      updatedAt:
        1800000000000,
      requestId:
        "req_availability",
      auditId:
        "audit_availability",
      idempotency: {
        operation:
          "driver.availability.update",
        keyDigest:
          "A".repeat(43),
        requestDigest:
          "B".repeat(43),
        claimId:
          "idem-claim-availability"
      }
    }
  );


assert.equal(
  result.kind,
  "success"
);

assert.equal(
  result.result.availability.revision,
  3
);


const update =
  DB.calls.find(
    call =>
      /UPDATE\s+driver_availability/i.test(
        call.sql
      )
  );


assert.ok(
  update
);

assert.match(
  update.sql,
  /registration_status\s*=\s*'approved'/i
);

assert.match(
  update.sql,
  /identity_status\s*=\s*'verified'/i
);

assert.match(
  update.sql,
  /v\.status\s*=\s*'approved'/i
);

assert.match(
  update.sql,
  /state\s*=\s*'off_line'[\s\S]*OR\s+active_vehicle_id\s*=\s*\?3/i
);

assert.match(
  update.sql,
  /mutation_idempotency/i
);


const conflictDb =
  fakeDb([
    1,
    0,
    0,
    0
  ]);


const conflict =
  await updateDriverAvailability(
    {
      DB:
        conflictDb
    },
    {
      driverId:
        "staff_driver123",
      requestedState:
        "on_line",
      activeVehicleId:
        "vehicle_12345678",
      expectedRevision:
        99,
      updatedAt:
        1800000000000,
      requestId:
        "req_conflict",
      auditId:
        "audit_conflict",
      idempotency: {
        operation:
          "driver.availability.update",
        keyDigest:
          "C".repeat(43),
        requestDigest:
          "D".repeat(43),
        claimId:
          "idem-claim-conflict"
      }
    }
  );


assert.equal(
  conflict.kind,
  "conflict"
);

assert.equal(
  conflict.result.code,
  "availability_preconditions_failed"
);


console.log(
  "✓ DRIVER AVAILABILITY REPOSITORY TESTS PASSED"
);
