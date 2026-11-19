import assert from "node:assert/strict";

import {
  consumeDriverExchangeRateLimit,
  createRateLimitBucketKey
} from "../src/core/driverExchangeRateLimit.js";


function createFakeDb() {

  const state =
    new Map();


  return {
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

        async run() {

          if (
            !/INSERT\s+INTO\s+driver_exchange_rate_limits/i.test(
              this.sql
            )
          ) {

            throw new Error(
              "unexpected rate-limit run"
            );
          }


          const [
            key,
            timestamp,
            cutoff,
            limit,
            step,
            maxPenalty
          ] =
            this.args;


          const current =
            state.get(
              key
            );


          if (
            !current
            ||
            current.windowStartedAt <=
              cutoff
          ) {

            state.set(
              key,
              {
                windowStartedAt:
                  timestamp,

                attemptCount:
                  1,

                blockedUntil:
                  null,

                updatedAt:
                  timestamp
              }
            );

          } else {

            const nextCount =
              current.attemptCount +
              1;


            let blockedUntil =
              current.blockedUntil;


            if (
              !blockedUntil
              ||
              blockedUntil <=
                timestamp
            ) {

              blockedUntil =
                nextCount >
                  limit
                  ? timestamp +
                    Math.min(
                      maxPenalty,
                      step *
                        (
                          nextCount -
                          limit
                        )
                    )
                  : null;
            }


            state.set(
              key,
              {
                ...current,

                attemptCount:
                  nextCount,

                blockedUntil,

                updatedAt:
                  timestamp
              }
            );
          }


          return {
            success:
              true,

            meta: {
              changes:
                1
            }
          };
        },

        async first() {

          if (
            !/FROM\s+driver_exchange_rate_limits/i.test(
              this.sql
            )
          ) {

            throw new Error(
              "unexpected rate-limit read"
            );
          }


          const current =
            state.get(
              this.args[0]
            );


          if (!current) {

            return null;
          }


          return {
            attempt_count:
              current.attemptCount,

            blocked_until:
              current.blockedUntil
          };
        }
      };
    }
  };
}


const installationKey =
  await createRateLimitBucketKey(
    "installation",
    "2a11acf9-7fec-475a-ac9c-a41e5e6df92a"
  );


const phoneKey =
  await createRateLimitBucketKey(
    "phone",
    "+79991234567"
  );


assert.match(
  installationKey,
  /^[A-Za-z0-9_-]{43}$/
);

assert.notEqual(
  installationKey,
  phoneKey
);

assert.equal(
  installationKey.includes(
    "2a11acf9"
  ),
  false
);


const DB =
  createFakeDb();


const base =
  1800000000000;


for (
  let attempt = 1;
  attempt <= 5;
  attempt++
) {

  const result =
    await consumeDriverExchangeRateLimit(
      {
        DB
      },
      {
        bucketKey:
          installationKey,

        now:
          base +
          attempt,

        limit:
          5,

        windowMs:
          60000,

        penaltyStepMs:
          15000,

        maxPenaltyMs:
          300000
      }
    );


  assert.equal(
    result.allowed,
    true
  );
}


const sixth =
  await consumeDriverExchangeRateLimit(
    {
      DB
    },
    {
      bucketKey:
        installationKey,

      now:
        base +
        10,

      limit:
        5,

      windowMs:
        60000,

      penaltyStepMs:
        15000,

      maxPenaltyMs:
        300000
    }
  );


assert.equal(
  sixth.allowed,
  false
);

assert.equal(
  sixth.attemptCount,
  6
);

assert.equal(
  sixth.blockedUntil,
  base +
    10 +
    15000
);


const stillBlocked =
  await consumeDriverExchangeRateLimit(
    {
      DB
    },
    {
      bucketKey:
        installationKey,

      now:
        base +
        1000,

      limit:
        5,

      windowMs:
        60000,

      penaltyStepMs:
        15000,

      maxPenaltyMs:
        300000
    }
  );


assert.equal(
  stillBlocked.allowed,
  false
);


const reset =
  await consumeDriverExchangeRateLimit(
    {
      DB
    },
    {
      bucketKey:
        installationKey,

      now:
        base +
        61000,

      limit:
        5,

      windowMs:
        60000,

      penaltyStepMs:
        15000,

      maxPenaltyMs:
        300000
    }
  );


assert.equal(
  reset.allowed,
  true
);

assert.equal(
  reset.attemptCount,
  1
);


console.log(
  "✓ DRIVER EXCHANGE RATE LIMIT TESTS PASSED"
);
