import assert from "node:assert/strict";

import {
  webcrypto
} from "node:crypto";

import router from "../src/router.js";

import {
  signJWT
} from "../src/core/auth.js";


if (!globalThis.crypto) {
  globalThis.crypto =
    webcrypto;
}


// ========================================
// CONSTANTS
// ========================================

const PROXY_SECRET =
  "0123456789abcdef0123456789abcdef";

const JWT_SECRET =
  "abcdef0123456789abcdef0123456789";

const PASSENGER_ORDER_SECRET =
  "passenger-order-0123456789abcdef123456789";


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
// RESPONSE
// ========================================

async function jsonBody(
  response
) {

  return response.json();
}


// ========================================
// PROXY HMAC
// ========================================

async function proxySignature(
  timestamp,
  path,
  body
) {

  const encoder =
    new TextEncoder();


  const key =
    await crypto.subtle.importKey(
      "raw",
      encoder.encode(
        PROXY_SECRET
      ),
      {
        name:
          "HMAC",

        hash:
          "SHA-256"
      },
      false,
      [
        "sign"
      ]
    );


  const canonical =
    timestamp +
    "\n" +
    path +
    "\n" +
    body;


  const result =
    await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(
        canonical
      )
    );


  return Array
    .from(
      new Uint8Array(
        result
      )
    )
    .map(
      byte =>
        byte
          .toString(16)
          .padStart(
            2,
            "0"
          )
    )
    .join("");
}


// ========================================
// SIGNED POST
// ========================================

async function signedPost(
  path,
  payload
) {

  const body =
    JSON.stringify(
      payload
    );


  const timestamp =
    String(
      Math.floor(
        Date.now() / 1000
      )
    );


  const signature =
    await proxySignature(
      timestamp,
      path,
      body
    );


  return new Request(
    `https://worker.test${path}`,
    {
      method:
        "POST",

      headers: {
        "Content-Type":
          "application/json",

        "X-Proxy-Timestamp":
          timestamp,

        "X-Proxy-Signature":
          signature
      },

      body
    }
  );
}


// ========================================
// ORDER ROW
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
      "Комментарий",

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
      2000,

    updated_at:
      2000,

    ...overrides
  };
}


// ========================================
// FAKE D1 FOR ORDER CREATE
// ========================================

