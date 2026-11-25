import assert from "node:assert/strict";

import {
  advanceDriverOrder,
  cancelOrder
} from "../src/core/orderRepository.js";


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
      "in_progress",
    driver_id:
      "driver-1",
    created_at:
      1000,
    updated_at:
      3000,
    revision:
      3,
    ...overrides
  };
}


function result(
  changes,
  success = true
) {
  return {
    success,
    meta: {
      changes
    }
  };
}


function createFakeDatabase({
  batchResults = [
    result(1),
    result(1)
  ],
  firstResults = []
} = {}) {

  const calls = [];
  const reads = [
    ...firstResults
  ];


  const db = {

    prepare(sql) {

      const call = {
        sql,
        args:
          null
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


        async first() {

          return reads.length > 0
            ? reads.shift()
            : null;
        },


        async run() {

          return result(1);
        }
      };


      return statement;
    },


    async batch(statements) {

      assert.equal(
        statements.length,
        2
      );

      return batchResults;
    }
  };


  return {
    db,
    calls
  };
}


await test(
  "repository rejects legacy taken -> in_progress",
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
            DB:
              db
          },
          "order-1",
          "driver-1",
          "in_progress",
          4000
        ),
      /Invalid driver order transition/
    );


    assert.equal(
      calls.length,
      0
    );
  }
);


await test(
  "done atomically completes active in-trip assignment",
  async () => {

    const {
      db,
      calls
    } =
      createFakeDatabase({
        batchResults: [
          result(1),
          result(1)
        ],
        firstResults: [
          orderRow({
            status:
              "done",
            updated_at:
              4000,
            revision:
              4
          })
        ]
      });


    const transition =
      await advanceDriverOrder(
        {
          DB:
            db
        },
        "order-1",
        "driver-1",
        "done",
        4000
      );


    assert.equal(
      transition.ok,
      true
    );

    assert.equal(
      transition.order.status,
      "done"
    );


    assert.match(
      calls[0].sql,
      /status\s*=\s*\?4/i
    );

    assert.match(
      calls[0].sql,
      /a\.phase\s*=\s*'in_trip'/i
    );

    assert.match(
      calls[1].sql,
      /UPDATE\s+order_assignments/i
    );

    assert.match(
      calls[1].sql,
      /state\s*=\s*'completed'/i
    );

    assert.match(
      calls[1].sql,
      /phase\s*=\s*'in_trip'/i
    );
  }
);


await test(
  "legacy in-progress order without assignment can still complete",
  async () => {

    const {
      db
    } =
      createFakeDatabase({
        batchResults: [
          result(1),
          result(0)
        ],
        firstResults: [
          orderRow({
            status:
              "done",
            revision:
              4
          })
        ]
      });


    const transition =
      await advanceDriverOrder(
        {
          DB:
            db
        },
        "order-1",
        "driver-1",
        "done",
        4000
      );


    assert.equal(
      transition.ok,
      true
    );
  }
);


await test(
  "wrong driver cannot complete assigned order",
  async () => {

    const {
      db
    } =
      createFakeDatabase({
        batchResults: [
          result(0),
          result(0)
        ],
        firstResults: [
          orderRow({
            driver_id:
              "driver-1"
          })
        ]
      });


    const transition =
      await advanceDriverOrder(
        {
          DB:
            db
        },
        "order-1",
        "driver-2",
        "done",
        4000
      );


    assert.equal(
      transition.ok,
      false
    );

    assert.equal(
      transition.reason,
      "conflict"
    );
  }
);


await test(
  "cancel atomically revokes active assignment",
  async () => {

    const {
      db,
      calls
    } =
      createFakeDatabase({
        batchResults: [
          result(1),
          result(1)
        ],
        firstResults: [
          orderRow({
            status:
              "canceled",
            revision:
              4
          })
        ]
      });


    const transition =
      await cancelOrder(
        {
          DB:
            db
        },
        "order-1",
        5000
      );


    assert.equal(
      transition.ok,
      true
    );

    assert.equal(
      transition.order.status,
      "canceled"
    );


    assert.match(
      calls[1].sql,
      /UPDATE\s+order_assignments/i
    );

    assert.match(
      calls[1].sql,
      /state\s*=\s*'revoked'/i
    );

    assert.match(
      calls[1].sql,
      /revoked_at/i
    );
  }
);


await test(
  "unassigned legacy order can still be canceled",
  async () => {

    const {
      db
    } =
      createFakeDatabase({
        batchResults: [
          result(1),
          result(0)
        ],
        firstResults: [
          orderRow({
            status:
              "canceled",
            driver_id:
              null
          })
        ]
      });


    const transition =
      await cancelOrder(
        {
          DB:
            db
        },
        "order-1",
        5000
      );


    assert.equal(
      transition.ok,
      true
    );
  }
);


await test(
  "terminal done order cannot be canceled",
  async () => {

    const {
      db
    } =
      createFakeDatabase({
        batchResults: [
          result(0),
          result(0)
        ],
        firstResults: [
          orderRow({
            status:
              "done"
          })
        ]
      });


    const transition =
      await cancelOrder(
        {
          DB:
            db
        },
        "order-1",
        5000
      );


    assert.equal(
      transition.ok,
      false
    );

    assert.equal(
      transition.reason,
      "conflict"
    );
  }
);


await test(
  "D1 failure is rejected",
  async () => {

    const {
      db
    } =
      createFakeDatabase({
        batchResults: [
          result(0, false),
          result(0)
        ]
      });


    await assert.rejects(
      () =>
        cancelOrder(
          {
            DB:
              db
          },
          "order-1",
          5000
        ),
      /Order transition failed/
    );
  }
);


await test(
  "assignment terminal update requires valid D1 change count",
  async () => {

    const {
      db
    } =
      createFakeDatabase({
        batchResults: [
          result(1),
          result(2)
        ]
      });


    await assert.rejects(
      () =>
        cancelOrder(
          {
            DB:
              db
          },
          "order-1",
          5000
        ),
      /Invalid order assignment revocation result/
    );
  }
);


await test(
  "successful terminal transition requires order readback",
  async () => {

    const {
      db
    } =
      createFakeDatabase({
        batchResults: [
          result(1),
          result(0)
        ],
        firstResults: [
          null
        ]
      });


    await assert.rejects(
      () =>
        cancelOrder(
          {
            DB:
              db
          },
          "order-1",
          5000
        ),
      /Order transition readback failed/
    );
  }
);


await test(
  "terminal transition requires D1 binding",
  async () => {

    await assert.rejects(
      () =>
        cancelOrder(
          {},
          "order-1",
          5000
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
