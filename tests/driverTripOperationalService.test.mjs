import assert from "node:assert/strict";

import {
  changeDriverAssignmentPhase,
  createDriverTripVerificationChallenge
} from "../src/core/driverTripOperationalService.js";


const DRIVER_ID =
  "staff_driver123";

const ASSIGNMENT_ID =
  "assignment_12345678";

const VERIFICATION_ID =
  "verification_12345678";


function dbFor({
  phase = "assigned",
  revision = 1,
  orderStatus = "taken"
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
            /FROM\s+order_assignments\s+a/i.test(
              this.sql
            )
            &&
            /INNER\s+JOIN\s+orders/i.test(
              this.sql
            )
          ) {
            return {
              id:
                ASSIGNMENT_ID,
              order_id:
                "order_12345678",
              driver_id:
                DRIVER_ID,
              vehicle_id:
                "vehicle_12345678",
              state:
                "active",
              revision,
              phase,
              phase_updated_at:
                null,
              verification_session_id:
                null,
              revoked_at:
                null,
              order_status:
                orderStatus,
              order_revision:
                2
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
            "unexpected trip service first query"
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


const ttlMissing =
  await createDriverTripVerificationChallenge(
    {
      DB:
        dbFor()
    },
    driver,
    ASSIGNMENT_ID,
    {
      expectedRevision:
        1
    },
    {
      idempotencyKey:
        "trip-challenge-12345678"
    }
  );


assert.equal(
  ttlMissing.status,
  503
);

assert.equal(
  ttlMissing.code,
  "trip_verification_ttl_not_configured"
);


const clientCannotSetVerified =
  await createDriverTripVerificationChallenge(
    {
      DB:
        dbFor(),
      TRIP_VERIFICATION_CHALLENGE_TTL_SECONDS:
        "300"
    },
    driver,
    ASSIGNMENT_ID,
    {
      expectedRevision:
        1,
      state:
        "verified"
    },
    {
      idempotencyKey:
        "trip-challenge-12345678"
    }
  );


assert.equal(
  clientCannotSetVerified.status,
  400,
  "client must not be able to set verification result"
);


const missingChallengeIdempotency =
  await createDriverTripVerificationChallenge(
    {
      DB:
        dbFor(),
      TRIP_VERIFICATION_CHALLENGE_TTL_SECONDS:
        "300"
    },
    driver,
    ASSIGNMENT_ID,
    {
      expectedRevision:
        1
    },
    {}
  );


assert.equal(
  missingChallengeIdempotency.code,
  "idempotency_key_required"
);


const challenge =
  await createDriverTripVerificationChallenge(
    {
      DB:
        dbFor(),
      TRIP_VERIFICATION_CHALLENGE_TTL_SECONDS:
        "300"
    },
    driver,
    ASSIGNMENT_ID,
    {
      expectedRevision:
        1
    },
    {
      nowMs:
        1800000000000,
      requestId:
        "req_challenge",
      idempotencyKey:
        "trip-challenge-12345678"
    }
  );


assert.equal(
  challenge.ok,
  true
);

assert.equal(
  challenge.verification.state,
  "pending"
);

assert.equal(
  challenge.verification.assignmentRevision,
  1
);

assert.equal(
  challenge.verification.expiresAt,
  1800000300000
);

assert.match(
  challenge.verification.verificationSessionId,
  /^verification_/
);


const missingVerificationSession =
  await changeDriverAssignmentPhase(
    {
      DB:
        dbFor()
    },
    driver,
    ASSIGNMENT_ID,
    {
      phase:
        "en_route_to_pickup",
      expectedRevision:
        1
    },
    {
      idempotencyKey:
        "trip-phase-12345678"
    }
  );


assert.equal(
  missingVerificationSession.status,
  400
);


const wrongPhase =
  await changeDriverAssignmentPhase(
    {
      DB:
        dbFor()
    },
    driver,
    ASSIGNMENT_ID,
    {
      phase:
        "arrived",
      verificationSessionId:
        VERIFICATION_ID,
      expectedRevision:
        1
    },
    {
      idempotencyKey:
        "trip-phase-12345678"
    }
  );


assert.equal(
  wrongPhase.status,
  409
);

assert.equal(
  wrongPhase.code,
  "invalid_phase_transition"
);


const enRoute =
  await changeDriverAssignmentPhase(
    {
      DB:
        dbFor()
    },
    driver,
    ASSIGNMENT_ID,
    {
      phase:
        "en_route_to_pickup",
      verificationSessionId:
        VERIFICATION_ID,
      expectedRevision:
        1
    },
    {
      nowMs:
        1800000001000,
      requestId:
        "req_phase",
      idempotencyKey:
        "trip-phase-12345678"
    }
  );


assert.equal(
  enRoute.ok,
  true
);

assert.equal(
  enRoute.assignment.phase,
  "en_route_to_pickup"
);

assert.equal(
  enRoute.assignment.revision,
  2
);


const arrived =
  await changeDriverAssignmentPhase(
    {
      DB:
        dbFor({
          phase:
            "en_route_to_pickup",
          revision:
            2
        })
    },
    driver,
    ASSIGNMENT_ID,
    {
      phase:
        "arrived",
      verificationSessionId:
        null,
      expectedRevision:
        2
    },
    {
      nowMs:
        1800000002000,
      requestId:
        "req_arrived",
      idempotencyKey:
        "trip-arrived-12345678"
    }
  );


assert.equal(
  arrived.ok,
  true
);

assert.equal(
  arrived.assignment.phase,
  "arrived"
);


const inTrip =
  await changeDriverAssignmentPhase(
    {
      DB:
        dbFor({
          phase:
            "arrived",
          revision:
            3
        })
    },
    driver,
    ASSIGNMENT_ID,
    {
      phase:
        "in_trip",
      verificationSessionId:
        null,
      expectedRevision:
        3
    },
    {
      nowMs:
        1800000003000,
      requestId:
        "req_in_trip",
      idempotencyKey:
        "trip-in-trip-12345678"
    }
  );


assert.equal(
  inTrip.ok,
  true
);

assert.equal(
  inTrip.assignment.phase,
  "in_trip"
);


console.log(
  "✓ DRIVER TRIP OPERATIONAL SERVICE TESTS PASSED"
);
