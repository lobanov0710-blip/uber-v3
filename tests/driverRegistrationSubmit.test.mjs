import assert from "node:assert/strict";

import {
  submitDriverRegistration
} from "../src/core/driverPrivateUploadRepository.js";


function fakeDb({
  profileChanges = 1,
  vehicleChanges = 1,
  auditChanges = 1
} = {}) {

  const captured = [];

  return {
    captured,

    prepare(sql) {
      return {
        sql,
        args: [],

        bind(...args) {
          this.args = args;
          return this;
        }
      };
    },

    async batch(statements) {

      captured.push(
        ...statements
      );

      return statements.map(
        (statement, index) => {

          let changes;

          if (index === 0) {
            changes =
              profileChanges;
          } else if (
            index ===
              statements.length - 1
          ) {
            changes =
              auditChanges;
          } else {
            changes =
              vehicleChanges;
          }

          return {
            success: true,
            meta: {
              changes
            }
          };
        }
      );
    }
  };
}


const DB =
  fakeDb();


const result =
  await submitDriverRegistration(
    {
      DB
    },
    "staff_driver123",
    {
      expectedRevision:
        7,

      submittedAt:
        1800000000000,

      vehicleIds: [
        "vehicle_one",
        "vehicle_two"
      ],

      requestId:
        "req_submit_test"
    }
  );


assert.equal(
  result.submitted,
  true
);

assert.equal(
  DB.captured.length,
  4
);

assert.match(
  DB.captured[0].sql,
  /registration_status\s*=\s*'submitted'/i
);

assert.match(
  DB.captured[1].sql,
  /status\s*=\s*'pending_review'/i
);

assert.match(
  DB.captured[2].sql,
  /status\s*=\s*'pending_review'/i
);

assert.match(
  DB.captured[3].sql,
  /driver\.registration_submitted/i
);

assert.match(
  DB.captured[1].sql,
  /EXISTS\s*\([\s\S]*registration_status\s*=\s*'submitted'/i,
  "vehicle transition must depend on successful profile submission"
);

assert.match(
  DB.captured[3].sql,
  /EXISTS\s*\([\s\S]*registration_status\s*=\s*'submitted'/i,
  "audit insert must depend on successful profile submission"
);


const conflictDb =
  fakeDb({
    profileChanges:
      0,

    vehicleChanges:
      0,

    auditChanges:
      0
  });


const conflict =
  await submitDriverRegistration(
    {
      DB:
        conflictDb
    },
    "staff_driver123",
    {
      expectedRevision:
        99,

      submittedAt:
        1800000001000,

      vehicleIds: [
        "vehicle_one"
      ],

      requestId:
        "req_submit_conflict"
    }
  );


assert.equal(
  conflict.submitted,
  false
);


console.log(
  "✓ DRIVER REGISTRATION SUBMIT TRANSACTION TESTS PASSED"
);
