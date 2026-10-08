import assert from "node:assert/strict";

import {
  randomUUID,
  webcrypto
} from "node:crypto";

import {
  createOrder,
  orderReceipt
} from "../src/core/orders.js";


if (!globalThis.crypto) {
  globalThis.crypto = webcrypto;
}

if (
  typeof globalThis.crypto.randomUUID !==
  "function"
) {
  globalThis.crypto.randomUUID =
    randomUUID;
}


const QUOTE_ID =
  "11111111-1111-4111-8111-111111111111";


// ========================================
// TEST RUNNER
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
// ROWS
// ========================================

function quoteRow(
  overrides = {}
) {

  return {
    id:
      QUOTE_ID,

    from_place:
      "Нижний Новгород",

    to_place:
      "Москва",

    tariff:
      "comfort",

    tariff_name:
      "Комфорт",

    distance_km:
      420,

    duration_minutes:
      360,

    price_rub:
      23100,

    price_per_km:
      55,

    coefficient:
      1,

    minimum_price_rub:
      4000,

    created_at:
      Date.now() - 1000,

    expires_at:
      Date.now() + 600000,

    consumed_at:
      null,

    ...overrides
  };
}


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
      Date.now(),

    updated_at:
      Date.now(),

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
      Date.now(),

    updated_at:
      Date.now(),

    ...overrides
  };
}


// ========================================
// INPUT
// ========================================

function manualInput(
  overrides = {}
) {

  return {
    name:
      "Иван",

    phone:
      "+79990000001",

    route:
      "Нижний Новгород → Москва",

    date:
      "2026-10-20",

    comment:
      "",

    ...overrides
  };
}


