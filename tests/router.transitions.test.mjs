import assert from "node:assert/strict";

import {
  webcrypto
} from "node:crypto";

import router
  from "../src/router.js";

import {
  signJWT
} from "../src/core/auth.js";


if (
  !globalThis.crypto
) {

  globalThis.crypto =
    webcrypto;
}


if (
  typeof globalThis.btoa !==
    "function"
) {

  globalThis.btoa =
    value =>
      Buffer
        .from(
          value,
          "binary"
        )
        .toString(
          "base64"
        );
}


if (
  typeof globalThis.atob !==
    "function"
) {

  globalThis.atob =
    value =>
      Buffer
        .from(
          value,
          "base64"
        )
        .toString(
          "binary"
        );
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

    process.exitCode =
      1;
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

    revision:
      1,

    last_terminal_claim_id:
      null,

    ...overrides
  };
}


// ========================================
// STAFF ACCOUNT ROW
// ========================================

function staffAccountRow(
  {
    id = "driver-1",
    role = "driver",
    status = "active",
    tokenVersion = 1
  } = {}
) {

  return {
    id,

    login:
      `${role}1`,

    display_name:
      role === "admin"
        ? "Admin One"
        : "Driver One",

    role,
    status,

    password_algorithm:
      "pbkdf2-sha256",

    password_iterations:
      100000,

    password_salt:
      "aaaaaaaaaaaaaaaaaaaaaa",

    password_hash:
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",

    token_version:
      tokenVersion,

    failed_login_count:
      0,

    locked_until:
      null,

    last_failed_login_at:
      null,

    last_login_at:
      Date.now(),

    password_changed_at:
      1000,

    created_at:
      1000,

    updated_at:
      Date.now()
  };
}


// ========================================
// STAFF SESSION ROW
// ========================================

function staffSessionRow(
  {
    id = "session-driver-1",
    accountId = "driver-1",
    revokedAt = null,
    replacedBySessionId = null,
    expiresAt =
      Date.now() +
      60 * 60 * 1000
  } = {}
) {

  return {
    id,

    account_id:
      accountId,

    family_id:
      `family-${accountId}`,

    refresh_token_hash:
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",

    created_at:
      Date.now() - 1000,

    expires_at:
      expiresAt,

    last_used_at:
      null,

    revoked_at:
      revokedAt,

    replaced_by_session_id:
      replacedBySessionId
  };
}


// ========================================
// STAFF JWT
// ========================================

async function createStaffToken(
  {
    id = "driver-1",
    role = "driver",
    sessionId =
      `session-${id}`,
    tokenVersion = 1
  } = {}
) {

  return signJWT(
    JWT_SECRET,
    {
      sub:
        id,

      id,

      role,

      scope:
        "staff",

      tokenVersion,

      sid:
        sessionId
    },
    900
  );
}


// ========================================
// TRANSITION DATABASE
// ========================================

