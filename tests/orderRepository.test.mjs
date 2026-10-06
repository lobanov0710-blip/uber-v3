import assert from "node:assert/strict";

import {
  listOrders
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
// FAKE D1
// ========================================

function createFakeDatabase(
  options = {}
) {

  const calls = [];

  const allResult =
    options.allResult ?? {
      success: true,
      results: []
    };

  const allError =
    options.allError ??
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

      return {

        bind(...args) {

          call.args =
            args;

          return this;
        },

        async all() {

          if (allError) {
            throw allError;
          }

          return allResult;
        }
      };
    }
  };

  return {
    db,
    calls
  };
}


// ========================================
// SAMPLE ROWS
// ========================================

function sampleRows() {

  return [
    {
      id:
        "order-newer",

      quote_id:
        "11111111-1111-4111-8111-111111111111",

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
        "Встреча у подъезда",

      tariff:
        "comfort",

      distance_km:
        420,

      duration_minutes:
        360,

      price_rub:
        23100,

      status:
        "new",

      driver_id:
        null,

      created_at:
        2000,

      updated_at:
        2000
    },

    {
      id:
        "order-older",

      quote_id:
        null,

      name:
        "Пётр",

      phone:
        "+79990000002",

      route:
        "Москва → Тверь",

      from_place:
        "Москва",

      to_place:
        "Тверь",

      trip_date:
        "2026-10-21",

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
        "taken",

      driver_id:
        "driver-1",

      created_at:
        1000,

      updated_at:
        1500
    }
  ];
}


// ========================================
// D1 READ
// ========================================

await test(
  "order list is read from D1",
  async () => {

    const {
      db,
      calls
    } =
      createFakeDatabase(
        {
          allResult: {
            success: true,
            results:
              sampleRows()
          }
        }
      );

    const orders =
      await listOrders(
        {
          DB: db
        },
        100
      );

    assert.equal(
      calls.length,
      1
    );

    assert.match(
      calls[0].sql,
      /FROM orders/i
    );

    assert.match(
      calls[0].sql,
      /ORDER BY created_at DESC/i
    );

    assert.match(
      calls[0].sql,
      /LIMIT \?1/i
    );

    assert.deepEqual(
      calls[0].args,
      [100]
    );

    assert.equal(
      orders.length,
      2
    );
  }
);


// ========================================
// ROW -> DOMAIN MAPPING
// ========================================

await test(
  "D1 rows are mapped to order domain objects",
  async () => {

    const {
      db
    } =
      createFakeDatabase(
        {
          allResult: {
            success: true,
            results:
              sampleRows()
          }
        }
      );

    const orders =
      await listOrders(
        {
          DB: db
        },
        100
      );

    const first =
      orders[0];

    assert.equal(
      first.id,
      "order-newer"
    );

    assert.equal(
      first.quoteId,
      "11111111-1111-4111-8111-111111111111"
    );

    assert.equal(
      first.name,
      "Иван"
    );

    assert.equal(
      first.phone,
      "+79990000001"
    );

    assert.equal(
      first.from,
      "Нижний Новгород"
    );

    assert.equal(
      first.to,
      "Москва"
    );

    assert.equal(
      first.date,
      "2026-10-20"
    );

    assert.equal(
      first.tariff,
      "comfort"
    );

    assert.equal(
      first.distance,
      420
    );

    assert.equal(
      first.duration,
      360
    );

    assert.equal(
      first.price,
      23100
    );

    assert.equal(
      first.status,
      "new"
    );

    assert.equal(
      first.driverId,
      null
    );

    assert.equal(
      first.createdAt,
      2000
    );

    assert.equal(
      first.updatedAt,
      2000
    );
  }
);


// ========================================
// NULLABLE FIELDS
// ========================================

await test(
  "manual order nullable fields are preserved",
  async () => {

    const {
      db
    } =
      createFakeDatabase(
        {
          allResult: {
            success: true,
            results: [
              sampleRows()[1]
            ]
          }
        }
      );

    const orders =
      await listOrders(
        {
          DB: db
        }
      );

    const order =
      orders[0];

    assert.equal(
      order.quoteId,
      null
    );

    assert.equal(
      order.tariff,
      null
    );

    assert.equal(
      order.distance,
      null
    );

    assert.equal(
      order.duration,
      null
    );

    assert.equal(
      order.price,
      null
    );

    assert.equal(
      order.driverId,
      "driver-1"
    );
  }
);


// ========================================
// LIMIT
// ========================================

await test(
  "order list limit is capped at 1000",
  async () => {

    const {
      db,
      calls
    } =
      createFakeDatabase();

    await listOrders(
      {
        DB: db
      },
      5000
    );

    assert.deepEqual(
      calls[0].args,
      [1000]
    );
  }
);


await test(
  "invalid order list limit falls back to 1000",
  async () => {

    const {
      db,
      calls
    } =
      createFakeDatabase();

    await listOrders(
      {
        DB: db
      },
      "invalid"
    );

    assert.deepEqual(
      calls[0].args,
      [1000]
    );
  }
);


// ========================================
// EMPTY RESULT
// ========================================

await test(
  "empty D1 result returns empty order list",
  async () => {

    const {
      db
    } =
      createFakeDatabase(
        {
          allResult: {
            success: true,
            results: []
          }
        }
      );

    const orders =
      await listOrders(
        {
          DB: db
        }
      );

    assert.deepEqual(
      orders,
      []
    );
  }
);


// ========================================
// D1 FAILURE
// ========================================

await test(
  "unsuccessful D1 read is rejected",
  async () => {

    const {
      db
    } =
      createFakeDatabase(
        {
          allResult: {
            success: false,
            results: []
          }
        }
      );

    await assert.rejects(
      () =>
        listOrders(
          {
            DB: db
          }
        ),

      /Order list read failed/
    );
  }
);


await test(
  "D1 read exception propagates",
  async () => {

    const {
      db
    } =
      createFakeDatabase(
        {
          allError:
            new Error(
              "D1 unavailable"
            )
        }
      );

    await assert.rejects(
      () =>
        listOrders(
          {
            DB: db
          }
        ),

      /D1 unavailable/
    );
  }
);


// ========================================
// REQUIRED DB
// ========================================

await test(
  "order list requires D1 binding",
  async () => {

    await assert.rejects(
      () =>
        listOrders(
          {}
        ),

      /D1 DB binding is not configured/
    );
  }
);


console.log("");

if (!process.exitCode) {

  console.log(
    "✓ ALL ORDER REPOSITORY TESTS PASSED"
  );
}