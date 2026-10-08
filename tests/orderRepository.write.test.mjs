import assert from "node:assert/strict";

import {
  getOrderById,
  getOrderByQuoteId,
  insertManualOrder,
  insertQuotedOrder
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

const QUOTE_ID =
  "11111111-1111-4111-8111-111111111111";


function manualOrderRow(
  overrides = {}
) {

  return {
    id:
      "manual-order-1",

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


function quotedOrderRow(
  overrides = {}
) {

  return {
    id:
      "quoted-order-1",

    quote_id:
      QUOTE_ID,

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
      2000,

    ...overrides
  };
}


function manualOrder() {

  return {
    id:
      "manual-order-1",

    name:
      "Иван",

    phone:
      "+79990000001",

    route:
      "Нижний Новгород → Москва",

    from:
      "Нижний Новгород",

    to:
      "Москва",

    date:
      "2026-10-20",

    comment:
      "",

    status:
      "new",

    createdAt:
      1000,

    updatedAt:
      1000
  };
}


function quotedOrder() {

  return {
    id:
      "quoted-order-1",

    quoteId:
      QUOTE_ID,

    name:
      "Иван",

    phone:
      "+79990000001",

    date:
      "2026-10-20",

    comment:
      "Встреча у подъезда",

    status:
      "new",

    createdAt:
      2000,

    updatedAt:
      2000
  };
}


// ========================================
// FAKE D1
// ========================================

function createFakeDatabase(
  options = {}
) {

  const calls = [];

  const batchCalls = [];

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
      success: true
    };

  const runError =
    options.runError ??
    null;

  const batchResult =
    options.batchResult ?? [
      {
        success: true
      },
      {
        success: true
      }
    ];

  const batchError =
    options.batchError ??
    null;


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

        __call:
          call,

        bind(...args) {

          call.args =
            args;

          return statement;
        },

        async first() {

          if (
            firstResults.length ===
            0
          ) {

            return null;
          }

          return firstResults.shift();
        },

        async run() {

          if (runError) {
            throw runError;
          }

          return runResult;
        }
      };


      return statement;
    },


    async batch(
      statements
    ) {

      batchCalls.push(
        statements
      );

      if (batchError) {
        throw batchError;
      }

      return batchResult;
    }
  };


  return {
    db,
    calls,
    batchCalls
  };
}


// ========================================
// GET ORDER BY ID
// ========================================

await test(
  "order is read from D1 by id",
  async () => {

    const {
      db,
      calls
    } =
      createFakeDatabase(
        {
          firstResults: [
            quotedOrderRow()
          ]
        }
      );


    const order =
      await getOrderById(
        {
          DB: db
        },
        "quoted-order-1"
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
      /WHERE id = \?1/i
    );

    assert.deepEqual(
      calls[0].args,
      [
        "quoted-order-1"
      ]
    );


    assert.equal(
      order.id,
      "quoted-order-1"
    );

    assert.equal(
      order.quoteId,
      QUOTE_ID
    );

    assert.equal(
      order.price,
      23100
    );
  }
);


// ========================================
// GET ORDER BY QUOTE ID
// ========================================

await test(
  "order is read from D1 by quote id",
  async () => {

    const {
      db,
      calls
    } =
      createFakeDatabase(
        {
          firstResults: [
            quotedOrderRow()
          ]
        }
      );


    const order =
      await getOrderByQuoteId(
        {
          DB: db
        },
        QUOTE_ID
      );


    assert.equal(
      calls.length,
      1
    );

    assert.match(
      calls[0].sql,
      /WHERE quote_id = \?1/i
    );

    assert.deepEqual(
      calls[0].args,
      [
        QUOTE_ID
      ]
    );

    assert.equal(
      order.quoteId,
      QUOTE_ID
    );
  }
);


// ========================================
// MANUAL ORDER INSERT
// ========================================

