import assert from "node:assert/strict";

import {
  listActiveDriverPushTargetsForAccount
} from "../src/core/staffPushDeliveryRepository.js";

import {
  buildDriverOrderStatusPushPlan,
  notifyDriversOfOrderStatusChange
} from "../src/core/staffOrderStatusNotificationService.js";


const FIXED_NOW =
  1700000000000;

const ORDER_ID =
  "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

const INSTALLATION_ID =
  "11111111-2222-4333-8444-555555555555";


async function test(
  name,
  fn
) {

  try {

    await fn();

    console.log(
      `✓ ${name}`
    );

  } catch (
    error
  ) {

    console.error(
      `✘ ${name}`
    );

    console.error(
      error
    );

    process.exitCode =
      1;
  }
}


function createFakeDatabase(
  rows
) {

  const calls =
    [];


  return {
    calls,

    db: {

      prepare(
        sql
      ) {

        const call = {
          sql,
          args:
            []
        };


        calls.push(
          call
        );


        const statement = {

          bind(
            ...args
          ) {

            call.args =
              args;

            return statement;
          },

          async all() {

            return {
              success:
                true,

              results:
                rows
            };
          }
        };


        return statement;
      }
    }
  };
}


await test(
  "taken status broadcasts only routing metadata",
  async () => {

    const plan =
      buildDriverOrderStatusPushPlan({
        id:
          ORDER_ID,

        status:
          "taken",

        driverId:
          "driver-1",

        updatedAt:
          FIXED_NOW,

        name:
          "Passenger",

        phone:
          "+79990000000"
      });


    assert.equal(
      plan.audience,
      "all"
    );


    assert.equal(
      plan.accountId,
      null
    );


    assert.deepEqual(
      plan.payload,
      {
        type:
          "order_status_changed",

        orderId:
          ORDER_ID,

        status:
          "taken",

        updatedAt:
          String(
            FIXED_NOW
          )
      }
    );


    assert.equal(
      "name" in
        plan.payload,
      false
    );


    assert.equal(
      "phone" in
        plan.payload,
      false
    );
  }
);


await test(
  "assigned canceled order targets only assigned driver",
  async () => {

    const plan =
      buildDriverOrderStatusPushPlan({
        id:
          ORDER_ID,

        status:
          "canceled",

        driverId:
          "driver-7",

        updatedAt:
          FIXED_NOW
      });


    assert.equal(
      plan.audience,
      "account"
    );


    assert.equal(
      plan.accountId,
      "driver-7"
    );
  }
);


await test(
  "unassigned canceled order broadcasts invalidation",
  async () => {

    const plan =
      buildDriverOrderStatusPushPlan({
        id:
          ORDER_ID,

        status:
          "canceled",

        driverId:
          null,

        updatedAt:
          FIXED_NOW
      });


    assert.equal(
      plan.audience,
      "all"
    );


    assert.equal(
      plan.accountId,
      null
    );
  }
);


await test(
  "driver self transitions are not pushed in this stage",
  async () => {

    for (
      const status
      of [
        "in_progress",
        "done"
      ]
    ) {

      assert.equal(
        buildDriverOrderStatusPushPlan({
          id:
            ORDER_ID,

          status,

          driverId:
            "driver-1",

          updatedAt:
            FIXED_NOW
        }),
        null
      );
    }
  }
);


await test(
  "targeted driver query preserves active-session authorization",
  async () => {

    const {
      db,
      calls
    } =
      createFakeDatabase([
        {
          installation_id:
            INSTALLATION_ID,

          account_id:
            "driver-7",

          session_family_id:
            "family-7",

          fcm_token:
            "fcm-token"
        }
      ]);


    const targets =
      await listActiveDriverPushTargetsForAccount(
        {
          DB:
            db
        },
        "driver-7",
        FIXED_NOW
      );


    assert.equal(
      targets.length,
      1
    );


    assert.equal(
      targets[0].accountId,
      "driver-7"
    );


    assert.match(
      calls[0].sql,
      /a\.role\s*=\s*'driver'/i
    );


    assert.match(
      calls[0].sql,
      /a\.status\s*=\s*'active'/i
    );


    assert.match(
      calls[0].sql,
      /p\.account_id\s*=\s*\?2/i
    );


    assert.match(
      calls[0].sql,
      /s\.family_id\s*=\s*p\.session_family_id/i
    );


    assert.deepEqual(
      calls[0].args,
      [
        FIXED_NOW,
        "driver-7"
      ]
    );
  }
);


await test(
  "staging status push is skipped before any database or Firebase access",
  async () => {

    const result =
      await notifyDriversOfOrderStatusChange(
        {
          APP_ENV:
            "staging"
        },
        {
          id:
            ORDER_ID,

          status:
            "taken",

          driverId:
            "driver-1",

          updatedAt:
            FIXED_NOW
        }
      );


    assert.equal(
      result.ok,
      true
    );


    assert.equal(
      result.skipped,
      true
    );


    assert.equal(
      result.attempted,
      0
    );
  }
);


console.log("");


if (!process.exitCode) {

  console.log(
    "✓ ALL ORDER STATUS PUSH TESTS PASSED"
  );
}
