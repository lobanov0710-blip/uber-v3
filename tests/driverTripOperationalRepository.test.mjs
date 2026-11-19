import assert from "node:assert/strict";

import {
  advanceDriverAssignmentPhase,
  insertTripVerificationChallenge
} from "../src/core/driverTripOperationalRepository.js";


function fakeDb(
  changes
) {
  const calls = [];

  return {
    calls,

    prepare(sql) {
      const statement = {
        sql,
        args: [],

        bind(...args) {
          this.args = args;
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
              changes?.[index] ??
              1
          }
        })
      );
    }
  };
}


const challengeDb =
  fakeDb();


const challenge =
  await insertTripVerificationChallenge(
    {
      DB:
        challengeDb
    },
    {
      driverId:
        "staff_driver123",
      assignmentId:
        "assignment_12345678",
      expectedRevision:
        1,
      verificationSessionId:
        "verification_12345678",
      challengeDigest:
        "A".repeat(43),
      expiresAt:
        1800000300000,
      createdAt:
        1800000000000,
      requestId:
        "req_challenge",
      auditId:
        "audit_challenge",
      idempotency: {
        operation:
          "driver.assignment.verification_challenge.create",
        keyDigest:
          "B".repeat(43),
        requestDigest:
          "C".repeat(43),
        claimId:
          "idem-claim-challenge"
      }
    }
  );


assert.equal(
  challenge.kind,
  "success"
);


const challengeInsert =
  challengeDb.calls.find(
    call =>
      /INSERT\s+INTO\s+identity_verifications/i.test(
        call.sql
      )
  );


assert.ok(
  challengeInsert
);

assert.match(
  challengeInsert.sql,
  /a\.revision\s*=\s*\?7/i
);

assert.match(
  challengeInsert.sql,
  /a\.phase\s*=\s*'assigned'/i
);

assert.match(
  challengeInsert.sql,
  /o\.status\s*=\s*'taken'/i
);

assert.match(
  challengeInsert.sql,
  /NOT\s+EXISTS[\s\S]*identity_verifications[\s\S]*expires_at\s*>\s*\?4/i
);

assert.match(
  challengeInsert.sql,
  /mutation_idempotency/i
);


const phaseDb =
  fakeDb();


const phase =
  await advanceDriverAssignmentPhase(
    {
      DB:
        phaseDb
    },
    {
      driverId:
        "staff_driver123",
      assignmentId:
        "assignment_12345678",
      expectedRevision:
        1,
      expectedPhase:
        "assigned",
      targetPhase:
        "en_route_to_pickup",
      verificationSessionId:
        "verification_12345678",
      changedAt:
        1800000001000,
      requestId:
        "req_phase",
      auditId:
        "audit_phase",
      idempotency: {
        operation:
          "driver.assignment.phase",
        keyDigest:
          "D".repeat(43),
        requestDigest:
          "E".repeat(43),
        claimId:
          "idem-claim-phase"
      }
    }
  );


assert.equal(
  phase.kind,
  "success"
);


const phaseUpdate =
  phaseDb.calls.find(
    call =>
      /UPDATE\s+order_assignments/i.test(
        call.sql
      )
  );


assert.ok(
  phaseUpdate
);

assert.match(
  phaseUpdate.sql,
  /identity_verifications/i
);

assert.match(
  phaseUpdate.sql,
  /iv\.assignment_revision\s*=\s*a\.revision/i
);

assert.match(
  phaseUpdate.sql,
  /iv\.order_id\s*=\s*a\.order_id/i
);

assert.match(
  phaseUpdate.sql,
  /iv\.driver_id\s*=\s*a\.driver_id/i
);

assert.match(
  phaseUpdate.sql,
  /iv\.vehicle_id\s*=\s*a\.vehicle_id/i
);

assert.match(
  phaseUpdate.sql,
  /iv\.state\s*=\s*'verified'/i
);

assert.match(
  phaseUpdate.sql,
  /iv\.expires_at\s*>=\s*\?7/i
);


const inTripDb =
  fakeDb();


const inTrip =
  await advanceDriverAssignmentPhase(
    {
      DB:
        inTripDb
    },
    {
      driverId:
        "staff_driver123",
      assignmentId:
        "assignment_12345678",
      expectedRevision:
        3,
      expectedPhase:
        "arrived",
      targetPhase:
        "in_trip",
      verificationSessionId:
        null,
      changedAt:
        1800000003000,
      requestId:
        "req_in_trip",
      auditId:
        "audit_in_trip",
      idempotency: {
        operation:
          "driver.assignment.phase",
        keyDigest:
          "F".repeat(43),
        requestDigest:
          "G".repeat(43),
        claimId:
          "idem-claim-in-trip"
      }
    }
  );


assert.equal(
  inTrip.kind,
  "success"
);


const orderStart =
  inTripDb.calls.find(
    call =>
      /UPDATE\s+orders/i.test(
        call.sql
      )
      &&
      /status\s*=\s*'in_progress'/i.test(
        call.sql
      )
  );


assert.ok(
  orderStart,
  "in_trip phase must atomically move core order to in_progress"
);

assert.match(
  orderStart.sql,
  /phase\s*=\s*'in_trip'/i
);


console.log(
  "✓ DRIVER TRIP OPERATIONAL REPOSITORY TESTS PASSED"
);
