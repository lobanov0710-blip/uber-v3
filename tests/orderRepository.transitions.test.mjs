import assert from "node:assert/strict";

import {
  takeOrderForDriver,
  advanceDriverOrder,
  cancelOrder
} from "../src/core/orderRepository.js";


// ========================================
// SIMPLE ASYNC TEST RUNNER
// ========================================

async function test(
  name,
  fn
) {

  try {

    await fn();

    console.log(
      `✓ ${name}`
    );

  } catch (error) {

    console.error(
      `✘ ${name}`
    );

    console.error(
      error
    );

    process.exitCode = 1;
  }
}


// ========================================
// TEST DATA
// ========================================

function orderRow(
  overrides = {}
) {

  return {
    id:
      "order-1",

    quote_id:
      null,

    name:
      "Иван",

    phone:
      "+79990000001",

    route:
      "Нижний Новгород → Москва",

    from_place:
      "Нижний Новгород",

    to_place:
      "Москва",

    trip_date:
      "2026-10-20",

    comment:
      "",

    tariff:
      null,

    distance_km:
      null,

    duration_minutes:
      null,

    price_rub:
      null,

    status:
      "new",

    driver_id:
      null,

    created_at:
      1000,

    updated_at:
      1000,

    ...overrides
  };
}


// ========================================
// FAKE D1
// ========================================

function createFakeDatabase(
  options = {}
) {

  const calls = [];


  const firstResults =
    Array.isArray(
      options.firstResults
    )
      ? [
          ...options.firstResults
        ]
      : [];


  const runResult =
    options.runResult ?? {
      success: true,

      meta: {
        changes: 1
      }
    };


  const runError =
    options.runError ??
    null;


  const db = {

    prepare(sql) {

      const call = {
        sql,
        args: null
      };


      calls.push(
        call
      );


      const statement = {

        bind(...args) {

          call.args =
            args;

          return statement;
        },


        async run() {

          if (runError) {

            throw runError;
          }


          return runResult;
        },


        async first() {

          if (
            firstResults.length === 0
          ) {

            return null;
          }


          return firstResults.shift();
        }
      };


      return statement;
    }
  };


  return {
    db,
    calls
  };
}


// ========================================
// TAKE ORDER
// ========================================

await test(
  "driver atomically takes a new unassigned order",
  async () => {

    const {
      db,
      calls
    } =
      createFakeDatabase(
        {
          firstResults: [
            orderRow(
              {
                status:
                  "taken",

                driver_id:
                  "driver-1",

                updated_at:
                  2000
              }
            )
          ]
        }
      );


    const result =
      await takeOrderForDriver(
        {
          DB: db
        },
        "order-1",
        "driver-1",
        2000
      );


    assert.equal(
      calls.length,
      2
    );


    assert.match(
      calls[0].sql,
      /UPDATE orders/i
    );


    assert.match(
      calls[0].sql,
      /status = 'taken'/i
    );


    assert.match(
      calls[0].sql,
      /driver_id = \?2/i
    );


    assert.match(
      calls[0].sql,
      /status = 'new'/i
    );


    assert.match(
      calls[0].sql,
      /driver_id IS NULL/i
    );


    assert.deepEqual(
      calls[0].args,
      [
        "order-1",
        "driver-1",
        2000
      ]
    );


    assert.equal(
      result.ok,
      true
    );


    assert.equal(
      result.order.status,
      "taken"
    );


    assert.equal(
      result.order.driverId,
      "driver-1"
    );
  }
);


// ========================================
// TAKE CONFLICT
// ========================================