await test(
  "manual order is persisted in D1",
  async () => {

    const {
      db,
      calls
    } =
      createFakeDatabase(
        {
          firstResults: [
            manualOrderRow()
          ]
        }
      );


    const result =
      await insertManualOrder(
        {
          DB: db
        },
        manualOrder()
      );


    assert.equal(
      calls.length,
      2
    );


    assert.match(
      calls[0].sql,
      /INSERT INTO orders/i
    );

    assert.match(
      calls[0].sql,
      /VALUES/i
    );


    assert.deepEqual(
      calls[0].args,
      [
        "manual-order-1",
        "Иван",
        "+79990000001",
        "Нижний Новгород → Москва",
        "Нижний Новгород",
        "Москва",
        "2026-10-20",
        "",
        "new",
        1000,
        1000
      ]
    );


    assert.match(
      calls[1].sql,
      /WHERE id = \?1/i
    );


    assert.equal(
      result.ok,
      true
    );

    assert.equal(
      result.created,
      true
    );

    assert.equal(
      result.idempotent,
      false
    );

    assert.equal(
      result.order.id,
      "manual-order-1"
    );

    assert.equal(
      result.order.quoteId,
      null
    );
  }
);


// ========================================
// MANUAL ORDER D1 FAILURE
// ========================================

await test(
  "manual order insert failure is rejected",
  async () => {

    const {
      db
    } =
      createFakeDatabase(
        {
          runResult: {
            success: false
          }
        }
      );


    await assert.rejects(
      () =>
        insertManualOrder(
          {
            DB: db
          },
          manualOrder()
        ),

      /Manual order insert failed/
    );
  }
);


// ========================================
// MANUAL ORDER READBACK FAILURE
// ========================================

await test(
  "manual order requires successful readback",
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
        insertManualOrder(
          {
            DB: db
          },
          manualOrder()
        ),

      /Manual order readback failed/
    );
  }
);


// ========================================
// QUOTED ORDER IDEMPOTENT FAST PATH
// ========================================

await test(
  "existing quote order returns idempotently without new batch",
  async () => {

    const existing =
      quotedOrderRow(
        {
          id:
            "existing-order"
        }
      );


    const {
      db,
      calls,
      batchCalls
    } =
      createFakeDatabase(
        {
          firstResults: [
            existing
          ]
        }
      );


    const result =
      await insertQuotedOrder(
        {
          DB: db
        },
        quotedOrder()
      );


    assert.equal(
      calls.length,
      1
    );

    assert.match(
      calls[0].sql,
      /WHERE quote_id = \?1/i
    );

    assert.equal(
      batchCalls.length,
      0
    );


    assert.equal(
      result.ok,
      true
    );

    assert.equal(
      result.created,
      false
    );

    assert.equal(
      result.idempotent,
      true
    );

    assert.equal(
      result.order.id,
      "existing-order"
    );
  }
);


// ========================================
// QUOTED ORDER TRANSACTION
// ========================================