function createTransitionDatabase(
  initialRow,
  {
    staffId = "driver-1",
    role = "driver",
    staffStatus = "active",
    tokenVersion = 1,
    sessionId =
      `session-${staffId}`,
    sessionRevokedAt = null,
    sessionReplacedBy = null,
    sessionExpiresAt =
      Date.now() +
      60 * 60 * 1000
  } = {}
) {

  const calls =
    [];


  let row =
    initialRow
      ? {
          ...initialRow
        }
      : null;

  let idempotencyRecord =
    null;

  let lastOrderMutationSucceeded =
    false;

  let lastAuditMutationSucceeded =
    false;

  const auditRows =
    [];


  const db = {

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


        async run() {

          let changes =
            0;


          if (
            /INSERT OR IGNORE INTO mutation_idempotency/i.test(
              sql
            )
          ) {

            const [
              actorAccountId,
              operation,
              keyDigest,
              requestDigest,
              claimId,
              createdAt
            ] =
              call.args;


            if (
              !idempotencyRecord
            ) {

              idempotencyRecord = {
                actor_account_id:
                  actorAccountId,
                operation,
                key_digest:
                  keyDigest,
                request_digest:
                  requestDigest,
                claim_id:
                  claimId,
                state:
                  "in_progress",
                http_status:
                  null,
                result_code:
                  null,
                result_json:
                  null,
                created_at:
                  createdAt,
                completed_at:
                  null
              };

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


          if (
            /UPDATE orders/i.test(
              sql
            )
          ) {

            if (!row) {

              return {
                success:
                  true,

                meta: {
                  changes:
                    0
                }
              };
            }


            // =========================
            // D3 TERMINAL MUTATION
            // =========================

            if (
              /last_terminal_claim_id/i.test(
                sql
              )
            ) {

              lastOrderMutationSucceeded =
                false;

              lastAuditMutationSucceeded =
                false;


              if (
                /status = 'done'/i.test(
                  sql
                )
              ) {

                const [
                  orderId,
                  expectedRevision,
                  driverId,
                  updatedAt,
                  claimId,
                  actorAccountId,
                  operation,
                  keyDigest,
                  requestDigest
                ] =
                  call.args;


                if (
                  row.id ===
                    orderId
                  &&
                  Number(
                    row.revision
                  ) ===
                    Number(
                      expectedRevision
                    )
                  &&
                  row.status ===
                    "in_progress"
                  &&
                  row.driver_id ===
                    driverId
                  &&
                  idempotencyRecord
                  &&
                  idempotencyRecord.actor_account_id ===
                    actorAccountId
                  &&
                  idempotencyRecord.operation ===
                    operation
                  &&
                  idempotencyRecord.key_digest ===
                    keyDigest
                  &&
                  idempotencyRecord.request_digest ===
                    requestDigest
                  &&
                  idempotencyRecord.claim_id ===
                    claimId
                  &&
                  idempotencyRecord.state ===
                    "in_progress"
                ) {

                  row.status =
                    "done";

                  row.revision =
                    Number(
                      row.revision
                    ) + 1;

                  row.updated_at =
                    Math.max(
                      Number(
                        updatedAt
                      ),

                      Number(
                        row.updated_at
                      ) + 1
                    );

                  row.last_terminal_claim_id =
                    claimId;

                  changes =
                    1;

                  lastOrderMutationSucceeded =
                    true;
                }

              } else if (
                /status = 'canceled'/i.test(
                  sql
                )
              ) {

                const [
                  orderId,
                  expectedRevision,
                  updatedAt,
                  claimId,
                  actorAccountId,
                  operation,
                  keyDigest,
                  requestDigest
                ] =
                  call.args;


                if (
                  row.id ===
                    orderId
                  &&
                  Number(
                    row.revision
                  ) ===
                    Number(
                      expectedRevision
                    )
                  &&
                  [
                    "new",
                    "taken",
                    "in_progress"
                  ].includes(
                    row.status
                  )
                  &&
                  idempotencyRecord
                  &&
                  idempotencyRecord.actor_account_id ===
                    actorAccountId
                  &&
                  idempotencyRecord.operation ===
                    operation
                  &&
                  idempotencyRecord.key_digest ===
                    keyDigest
                  &&
                  idempotencyRecord.request_digest ===
                    requestDigest
                  &&
                  idempotencyRecord.claim_id ===
                    claimId
                  &&
                  idempotencyRecord.state ===
                    "in_progress"
                ) {

                  row.status =
                    "canceled";

                  row.revision =
                    Number(
                      row.revision
                    ) + 1;

                  row.updated_at =
                    Math.max(
                      Number(
                        updatedAt
                      ),

                      Number(
                        row.updated_at
                      ) + 1
                    );

                  row.last_terminal_claim_id =
                    claimId;

                  changes =
                    1;

                  lastOrderMutationSucceeded =
                    true;
                }
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
                row.id ===
                  orderId
                &&
                row.status ===
                  "new"
                &&
                row.driver_id ===
                  null
              ) {

                row.status =
                  "taken";

                row.driver_id =
                  driverId;

                row.updated_at =
                  Math.max(
                    Number(
                      updatedAt
                    ),

                    Number(
                      row.updated_at
                    ) + 1
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
            // DRIVER ADVANCE
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
                row.id ===
                  orderId
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
                    Number(
                      updatedAt
                    ),

                    Number(
                      row.updated_at
                    ) + 1
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
            // ADMIN CANCEL
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
                row.id ===
                  orderId
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
                    Number(
                      updatedAt
                    ),

                    Number(
                      row.updated_at
                    ) + 1
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
          }


          if (
            /UPDATE order_assignments/i.test(
              sql
            )
          ) {

            // Legacy router fixtures do not
            // model order_assignments.
            return {
              success:
                true,

              meta: {
                changes:
                  0
              }
            };
          }


          if (
            /INSERT INTO audit_events/i.test(
              sql
            )
          ) {

            lastAuditMutationSucceeded =
              false;


            if (
              lastOrderMutationSucceeded
              &&
              row
            ) {

              auditRows.push({
                id:
                  call.args[0],
                actor_account_id:
                  call.args[1],
                action:
                  call.args[2],
                target_id:
                  call.args[3]
              });

              changes =
                1;

              lastAuditMutationSucceeded =
                true;
            }


            return {
              success:
                true,

              meta: {
                changes
              }
            };
          }


          if (
            /UPDATE mutation_idempotency/i.test(
              sql
            )
          ) {

            const requiresAuditSuccess =
              /AND\s+changes\(\)\s*=\s*1/i.test(
                sql
              );


            if (
              (
                !requiresAuditSuccess
                ||
                lastAuditMutationSucceeded
              )
              &&
              idempotencyRecord
              &&
              idempotencyRecord.actor_account_id ===
                call.args[0]
              &&
              idempotencyRecord.operation ===
                call.args[1]
              &&
              idempotencyRecord.key_digest ===
                call.args[2]
              &&
              idempotencyRecord.request_digest ===
                call.args[3]
              &&
              idempotencyRecord.claim_id ===
                call.args[4]
              &&
              idempotencyRecord.state ===
                "in_progress"
            ) {

              idempotencyRecord.state =
                "completed";

              if (
                /result_json = \?6/i.test(
                  sql
                )
              ) {

                idempotencyRecord.http_status =
                  200;

                idempotencyRecord.result_code =
                  null;

                idempotencyRecord.result_json =
                  call.args[5];

                idempotencyRecord.completed_at =
                  call.args[6];

              } else {

                idempotencyRecord.http_status =
                  call.args[5];

                idempotencyRecord.result_code =
                  call.args[6];

                idempotencyRecord.result_json =
                  call.args[7];

                idempotencyRecord.completed_at =
                  call.args[8];
              }

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

          // =========================
          // IDEMPOTENCY LOOKUP
          // =========================

          if (
            /FROM mutation_idempotency/i.test(
              sql
            )
          ) {

            if (
              !idempotencyRecord
            ) {
              return null;
            }


            if (
              idempotencyRecord.actor_account_id !==
                call.args[0]
              ||
              idempotencyRecord.operation !==
                call.args[1]
              ||
              idempotencyRecord.key_digest !==
                call.args[2]
            ) {
              return null;
            }


            return {
              ...idempotencyRecord
            };
          }


          // =========================
          // OWNER BINDING
          // =========================

          if (
            /FROM staff_owner_binding/i.test(
              sql
            )
          ) {

            return (
              role === "admin"
              &&
              String(
                call.args[0] ??
                ""
              ) ===
                staffId
            )
              ? {
                  account_id:
                    staffId
                }
              : null;
          }


          // =========================
          // STAFF ACCOUNT
          // =========================

          if (
            /FROM staff_accounts/i.test(
              sql
            )
          ) {

            const requestedId =
              String(
                call.args[0] ??
                ""
              );


            if (
              requestedId !==
                staffId
            ) {

              return null;
            }


            return staffAccountRow({
              id:
                staffId,

              role,

              status:
                staffStatus,

              tokenVersion
            });
          }


          // =========================
          // STAFF SESSION
          // =========================

          if (
            /FROM staff_sessions/i.test(
              sql
            )
          ) {

            const requestedId =
              String(
                call.args[0] ??
                ""
              );


            if (
              requestedId !==
                sessionId
            ) {

              return null;
            }


            return staffSessionRow({
              id:
                sessionId,

              accountId:
                staffId,

              revokedAt:
                sessionRevokedAt,

              replacedBySessionId:
                sessionReplacedBy,

              expiresAt:
                sessionExpiresAt
            });
          }


          // =========================
          // ORDER READBACK
          // =========================

          if (
            /FROM orders/i.test(
              sql
            )
            &&
            /WHERE id = \?1/i.test(
              sql
            )
          ) {

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


          return null;
        }
      };


      return statement;
    },


    async batch(
      statements
    ) {

      return Promise.all(
        statements.map(
          statement =>
            statement.run()
        )
      );
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
    },

    countOrderUpdates() {

      return calls.filter(
        call =>
          /UPDATE orders/i.test(
            call.sql
          )
      ).length;
    }
  };
}


// ========================================
// REQUEST
// ========================================

function transitionRequest(
  token,
  status,
  {
    method = "POST",
    orderId = "order-1",
    expectedRevision = 1,
    idempotencyKey =
      "terminal-test-key"
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

    options.headers[
      "Idempotency-Key"
    ] =
      idempotencyKey;


    options.body =
      JSON.stringify({
        status,
        expectedRevision
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
// LEGACY JWT
// ========================================

await test(
  "legacy role-only JWT cannot transition orders",
  async () => {

    const token =
      await signJWT(
        JWT_SECRET,
        {
          id:
            "driver-1",

          role:
            "driver"
        },
        900
      );


    const {
      db
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
      401
    );


    assert.equal(
      body.error,
      "invalid or revoked staff token"
    );
  }
);


// ========================================
// D3 TERMINAL CONTRACT
// ========================================

await test(
  "terminal mutation requires Idempotency-Key",
  async () => {

    const token =
      await createStaffToken();

    const {
      db
    } =
      createTransitionDatabase(
        orderRow({
          status:
            "in_progress",
          driver_id:
            "driver-1"
        })
      );

    const response =
      await router(
        new Request(
          "https://worker.test/orders/order-1/status",
          {
            method:
              "POST",
            headers: {
              Authorization:
                `Bearer ${token}`,
              "Content-Type":
                "application/json"
            },
            body:
              JSON.stringify({
                status:
                  "done",
                expectedRevision:
                  1
              })
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
      400
    );

    assert.equal(
      body.code,
      "idempotency_key_required"
    );
  }
);


await test(
  "terminal mutation requires expectedRevision",
  async () => {

    const token =
      await createStaffToken();

    const {
      db
    } =
      createTransitionDatabase(
        orderRow({
          status:
            "in_progress",
          driver_id:
            "driver-1"
        })
      );

    const response =
      await router(
        new Request(
          "https://worker.test/orders/order-1/status",
          {
            method:
              "POST",
            headers: {
              Authorization:
                `Bearer ${token}`,
              "Content-Type":
                "application/json",
              "Idempotency-Key":
                "terminal-required-key"
            },
            body:
              JSON.stringify({
                status:
                  "done"
              })
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
      400
    );

    assert.equal(
      body.code,
      "invalid_revision"
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
      await createStaffToken();


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
          "arrived"
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
      400
    );


    assert.equal(
      body.error,
      "invalid status"
    );
  }
);


// ========================================
// DISABLED STAFF ACCOUNT
// ========================================

await test(
  "disabled driver account cannot transition orders",
  async () => {

    const token =
      await createStaffToken();


    const {
      db
    } =
      createTransitionDatabase(
        orderRow(),
        {
          staffStatus:
            "disabled"
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
      401
    );


    assert.equal(
      body.error,
      "invalid or revoked staff token"
    );
  }
);


// ========================================
// DRIVER SELF-TAKE IS FORBIDDEN
// ========================================

await test(
  "active driver cannot self-take a new order",
  async () => {

    const token =
      await createStaffToken({
        id:
          "driver-1",

        role:
          "driver"
      });


    const {
      db,
      getRow
    } =
      createTransitionDatabase(
        orderRow(),
        {
          staffId:
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
      getRow().status,
      "new"
    );


    assert.equal(
      getRow().driver_id,
      null
    );
  }
);


await test(
  "driver cannot take an order assigned to another driver",
  async () => {

    const token =
      await createStaffToken({
        id:
          "driver-2",

        role:
          "driver"
      });


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
        }),
        {
          staffId:
            "driver-2",

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

          DB:
            db
        }
      );


    assert.equal(
      response.status,
      403
    );
  }
);


// ========================================
// DRIVER START REQUIRES OPERATIONAL PHASE
// ========================================

await test(
  "assigned driver cannot bypass trip verification with legacy in_progress",
  async () => {

    const token =
      await createStaffToken();


    const {
      db,
      getRow
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
          "in_progress"
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
      getRow().status,
      "taken"
    );
  }
);


// ========================================
// DRIVER DONE
// ========================================

await test(
  "assigned driver completes own trip",
  async () => {

    const token =
      await createStaffToken();


    const {
      db
    } =
      createTransitionDatabase(
        orderRow({
          status:
            "in_progress",

          driver_id:
            "driver-1"
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
  "other driver cannot complete another driver's trip",
  async () => {

    const token =
      await createStaffToken({
        id:
          "driver-2",
        role:
          "driver"
      });

    const {
      db
    } =
      createTransitionDatabase(
        orderRow({
          status:
            "in_progress",
          driver_id:
            "driver-1"
        }),
        {
          staffId:
            "driver-2",
          role:
            "driver"
        }
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


await test(
  "other driver cannot use legacy trip-start transition",
  async () => {

    const token =
      await createStaffToken({
        id:
          "driver-2",

        role:
          "driver"
      });


    const {
      db
    } =
      createTransitionDatabase(
        orderRow({
          status:
            "taken",

          driver_id:
            "driver-1"
        }),
        {
          staffId:
            "driver-2",

          role:
            "driver"
        }
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

          DB:
            db
        }
      );


    assert.equal(
      response.status,
      403
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
      await createStaffToken();


    const {
      db,
      countOrderUpdates
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
      countOrderUpdates(),
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
      await createStaffToken({
        id:
          "admin-1",

        role:
          "admin"
      });


    const {
      db
    } =
      createTransitionDatabase(
        orderRow({
          status:
            "in_progress",

          driver_id:
            "driver-1"
        }),
        {
          staffId:
            "admin-1",

          role:
            "admin"
        }
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
      await createStaffToken({
        id:
          "admin-1",

        role:
          "admin"
      });


    const {
      db,
      countOrderUpdates
    } =
      createTransitionDatabase(
        orderRow(),
        {
          staffId:
            "admin-1",

          role:
            "admin"
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
      countOrderUpdates(),
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
      await createStaffToken({
        id:
          "admin-1",

        role:
          "admin"
      });


    const {
      db
    } =
      createTransitionDatabase(
        orderRow({
          status:
            "done",

          driver_id:
            "driver-1"
        }),
        {
          staffId:
            "admin-1",

          role:
            "admin"
        }
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
      await createStaffToken({
        id:
          "admin-1",

        role:
          "admin"
      });


    const {
      db
    } =
      createTransitionDatabase(
        null,
        {
          staffId:
            "admin-1",

          role:
            "admin"
        }
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


if (
  !process.exitCode
) {

  console.log(
    "✓ ALL ROUTER TRANSITION TESTS PASSED"
  );
}