await test(
  "second driver cannot take an already claimed order",
  async () => {

    const {
      db
    } =
      createFakeDatabase(
        {
          runResult: {
            success: true,

            meta: {
              changes: 0
            }
          },

          firstResults: [
            orderRow(
              {
                status:
                  "taken",

                driver_id:
                  "driver-1",

                updated_at:
                  2000
              }
            )
          ]
        }
      );


    const result =
      await takeOrderForDriver(
        {
          DB: db
        },
        "order-1",
        "driver-2",
        3000
      );


    assert.equal(
      result.ok,
      false
    );


    assert.equal(
      result.reason,
      "conflict"
    );


    assert.equal(
      result.order.driverId,
      "driver-1"
    );
  }
);


// ========================================
// TAKE NOT FOUND
// ========================================

await test(
  "taking a missing order returns not_found",
  async () => {

    const {
      db
    } =
      createFakeDatabase(
        {
          runResult: {
            success: true,

            meta: {
              changes: 0
            }
          },

          firstResults: [
            null
          ]
        }
      );


    const result =
      await takeOrderForDriver(
        {
          DB: db
        },
        "missing-order",
        "driver-1",
        2000
      );


    assert.deepEqual(
      result,
      {
        ok: false,
        reason:
          "not_found",
        order: null
      }
    );
  }
);


// ========================================
// TAKEN -> IN PROGRESS
// ========================================

await test(
  "assigned driver starts the trip",
  async () => {

    const {
      db,
      calls
    } =
      createFakeDatabase(
        {
          firstResults: [
            orderRow(
              {
                status:
                  "in_progress",

                driver_id:
                  "driver-1",

                updated_at:
                  3000
              }
            )
          ]
        }
      );


    const result =
      await advanceDriverOrder(
        {
          DB: db
        },
        "order-1",
        "driver-1",
        "in_progress",
        3000
      );


    assert.match(
      calls[0].sql,
      /driver_id = \?2/i
    );


    assert.match(
      calls[0].sql,
      /status = \?3/i
    );


    assert.deepEqual(
      calls[0].args,
      [
        "order-1",
        "driver-1",
        "taken",
        "in_progress",
        3000
      ]
    );


    assert.equal(
      result.ok,
      true
    );


    assert.equal(
      result.order.status,
      "in_progress"
    );
  }
);


// ========================================
// IN PROGRESS -> DONE
// ========================================

await test(
  "assigned driver completes the trip",
  async () => {

    const {
      db,
      calls
    } =
      createFakeDatabase(
        {
          firstResults: [
            orderRow(
              {
                status:
                  "done",

                driver_id:
                  "driver-1",

                updated_at:
                  4000
              }
            )
          ]
        }
      );


    const result =
      await advanceDriverOrder(
        {
          DB: db
        },
        "order-1",
        "driver-1",
        "done",
        4000
      );


    assert.deepEqual(
      calls[0].args,
      [
        "order-1",
        "driver-1",
        "in_progress",
        "done",
        4000
      ]
    );


    assert.equal(
      result.ok,
      true
    );


    assert.equal(
      result.order.status,
      "done"
    );
  }
);


// ========================================
// WRONG DRIVER
// ========================================

await test(
  "another driver cannot advance the assigned order",
  async () => {

    const {
      db
    } =
      createFakeDatabase(
        {
          runResult: {
            success: true,

            meta: {
              changes: 0
            }
          },

          firstResults: [
            orderRow(
              {
                status:
                  "taken",

                driver_id:
                  "driver-1"
              }
            )
          ]
        }
      );


    const result =
      await advanceDriverOrder(
        {
          DB: db
        },
        "order-1",
        "driver-2",
        "in_progress",
        3000
      );


    assert.equal(
      result.ok,
      false
    );


    assert.equal(
      result.reason,
      "conflict"
    );


    assert.equal(
      result.order.driverId,
      "driver-1"
    );
  }
);


// ========================================
// ILLEGAL DRIVER TRANSITIONS
// ========================================

