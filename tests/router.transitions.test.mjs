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

const JWT_SECRET =
  "abcdef0123456789abcdef0123456789";


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

  } catch (
    error
  ) {

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
// DRIVER STORE
// ========================================

function createDriversStore(
  status = "approved"
) {

  return {

    async get(
      driverId
    ) {

      return JSON.stringify({
        id:
          driverId,

        status
      });
    }
  };
}


// ========================================
// TRANSITION DATABASE
// ========================================

function createTransitionDatabase(
  initialRow
) {

  const calls = [];


  let row =
    initialRow
      ? {
          ...initialRow
        }
      : null;


  const db = {

    prepare(
      sql
    ) {

      const call = {
        sql,
        args: []
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


        async run() {

          let changes =
            0;


          if (!row) {

            return {
              success:
                true,

              meta: {
                changes
              }
            };
          }


          // =========================
          // new -> taken
          // =========================

          if (
            /status = 'taken'/i.test(
              sql
            )
            &&
            /driver_id IS NULL/i.test(
              sql
            )
          ) {

            const [
              orderId,
              driverId,
              updatedAt
            ] =
              call.args;


            if (
              row.id === orderId
              &&
              row.status === "new"
              &&
              row.driver_id === null
            ) {

              row.status =
                "taken";


              row.driver_id =
                driverId;


              row.updated_at =
                Math.max(
                  Number(updatedAt),
                  Number(row.updated_at) + 1
                );


              changes =
                1;
            }


            return {
              success:
                true,

              meta: {
                changes
              }
            };
          }


          // =========================
          // driver advance
          // =========================

          if (
            /status = \?4/i.test(
              sql
            )
            &&
            /driver_id = \?2/i.test(
              sql
            )
          ) {

            const [
              orderId,
              driverId,
              expectedStatus,
              targetStatus,
              updatedAt
            ] =
              call.args;


            if (
              row.id === orderId
              &&
              row.driver_id ===
                driverId
              &&
              row.status ===
                expectedStatus
            ) {

              row.status =
                targetStatus;


              row.updated_at =
                Math.max(
                  Number(updatedAt),
                  Number(row.updated_at) + 1
                );


              changes =
                1;
            }


            return {
              success:
                true,

              meta: {
                changes
              }
            };
          }


          // =========================
          // admin cancel
          // =========================

          if (
            /status = 'canceled'/i.test(
              sql
            )
          ) {

            const [
              orderId,
              updatedAt
            ] =
              call.args;


            if (
              row.id === orderId
              &&
              [
                "new",
                "taken",
                "in_progress"
              ].includes(
                row.status
              )
            ) {

              row.status =
                "canceled";


              row.updated_at =
                Math.max(
                  Number(updatedAt),
                  Number(row.updated_at) + 1
                );


              changes =
                1;
            }


            return {
              success:
                true,

              meta: {
                changes
              }
            };
          }


          throw new Error(
            "Unexpected transition SQL"
          );
        },


        async first() {

          if (
            !/WHERE id = \?1/i.test(
              sql
            )
          ) {

            return null;
          }


          const requestedId =
            String(
              call.args[0] ??
              ""
            );


          if (
            !row
            ||
            row.id !==
              requestedId
          ) {

            return null;
          }


          return {
            ...row
          };
        }
      };


      return statement;
    }
  };


  return {
    db,
    calls,

    getRow() {

      return row
        ? {
            ...row
          }
        : null;
    }
  };
}


// ========================================
// JWT REQUEST
// ========================================

function transitionRequest(
  token,
  status,
  {
    method = "POST",
    orderId = "order-1"
  } = {}
) {

  const options = {
    method,

    headers: {
      Authorization:
        `Bearer ${token}`
    }
  };


  if (
    method === "POST"
  ) {

    options.headers[
      "Content-Type"
    ] =
      "application/json";


    options.body =
      JSON.stringify({
        status
      });
  }


  return new Request(
    `https://worker.test/orders/${orderId}/status`,
    options
  );
}


// ========================================
// METHOD
// ========================================

await test(
  "GET order transition endpoint is rejected",
  async () => {

    const response =
      await router(
        new Request(
          "https://worker.test/orders/order-1/status"
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
// AUTH REQUIRED
// ========================================

await test(
  "order transition requires staff JWT",
  async () => {

    const response =
      await router(
        new Request(
          "https://worker.test/orders/order-1/status",
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/json"
            },

            body:
              JSON.stringify({
                status:
                  "taken"
              })
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
      401
    );


    assert.equal(
      body.error,
      "authorization required"
    );
  }
);


// ========================================
// PASSENGER FORBIDDEN
// ========================================

await test(
  "passenger JWT cannot transition orders",
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
        transitionRequest(
          token,
          "taken"
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
// INVALID STATUS
// ========================================

await test(
  "invalid target status is rejected",
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
        transitionRequest(
          token,
          "arrived"
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
// DRIVER ACCOUNT STATUS
// ========================================

await test(
  "unapproved driver cannot transition orders",
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
        transitionRequest(
          token,
          "taken"
        ),
        {
          JWT_SECRET:
            JWT_SECRET,

          DRIVERS:
            createDriversStore(
              "pending"
            )
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
// DRIVER TAKE
// ========================================

await test(
  "approved driver takes a new order",
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


    const {
      db,
      getRow
    } =
      createTransitionDatabase(
        orderRow()
      );


    const response =
      await router(
        transitionRequest(
          token,
          "taken"
        ),
        {
          JWT_SECRET:
            JWT_SECRET,

          DRIVERS:
            createDriversStore(),

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
      body.order.id,
      "order-1"
    );


    assert.equal(
      body.order.status,
      "taken"
    );


    assert.equal(
      body.order.driverId,
      "driver-1"
    );


    assert.equal(
      getRow().status,
      "taken"
    );


    assert.equal(
      getRow().driver_id,
      "driver-1"
    );
  }
);


// ========================================
// COMPETING DRIVER
// ========================================

await test(
  "second driver receives conflict for claimed order",
  async () => {

    const token =
      await signJWT(
        JWT_SECRET,
        {
          id:
            "driver-2",

          role:
            "driver"
        }
      );


    const {
      db
    } =
      createTransitionDatabase(
        orderRow({
          status:
            "taken",

          driver_id:
            "driver-1",

          updated_at:
            2000
        })
      );


    const response =
      await router(
        transitionRequest(
          token,
          "taken"
        ),
        {
          JWT_SECRET:
            JWT_SECRET,

          DRIVERS:
            createDriversStore(),

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
      409
    );


    assert.equal(
      body.error,
      "order transition conflict"
    );
  }
);


// ========================================
// DRIVER START
// ========================================

await test(
  "assigned driver starts own trip",
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


    const {
      db
    } =
      createTransitionDatabase(
        orderRow({
          status:
            "taken",

          driver_id:
            "driver-1",

          updated_at:
            2000
        })
      );


    const response =
      await router(
        transitionRequest(
          token,
          "in_progress"
        ),
        {
          JWT_SECRET:
            JWT_SECRET,

          DRIVERS:
            createDriversStore(),

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
      body.order.status,
      "in_progress"
    );


    assert.equal(
      body.order.driverId,
      "driver-1"
    );
  }
);


// ========================================
// DRIVER COMPLETE
// ========================================

await test(
  "assigned driver completes own trip",
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


    const {
      db
    } =
      createTransitionDatabase(
        orderRow({
          status:
            "in_progress",

          driver_id:
            "driver-1",

          updated_at:
            3000
        })
      );


    const response =
      await router(
        transitionRequest(
          token,
          "done"
        ),
        {
          JWT_SECRET:
            JWT_SECRET,

          DRIVERS:
            createDriversStore(),

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
      body.order.status,
      "done"
    );
  }
);


// ========================================
// WRONG DRIVER
// ========================================

await test(
  "other driver cannot advance assigned order",
  async () => {

    const token =
      await signJWT(
        JWT_SECRET,
        {
          id:
            "driver-2",

          role:
            "driver"
        }
      );


    const {
      db
    } =
      createTransitionDatabase(
        orderRow({
          status:
            "taken",

          driver_id:
            "driver-1",

          updated_at:
            2000
        })
      );


    const response =
      await router(
        transitionRequest(
          token,
          "in_progress"
        ),
        {
          JWT_SECRET:
            JWT_SECRET,

          DRIVERS:
            createDriversStore(),

          DB:
            db
        }
      );


    assert.equal(
      response.status,
      409
    );
  }
);


// ========================================
// DRIVER CANNOT CANCEL
// ========================================

await test(
  "driver cannot cancel an order",
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


    const {
      db,
      calls
    } =
      createTransitionDatabase(
        orderRow({
          status:
            "taken",

          driver_id:
            "driver-1"
        })
      );


    const response =
      await router(
        transitionRequest(
          token,
          "canceled"
        ),
        {
          JWT_SECRET:
            JWT_SECRET,

          DRIVERS:
            createDriversStore(),

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
      403
    );


    assert.equal(
      body.error,
      "forbidden transition"
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
  "admin cancels a non-terminal order",
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


    const {
      db
    } =
      createTransitionDatabase(
        orderRow({
          status:
            "in_progress",

          driver_id:
            "driver-1",

          updated_at:
            3000
        })
      );


    const response =
      await router(
        transitionRequest(
          token,
          "canceled"
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
      body.order.status,
      "canceled"
    );


    assert.equal(
      body.order.driverId,
      "driver-1"
    );
  }
);


// ========================================
// ADMIN CANNOT IMPERSONATE DRIVER
// ========================================

await test(
  "admin cannot perform driver workflow transition",
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


    const {
      db,
      calls
    } =
      createTransitionDatabase(
        orderRow()
      );


    const response =
      await router(
        transitionRequest(
          token,
          "taken"
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
      403
    );


    assert.equal(
      body.error,
      "forbidden transition"
    );


    assert.equal(
      calls.length,
      0
    );
  }
);


// ========================================
// TERMINAL STATE
// ========================================

await test(
  "admin cannot cancel a done order",
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


    const {
      db
    } =
      createTransitionDatabase(
        orderRow({
          status:
            "done",

          driver_id:
            "driver-1",

          updated_at:
            4000
        })
      );


    const response =
      await router(
        transitionRequest(
          token,
          "canceled"
        ),
        {
          JWT_SECRET:
            JWT_SECRET,

          DB:
            db
        }
      );


    assert.equal(
      response.status,
      409
    );
  }
);


// ========================================
// MISSING ORDER
// ========================================

await test(
  "transition of missing order returns 404",
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


    const {
      db
    } =
      createTransitionDatabase(
        null
      );


    const response =
      await router(
        transitionRequest(
          token,
          "canceled",
          {
            orderId:
              "missing-order"
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
      404
    );


    assert.equal(
      body.error,
      "order not found"
    );
  }
);


console.log("");


if (!process.exitCode) {

  console.log(
    "✓ ALL ROUTER TRANSITION TESTS PASSED"
  );
}