await test(
  "quoted order is created and quote consumed in one D1 batch",
  async () => {

    const persisted =
      quotedOrderRow();


    const {
      db,
      calls,
      batchCalls
    } =
      createFakeDatabase(
        {
          firstResults: [
            null,
            persisted
          ]
        }
      );


    const result =
      await insertQuotedOrder(
        {
          DB: db
        },
        quotedOrder()
      );


    assert.equal(
      batchCalls.length,
      1
    );

    assert.equal(
      batchCalls[0].length,
      2
    );


    const insertCall =
      batchCalls[0][0]
        .__call;

    const consumeCall =
      batchCalls[0][1]
        .__call;


    assert.match(
      insertCall.sql,
      /INSERT INTO orders/i
    );

    assert.match(
      insertCall.sql,
      /FROM quotes AS q/i
    );

    assert.match(
      insertCall.sql,
      /q\.consumed_at IS NULL/i
    );

    assert.match(
      insertCall.sql,
      /q\.expires_at > \?7/i
    );


    assert.deepEqual(
      insertCall.args,
      [
        "quoted-order-1",
        "Иван",
        "+79990000001",
        "2026-10-20",
        "Встреча у подъезда",
        "new",
        2000,
        2000,
        QUOTE_ID
      ]
    );


    assert.match(
      consumeCall.sql,
      /UPDATE quotes/i
    );

    assert.match(
      consumeCall.sql,
      /SET consumed_at = \?1/i
    );

    assert.match(
      consumeCall.sql,
      /consumed_at IS NULL/i
    );

    assert.match(
      consumeCall.sql,
      /expires_at > \?1/i
    );


    assert.deepEqual(
      consumeCall.args,
      [
        2000,
        QUOTE_ID
      ]
    );


    assert.equal(
      result.ok,
      true
    );

    assert.equal(
      result.created,
      true
    );

    assert.equal(
      result.idempotent,
      false
    );

    assert.equal(
      result.order.id,
      "quoted-order-1"
    );


    assert.ok(
      calls.some(
        call =>
          /WHERE id = \?1/i.test(
            call.sql
          )
      )
    );
  }
);


// ========================================
// CONCURRENT QUOTE USE
// ========================================

await test(
  "concurrent quoted order returns winning order idempotently",
  async () => {

    const winningOrder =
      quotedOrderRow(
        {
          id:
            "winning-order"
        }
      );


    const {
      db
    } =
      createFakeDatabase(
        {
          firstResults: [
            null,
            winningOrder
          ],

          batchError:
            new Error(
              "UNIQUE constraint failed: orders.quote_id"
            )
        }
      );


    const result =
      await insertQuotedOrder(
        {
          DB: db
        },
        quotedOrder()
      );


    assert.equal(
      result.ok,
      true
    );

    assert.equal(
      result.created,
      false
    );

    assert.equal(
      result.idempotent,
      true
    );

    assert.equal(
      result.order.id,
      "winning-order"
    );
  }
);


// ========================================
// TRANSACTION FAILURE
// ========================================

await test(
  "quoted transaction failure propagates when no concurrent order exists",
  async () => {

    const {
      db
    } =
      createFakeDatabase(
        {
          firstResults: [
            null,
            null
          ],

          batchResult: [
            {
              success: false
            },
            {
              success: true
            }
          ]
        }
      );


    await assert.rejects(
      () =>
        insertQuotedOrder(
          {
            DB: db
          },
          quotedOrder()
        ),

      /Quoted order transaction failed/
    );
  }
);


// ========================================
// QUOTE NOT AVAILABLE
// ========================================

await test(
  "unavailable quote does not create an order",
  async () => {

    const {
      db
    } =
      createFakeDatabase(
        {
          firstResults: [
            null,
            null,
            null
          ]
        }
      );


    const result =
      await insertQuotedOrder(
        {
          DB: db
        },
        quotedOrder()
      );


    assert.deepEqual(
      result,
      {
        ok: false,
        reason:
          "quote_not_available"
      }
    );
  }
);


// ========================================
// VALIDATION
// ========================================

await test(
  "quoted order requires quote id",
  async () => {

    const {
      db,
      calls
    } =
      createFakeDatabase();


    const order =
      quotedOrder();

    order.quoteId =
      "";


    await assert.rejects(
      () =>
        insertQuotedOrder(
          {
            DB: db
          },
          order
        ),

      /Invalid order quoteId/
    );


    assert.equal(
      calls.length,
      0
    );
  }
);


// ========================================
// REQUIRED DATABASE
// ========================================

await test(
  "order writes require D1 binding",
  async () => {

    await assert.rejects(
      () =>
        insertManualOrder(
          {},
          manualOrder()
        ),

      /D1 DB binding is not configured/
    );
  }
);


console.log("");

if (!process.exitCode) {

  console.log(
    "✓ ALL ORDER WRITE TESTS PASSED"
  );
}