function createOrderDatabase() {

  const calls = [];


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


        async run() {

          return {
            success:
              true
          };
        },


        async first() {

          if (
            /WHERE id = \?1/i.test(
              sql
            )
          ) {

            return orderRow({
              id:
                String(
                  call.args?.[0]
                )
            });
          }


          return null;
        },


        async all() {

          return {
            success:
              true,

            results:
              []
          };
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
// FAKE D1 FOR ORDER LIST
// ========================================

function createListDatabase(
  rows
) {

  return {

    prepare() {

      const statement = {

        bind() {
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
  };
}


// ========================================
// TELEGRAM MOCK
// ========================================

async function withTelegramMock(
  fn
) {

  const originalFetch =
    globalThis.fetch;


  globalThis.fetch =
    async () => {

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
                100,

              chat: {
                id:
                  "-1001"
              }
            }
          };
        }
      };
    };


  try {

    return await fn();

  } finally {

    globalThis.fetch =
      originalFetch;
  }
}


// ========================================
// HEALTH
// ========================================

await test(
  "GET / returns service health",
  async () => {

    const response =
      await router(
        new Request(
          "https://worker.test/"
        ),
        {}
      );


    const body =
      await jsonBody(
        response
      );


    assert.equal(
      response.status,
      200
    );

    assert.equal(
      body.ok,
      true
    );

    assert.equal(
      body.service,
      "uber-v3-pro"
    );
  }
);


// ========================================
// UNKNOWN ROUTE
// ========================================

await test(
  "unknown route returns 404",
  async () => {

    const response =
      await router(
        new Request(
          "https://worker.test/unknown"
        ),
        {}
      );


    const body =
      await jsonBody(
        response
      );


    assert.equal(
      response.status,
      404
    );

    assert.equal(
      body.ok,
      false
    );

    assert.equal(
      body.error,
      "not found"
    );
  }
);


// ========================================
// DISABLED LEGACY API
// ========================================

await test(
  "legacy driver login endpoint stays disabled",
  async () => {

    const response =
      await router(
        new Request(
          "https://worker.test/drivers/login",
          {
            method:
              "POST"
          }
        ),
        {}
      );


    assert.equal(
      response.status,
      404
    );
  }
);


// ========================================
// CALCULATE METHOD
// ========================================

await test(
  "GET /calculate is rejected",
  async () => {

    const response =
      await router(
        new Request(
          "https://worker.test/calculate"
        ),
        {}
      );


    const body =
      await jsonBody(
        response
      );


    assert.equal(
      response.status,
      405
    );

    assert.equal(
      body.error,
      "method not allowed"
    );
  }
);


// ========================================
// CALCULATE REQUIRES PROXY AUTH
// ========================================

await test(
  "POST /calculate without proxy signature is forbidden",
  async () => {

    const request =
      new Request(
        "https://worker.test/calculate",
        {
          method:
            "POST",

          headers: {
            "Content-Type":
              "application/json"
          },

          body:
            JSON.stringify({
              from:
                "Нижний Новгород",

              to:
                "Москва",

              tariff:
                "comfort"
            })
        }
      );


    const response =
      await router(
        request,
        {
          PROXY_HMAC_SECRET:
            PROXY_SECRET
        }
      );


    assert.equal(
      response.status,
      403
    );
  }
);


// ========================================
// CALCULATE INPUT VALIDATION
// ========================================

await test(
  "signed /calculate rejects missing addresses",
  async () => {

    const request =
      await signedPost(
        "/calculate",
        {
          tariff:
            "comfort"
        }
      );


    const response =
      await router(
        request,
        {
          PROXY_HMAC_SECRET:
            PROXY_SECRET
        }
      );


    const body =
      await jsonBody(
        response
      );


    assert.equal(
      response.status,
      400
    );

    assert.equal(
      body.error,
      "missing from/to"
    );
  }
);


await test(
  "signed /calculate rejects invalid tariff",
  async () => {

    const request =
      await signedPost(
        "/calculate",
        {
          from:
            "Нижний Новгород",

          to:
            "Москва",

          tariff:
            "econom"
        }
      );


    const response =
      await router(
        request,
        {
          PROXY_HMAC_SECRET:
            PROXY_SECRET
        }
      );


    const body =
      await jsonBody(
        response
      );


    assert.equal(
      response.status,
      400
    );

    assert.equal(
      body.error,
      "invalid tariff"
    );
  }
);


// ========================================
// ORDER POST AUTH
// ========================================

await test(
  "POST /orders without proxy signature is forbidden",
  async () => {

    const request =
      new Request(
        "https://worker.test/orders",
        {
          method:
            "POST",

          headers: {
            "Content-Type":
              "application/json"
          },

          body:
            JSON.stringify({
              name:
                "Иван"
            })
        }
      );


    const response =
      await router(
        request,
        {
          PROXY_HMAC_SECRET:
            PROXY_SECRET
        }
      );


    assert.equal(
      response.status,
      403
    );
  }
);


// ========================================
// ORDER POST SUCCESS
// ========================================

await test(
  "signed POST /orders creates manual D1 order and passenger access token",
  async () => {

    const {
      db,
      calls
    } =
      createOrderDatabase();


    const request =
      await signedPost(
        "/orders",
        {
          name:
            "Иван",

          phone:
            "+79990000001",

          route:
            "Нижний Новгород → Москва",

          date:
            "2026-10-20",

          comment:
            "Комментарий"
        }
      );


    const response =
      await withTelegramMock(
        () =>
          router(
            request,
            {
              PROXY_HMAC_SECRET:
                PROXY_SECRET,

              PASSENGER_ORDER_SECRET:
                PASSENGER_ORDER_SECRET,

              DB:
                db,

              TG_BOT_TOKEN:
                "test-token",

              TG_CHAT_ID:
                "-1001"
            }
          )
      );


    const body =
      await jsonBody(
        response
      );


    assert.equal(
      response.status,
      201
    );

    assert.equal(
      body.ok,
      true
    );

    assert.equal(
      body.order.status,
      "new"
    );

    assert.ok(
      body.order.id
    );


    // =========================
    // PASSENGER ACCESS
    // =========================

    assert.equal(
      typeof body.accessToken,
      "string"
    );

    assert.equal(
      body.accessToken
        .split(".")
        .length,
      3
    );

    assert.ok(
      Number.isSafeInteger(
        body.accessExpiresAt
      )
    );

    assert.ok(
      body.accessExpiresAt >
        Date.now()
    );


    // =========================
    // PUBLIC RECEIPT
    // =========================

    assert.equal(
      Object.hasOwn(
        body.order,
        "phone"
      ),
      false
    );

    assert.equal(
      Object.hasOwn(
        body.order,
        "price"
      ),
      false
    );


    // =========================
    // D1 WRITE
    // =========================

    assert.ok(
      calls.some(
        call =>
          /INSERT INTO orders/i.test(
            call.sql
          )
      )
    );
  }
);


// ========================================
// ORDER ACCESS CONFIG
// ========================================

await test(
  "POST /orders does not persist order when passenger access is unavailable",
  async () => {

    const {
      db,
      calls
    } =
      createOrderDatabase();


    const request =
      await signedPost(
        "/orders",
        {
          name:
            "Иван",

          phone:
            "+79990000001",

          route:
            "Нижний Новгород → Москва",

          date:
            "2026-10-20",

          comment:
            ""
        }
      );


    const originalError =
      console.error;

    console.error =
      () => {};


    try {

      const response =
        await router(
          request,
          {
            PROXY_HMAC_SECRET:
              PROXY_SECRET,

            DB:
              db
          }
        );


      const body =
        await jsonBody(
          response
        );


      assert.equal(
        response.status,
        500
      );

      assert.equal(
        body.ok,
        false
      );

      assert.equal(
        body.error,
        "order access unavailable"
      );


      // createOrder() не должен
      // был обратиться к D1.
      assert.equal(
        calls.length,
        0
      );

    } finally {

      console.error =
        originalError;
    }
  }
);


// ========================================
// ORDER GET AUTH
// ========================================

await test(
  "GET /orders without JWT returns 401",
  async () => {

    const response =
      await router(
        new Request(
          "https://worker.test/orders"
        ),
        {
          JWT_SECRET:
            JWT_SECRET
        }
      );


    const body =
      await jsonBody(
        response
      );


    assert.equal(
      response.status,
      401
    );

    assert.equal(
      body.error,
      "authorization required"
    );
  }
);


// ========================================
// ADMIN ORDER LIST
// ========================================

await test(
  "admin GET /orders sees customer PII",
  async () => {

    const token =
      await signJWT(
        JWT_SECRET,
        {
          id:
            "admin-1",

          role:
            "admin"
        }
      );


    const db =
      createListDatabase([
        orderRow({
          id:
            "order-new",

          created_at:
            3000
        }),

        orderRow({
          id:
            "order-old",

          status:
            "done",

          created_at:
            1000
        })
      ]);


    const response =
      await router(
        new Request(
          "https://worker.test/orders",
          {
            headers: {
              Authorization:
                `Bearer ${token}`
            }
          }
        ),
        {
          JWT_SECRET:
            JWT_SECRET,

          DB:
            db
        }
      );


    const body =
      await jsonBody(
        response
      );


    assert.equal(
      response.status,
      200
    );

    assert.equal(
      body.ok,
      true
    );

    assert.equal(
      body.total,
      2
    );

    assert.equal(
      body.count,
      2
    );

    assert.equal(
      body.orders[0].id,
      "order-new"
    );

    assert.equal(
      body.orders[0].name,
      "Иван"
    );

    assert.equal(
      body.orders[0].phone,
      "+79990000001"
    );

    assert.equal(
      body.orders[0].comment,
      "Комментарий"
    );
  }
);


// ========================================
// STATUS FILTER
// ========================================

await test(
  "admin order status filter is applied",
  async () => {

    const token =
      await signJWT(
        JWT_SECRET,
        {
          id:
            "admin-1",

          role:
            "admin"
        }
      );


    const db =
      createListDatabase([
        orderRow({
          id:
            "new-order",

          status:
            "new",

          created_at:
            3000
        }),

        orderRow({
          id:
            "done-order",

          status:
            "done",

          created_at:
            2000
        })
      ]);


    const response =
      await router(
        new Request(
          "https://worker.test/orders?status=done",
          {
            headers: {
              Authorization:
                `Bearer ${token}`
            }
          }
        ),
        {
          JWT_SECRET:
            JWT_SECRET,

          DB:
            db
        }
      );


    const body =
      await jsonBody(
        response
      );


    assert.equal(
      response.status,
      200
    );

    assert.equal(
      body.total,
      1
    );

    assert.equal(
      body.orders[0].id,
      "done-order"
    );

    assert.equal(
      body.status,
      "done"
    );
  }
);


// ========================================
// INVALID STATUS
// ========================================

await test(
  "invalid order status filter is rejected",
  async () => {

    const token =
      await signJWT(
        JWT_SECRET,
        {
          id:
            "admin-1",

          role:
            "admin"
        }
      );


    const response =
      await router(
        new Request(
          "https://worker.test/orders?status=arrived",
          {
            headers: {
              Authorization:
                `Bearer ${token}`
            }
          }
        ),
        {
          JWT_SECRET:
            JWT_SECRET
        }
      );


    const body =
      await jsonBody(
        response
      );


    assert.equal(
      response.status,
      400
    );

    assert.equal(
      body.error,
      "invalid status"
    );
  }
);


// ========================================
// DRIVER VISIBILITY
// ========================================

await test(
  "driver sees new orders and own assigned orders only",
  async () => {

    const token =
      await signJWT(
        JWT_SECRET,
        {
          id:
            "driver-1",

          role:
            "driver"
        }
      );


    const db =
      createListDatabase([
        orderRow({
          id:
            "new-order",

          status:
            "new",

          driver_id:
            null,

          created_at:
            3000
        }),

        orderRow({
          id:
            "own-order",

          status:
            "taken",

          driver_id:
            "driver-1",

          created_at:
            2000
        }),

        orderRow({
          id:
            "other-order",

          status:
            "taken",

          driver_id:
            "driver-2",

          created_at:
            1000
        })
      ]);


    const drivers = {

      async get(
        key
      ) {

        assert.equal(
          key,
          "driver-1"
        );


        return JSON.stringify({
          id:
            "driver-1",

          status:
            "approved"
        });
      }
    };


    const response =
      await router(
        new Request(
          "https://worker.test/orders",
          {
            headers: {
              Authorization:
                `Bearer ${token}`
            }
          }
        ),
        {
          JWT_SECRET:
            JWT_SECRET,

          DB:
            db,

          DRIVERS:
            drivers
        }
      );


    const body =
      await jsonBody(
        response
      );


    assert.equal(
      response.status,
      200
    );

    assert.equal(
      body.total,
      2
    );

    assert.equal(
      body.orders.length,
      2
    );


    const newOrder =
      body.orders.find(
        item =>
          item.id ===
          "new-order"
      );


    const ownOrder =
      body.orders.find(
        item =>
          item.id ===
          "own-order"
      );


    assert.ok(
      newOrder
    );

    assert.ok(
      ownOrder
    );


    // Новый неназначенный заказ:
    // PII скрыта.
    assert.equal(
      Object.hasOwn(
        newOrder,
        "name"
      ),
      false
    );

    assert.equal(
      Object.hasOwn(
        newOrder,
        "phone"
      ),
      false
    );


    // Собственный заказ:
    // PII доступна.
    assert.equal(
      ownOrder.name,
      "Иван"
    );

    assert.equal(
      ownOrder.phone,
      "+79990000001"
    );


    assert.equal(
      body.orders.some(
        item =>
          item.id ===
          "other-order"
      ),
      false
    );
  }
);


// ========================================
// DRIVER ACCOUNT STATUS
// ========================================

await test(
  "unapproved driver cannot read orders",
  async () => {

    const token =
      await signJWT(
        JWT_SECRET,
        {
          id:
            "driver-1",

          role:
            "driver"
        }
      );


    const response =
      await router(
        new Request(
          "https://worker.test/orders",
          {
            headers: {
              Authorization:
                `Bearer ${token}`
            }
          }
        ),
        {
          JWT_SECRET:
            JWT_SECRET,

          DRIVERS: {

            async get() {

              return JSON.stringify({
                id:
                  "driver-1",

                status:
                  "pending"
              });
            }
          }
        }
      );


    const body =
      await jsonBody(
        response
      );


    assert.equal(
      response.status,
      403
    );

    assert.equal(
      body.error,
      "driver not approved"
    );
  }
);


// ========================================
// ROLE
// ========================================

await test(
  "passenger JWT cannot access private order list",
  async () => {

    const token =
      await signJWT(
        JWT_SECRET,
        {
          id:
            "passenger-1",

          role:
            "passenger"
        }
      );


    const response =
      await router(
        new Request(
          "https://worker.test/orders",
          {
            headers: {
              Authorization:
                `Bearer ${token}`
            }
          }
        ),
        {
          JWT_SECRET:
            JWT_SECRET
        }
      );


    const body =
      await jsonBody(
        response
      );


    assert.equal(
      response.status,
      403
    );

    assert.equal(
      body.error,
      "forbidden"
    );
  }
);


// ========================================
// LIMIT
// ========================================

await test(
  "GET /orders clamps limit to 200",
  async () => {

    const token =
      await signJWT(
        JWT_SECRET,
        {
          id:
            "admin-1",

          role:
            "admin"
        }
      );


    const db =
      createListDatabase([
        orderRow()
      ]);


    const response =
      await router(
        new Request(
          "https://worker.test/orders?limit=9999",
          {
            headers: {
              Authorization:
                `Bearer ${token}`
            }
          }
        ),
        {
          JWT_SECRET:
            JWT_SECRET,

          DB:
            db
        }
      );


    const body =
      await jsonBody(
        response
      );


    assert.equal(
      response.status,
      200
    );

    assert.equal(
      body.limit,
      200
    );
  }
);


console.log("");

if (!process.exitCode) {

  console.log(
    "✓ ALL ROUTER TESTS PASSED"
  );
}