function quotedInput(
  overrides = {}
) {

  return {
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
// TELEGRAM MOCK
// ========================================

function telegramSuccessFetch(
  calls
) {

  return async (
    url,
    options
  ) => {

    calls.push({
      url,
      options
    });


    return {
      ok:
        true,

      status:
        200,

      statusText:
        "OK",

      async json() {

        return {
          ok:
            true,

          result: {
            message_id:
              123,

            chat: {
              id:
                "-100123"
            }
          }
        };
      }
    };
  };
}


function telegramFailureFetch(
  calls
) {

  return async (
    url,
    options
  ) => {

    calls.push({
      url,
      options
    });


    return {
      ok:
        false,

      status:
        500,

      statusText:
        "Internal Server Error",

      async json() {

        return {
          ok:
            false,

          error_code:
            500,

          description:
            "Telegram unavailable"
        };
      }
    };
  };
}


async function withFetch(
  mock,
  fn
) {

  const originalFetch =
    globalThis.fetch;

  globalThis.fetch =
    mock;

  try {

    return await fn();

  } finally {

    if (originalFetch) {

      globalThis.fetch =
        originalFetch;

    } else {

      delete globalThis.fetch;
    }
  }
}


// ========================================
// ENV
// ========================================

function envWithDatabase(
  db
) {

  return {
    DB:
      db,

    TG_BOT_TOKEN:
      "test-token",

    TG_CHAT_ID:
      "-100123"
  };
}


// ========================================
// INVALID INPUT
// ========================================

await test(
  "invalid order object is rejected",
  async () => {

    const result =
      await createOrder(
        null,
        {}
      );


    assert.deepEqual(
      result,
      {
        ok:
          false,

        status:
          400,

        error:
          "invalid order data"
      }
    );
  }
);


await test(
  "missing customer name is rejected",
  async () => {

    const result =
      await createOrder(
        manualInput({
          name:
            ""
        }),
        {}
      );


    assert.equal(
      result.ok,
      false
    );

    assert.equal(
      result.status,
      400
    );

    assert.equal(
      result.error,
      "missing name"
    );
  }
);


await test(
  "invalid phone is rejected",
  async () => {

    const result =
      await createOrder(
        manualInput({
          phone:
            "123"
        }),
        {}
      );


    assert.equal(
      result.ok,
      false
    );

    assert.equal(
      result.error,
      "invalid phone"
    );
  }
);


await test(
  "invalid trip date is rejected",
  async () => {

    const result =
      await createOrder(
        manualInput({
          date:
            "20.10.2026"
        }),
        {}
      );


    assert.equal(
      result.ok,
      false
    );

    assert.equal(
      result.error,
      "invalid date"
    );
  }
);


await test(
  "manual order requires route",
  async () => {

    const result =
      await createOrder(
        manualInput({
          route:
            ""
        }),
        {}
      );


    assert.equal(
      result.ok,
      false
    );

    assert.equal(
      result.status,
      400
    );

    assert.equal(
      result.error,
      "missing route"
    );
  }
);


// ========================================
// MANUAL ORDER
// ========================================

await test(
  "manual order is persisted and sends Telegram once",
  async () => {

    const telegramCalls = [];


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
      await withFetch(
        telegramSuccessFetch(
          telegramCalls
        ),

        () =>
          createOrder(
            manualInput(),
            envWithDatabase(
              db
            )
          )
      );


    assert.equal(
      result.ok,
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


    assert.match(
      calls[0].sql,
      /INSERT INTO orders/i
    );


    assert.equal(
      calls[0].args[3],
      "Нижний Новгород → Москва"
    );

    assert.equal(
      calls[0].args[4],
      "Нижний Новгород"
    );

    assert.equal(
      calls[0].args[5],
      "Москва"
    );


    assert.equal(
      telegramCalls.length,
      1
    );


    const telegramBody =
      JSON.parse(
        telegramCalls[0]
          .options
          .body
      );


    assert.equal(
      telegramBody.chat_id,
      "-100123"
    );

    assert.match(
      telegramBody.text,
      /Новая заявка/
    );

    assert.match(
      telegramBody.text,
      /Нижний Новгород → Москва/
    );

    assert.match(
      telegramBody.text,
      /20\.10\.2026/
    );
  }
);


// ========================================
// TELEGRAM FAILURE
// ========================================

await test(
  "Telegram failure does not roll back persisted order",
  async () => {

    const telegramCalls = [];


    const {
      db
    } =
      createFakeDatabase(
        {
          firstResults: [
            manualOrderRow()
          ]
        }
      );


    const originalError =
      console.error;

    console.error =
      () => {};


    try {

      const result =
        await withFetch(
          telegramFailureFetch(
            telegramCalls
          ),

          () =>
            createOrder(
              manualInput(),
              envWithDatabase(
                db
              )
            )
        );


      assert.equal(
        result.ok,
        true
      );

      assert.equal(
        result.order.id,
        "manual-order-1"
      );

      assert.equal(
        telegramCalls.length,
        1
      );

    } finally {

      console.error =
        originalError;
    }
  }
);


// ========================================
// QUOTED ORDER
// ========================================

await test(
  "quoted order uses authoritative D1 quote and sends Telegram",
  async () => {

    const telegramCalls = [];


    const {
      db,
      batchCalls
    } =
      createFakeDatabase(
        {
          firstResults: [
            null,
            quoteRow(),
            null,
            quotedOrderRow()
          ]
        }
      );


    const result =
      await withFetch(
        telegramSuccessFetch(
          telegramCalls
        ),

        () =>
          createOrder(
            quotedInput({
              route:
                "FAKE ROUTE",

              tariff:
                "business",

              distance:
                1,

              duration:
                1,

              price:
                1
            }),
            envWithDatabase(
              db
            )
          )
      );


    assert.equal(
      result.ok,
      true
    );

    assert.equal(
      result.idempotent,
      false
    );

    assert.equal(
      result.order.route,
      "Нижний Новгород → Москва"
    );

    assert.equal(
      result.order.tariff,
      "comfort"
    );

    assert.equal(
      result.order.distance,
      420
    );

    assert.equal(
      result.order.duration,
      360
    );

    assert.equal(
      result.order.price,
      23100
    );


    assert.equal(
      batchCalls.length,
      1
    );


    const insertCall =
      batchCalls[0][0]
        .__call;


    assert.match(
      insertCall.sql,
      /FROM quotes AS q/i
    );

    assert.match(
      insertCall.sql,
      /q\.tariff/i
    );

    assert.match(
      insertCall.sql,
      /q\.price_rub/i
    );


    assert.equal(
      telegramCalls.length,
      1
    );


    const telegramBody =
      JSON.parse(
        telegramCalls[0]
          .options
          .body
      );


    assert.match(
      telegramBody.text,
      /Комфорт/
    );

    assert.match(
      telegramBody.text,
      /420/
    );

    assert.match(
      telegramBody.text,
      /23/
    );
  }
);


// ========================================
// IDEMPOTENT RETRY
// ========================================

await test(
  "same quoted order retry is idempotent and does not resend Telegram",
  async () => {

    const telegramCalls = [];


    const {
      db,
      batchCalls
    } =
      createFakeDatabase(
        {
          firstResults: [
            quotedOrderRow()
          ]
        }
      );


    const result =
      await withFetch(
        telegramSuccessFetch(
          telegramCalls
        ),

        () =>
          createOrder(
            quotedInput(),
            envWithDatabase(
              db
            )
          )
      );


    assert.equal(
      result.ok,
      true
    );

    assert.equal(
      result.idempotent,
      true
    );

    assert.equal(
      result.order.id,
      "quoted-order-1"
    );

    assert.equal(
      batchCalls.length,
      0
    );

    assert.equal(
      telegramCalls.length,
      0
    );
  }
);


// ========================================
// QUOTE REUSE WITH DIFFERENT CUSTOMER DATA
// ========================================

await test(
  "same quote cannot be reused with different customer data",
  async () => {

    const telegramCalls = [];


    const {
      db,
      batchCalls
    } =
      createFakeDatabase(
        {
          firstResults: [
            quotedOrderRow()
          ]
        }
      );


    const result =
      await withFetch(
        telegramSuccessFetch(
          telegramCalls
        ),

        () =>
          createOrder(
            quotedInput({
              name:
                "Пётр"
            }),
            envWithDatabase(
              db
            )
          )
      );


    assert.equal(
      result.ok,
      false
    );

    assert.equal(
      result.status,
      409
    );

    assert.equal(
      result.error,
      "quote already used"
    );

    assert.equal(
      batchCalls.length,
      0
    );

    assert.equal(
      telegramCalls.length,
      0
    );
  }
);


// ========================================
// EXPIRED / MISSING QUOTE
// ========================================

await test(
  "missing or expired quote is rejected before order persistence",
  async () => {

    const telegramCalls = [];


    const {
      db,
      batchCalls
    } =
      createFakeDatabase(
        {
          firstResults: [
            null,
            null
          ]
        }
      );


    const result =
      await withFetch(
        telegramSuccessFetch(
          telegramCalls
        ),

        () =>
          createOrder(
            quotedInput(),
            envWithDatabase(
              db
            )
          )
      );


    assert.equal(
      result.ok,
      false
    );

    assert.equal(
      result.status,
      409
    );

    assert.equal(
      result.error,
      "quote expired or not found"
    );

    assert.equal(
      batchCalls.length,
      0
    );

    assert.equal(
      telegramCalls.length,
      0
    );
  }
);


// ========================================
// CONCURRENT RETRY
// ========================================

await test(
  "concurrent quote race returns winning order without duplicate Telegram",
  async () => {

    const telegramCalls = [];


    const winningOrder =
      quotedOrderRow({
        id:
          "winning-order"
      });


    const {
      db
    } =
      createFakeDatabase(
        {
          firstResults: [
            null,
            quoteRow(),
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
      await withFetch(
        telegramSuccessFetch(
          telegramCalls
        ),

        () =>
          createOrder(
            quotedInput(),
            envWithDatabase(
              db
            )
          )
      );


    assert.equal(
      result.ok,
      true
    );

    assert.equal(
      result.idempotent,
      true
    );

    assert.equal(
      result.order.id,
      "winning-order"
    );

    assert.equal(
      telegramCalls.length,
      0
    );
  }
);


// ========================================
// QUOTE BECOMES UNAVAILABLE
// ========================================

await test(
  "quote unavailable during transaction returns conflict",
  async () => {

    const telegramCalls = [];


    const {
      db
    } =
      createFakeDatabase(
        {
          firstResults: [
            null,
            quoteRow(),
            null,
            null,
            null
          ]
        }
      );


    const result =
      await withFetch(
        telegramSuccessFetch(
          telegramCalls
        ),

        () =>
          createOrder(
            quotedInput(),
            envWithDatabase(
              db
            )
          )
      );


    assert.equal(
      result.ok,
      false
    );

    assert.equal(
      result.status,
      409
    );

    assert.equal(
      result.error,
      "quote expired or already used"
    );

    assert.equal(
      telegramCalls.length,
      0
    );
  }
);


// ========================================
// INVALID QUOTE DATA
// ========================================

await test(
  "invalid tariff stored in quote is rejected",
  async () => {

    const telegramCalls = [];


    const {
      db
    } =
      createFakeDatabase(
        {
          firstResults: [
            null,

            quoteRow({
              tariff:
                "econom"
            })
          ]
        }
      );


    const result =
      await withFetch(
        telegramSuccessFetch(
          telegramCalls
        ),

        () =>
          createOrder(
            quotedInput(),
            envWithDatabase(
              db
            )
          )
      );


    assert.equal(
      result.ok,
      false
    );

    assert.equal(
      result.status,
      500
    );

    assert.equal(
      result.error,
      "invalid quote tariff"
    );

    assert.equal(
      telegramCalls.length,
      0
    );
  }
);


// ========================================
// PUBLIC RECEIPT
// ========================================

await test(
  "public order receipt exposes only public order fields",
  async () => {

    const receipt =
      orderReceipt({
        id:
          "order-1",

        status:
          "new",

        createdAt:
          123456,

        name:
          "Иван",

        phone:
          "+79990000001",

        price:
          23100
      });


    assert.deepEqual(
      receipt,
      {
        id:
          "order-1",

        status:
          "new",

        createdAt:
          123456
      }
    );
  }
);


console.log("");

if (!process.exitCode) {

  console.log(
    "✓ ALL ORDER DOMAIN TESTS PASSED"
  );
}