await test(
  "driver cannot perform arbitrary status transitions",
  async () => {

    const {
      db,
      calls
    } =
      createFakeDatabase();


    await assert.rejects(
      () =>
        advanceDriverOrder(
          {
            DB: db
          },
          "order-1",
          "driver-1",
          "canceled",
          3000
        ),

      /Invalid driver order transition/
    );


    await assert.rejects(
      () =>
        advanceDriverOrder(
          {
            DB: db
          },
          "order-1",
          "driver-1",
          "taken",
          3000
        ),

      /Invalid driver order transition/
    );


    assert.equal(
      calls.length,
      0
    );
  }
);


// ========================================
// ADMIN CANCEL
// ========================================

await test(
  "cancel transition accepts non-terminal order",
  async () => {

    const {
      db,
      calls
    } =
      createFakeDatabase(
        {
          firstResults: [
            orderRow(
              {
                status:
                  "canceled",

                driver_id:
                  "driver-1",

                updated_at:
                  5000
              }
            )
          ]
        }
      );


    const result =
      await cancelOrder(
        {
          DB: db
        },
        "order-1",
        5000
      );


    assert.match(
      calls[0].sql,
      /status = 'canceled'/i
    );


    assert.match(
      calls[0].sql,
      /'new'/i
    );


    assert.match(
      calls[0].sql,
      /'taken'/i
    );


    assert.match(
      calls[0].sql,
      /'in_progress'/i
    );


    assert.equal(
      result.ok,
      true
    );


    assert.equal(
      result.order.status,
      "canceled"
    );


    assert.equal(
      result.order.driverId,
      "driver-1"
    );
  }
);


// ========================================
// TERMINAL STATE
// ========================================

await test(
  "done order cannot be canceled",
  async () => {

    const {
      db
    } =
      createFakeDatabase(
        {
          runResult: {
            success: true,

            meta: {
              changes: 0
            }
          },

          firstResults: [
            orderRow(
              {
                status:
                  "done",

                driver_id:
                  "driver-1"
              }
            )
          ]
        }
      );


    const result =
      await cancelOrder(
        {
          DB: db
        },
        "order-1",
        5000
      );


    assert.equal(
      result.ok,
      false
    );


    assert.equal(
      result.reason,
      "conflict"
    );


    assert.equal(
      result.order.status,
      "done"
    );
  }
);


// ========================================
// D1 FAILURE
// ========================================

await test(
  "unsuccessful D1 transition is rejected",
  async () => {

    const {
      db
    } =
      createFakeDatabase(
        {
          runResult: {
            success: false,

            meta: {
              changes: 0
            }
          }
        }
      );


    await assert.rejects(
      () =>
        takeOrderForDriver(
          {
            DB: db
          },
          "order-1",
          "driver-1",
          2000
        ),

      /Order transition failed/
    );
  }
);


// ========================================
// INVALID D1 RESULT
// ========================================

await test(
  "transition requires valid D1 change count",
  async () => {

    const {
      db
    } =
      createFakeDatabase(
        {
          runResult: {
            success: true
          }
        }
      );


    await assert.rejects(
      () =>
        takeOrderForDriver(
          {
            DB: db
          },
          "order-1",
          "driver-1",
          2000
        ),

      /Invalid order transition result/
    );
  }
);


// ========================================
// READBACK FAILURE
// ========================================

await test(
  "successful transition requires order readback",
  async () => {

    const {
      db
    } =
      createFakeDatabase(
        {
          firstResults: [
            null
          ]
        }
      );


    await assert.rejects(
      () =>
        takeOrderForDriver(
          {
            DB: db
          },
          "order-1",
          "driver-1",
          2000
        ),

      /Order transition readback failed/
    );
  }
);


// ========================================
// DATABASE REQUIRED
// ========================================

await test(
  "order transition requires D1 binding",
  async () => {

    await assert.rejects(
      () =>
        takeOrderForDriver(
          {},
          "order-1",
          "driver-1",
          2000
        ),

      /D1 DB binding is not configured/
    );
  }
);


console.log("");


if (!process.exitCode) {

  console.log(
    "✓ ALL ORDER TRANSITION TESTS PASSED"
  );
}