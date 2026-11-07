import assert from "node:assert/strict";

import {
  assignOrderByAdmin,
  reassignOrderByAdmin
} from "../src/core/orderAssignmentService.js";

import {
  createMutationIdempotency
} from "../src/core/mutationIdempotency.js";


const ADMIN_ID =
  "staff_dispatcher123";

const ORDER_ID =
  "order_12345678";

const OLD_DRIVER_ID =
  "staff_driverold1";

const NEW_DRIVER_ID =
  "staff_drivernew1";

const OLD_VEHICLE_ID =
  "vehicle_old12345";

const NEW_VEHICLE_ID =
  "vehicle_new12345";


function createDb({
  mode,
  completedIdempotency = null
}) {

  return {
    prepare(sql) {

      return {
        sql,
        args:
          [],

        bind(...args) {
          this.args =
            args;
          return this;
        },

        async first() {

          if (
            /FROM\s+staff_owner_binding/i.test(
              this.sql
            )
          ) {
            return null;
          }


          if (
            /FROM\s+mutation_idempotency/i.test(
              this.sql
            )
          ) {
            return completedIdempotency;
          }


          if (
            /FROM\s+orders\s+o/i.test(
              this.sql
            )
            &&
            /LEFT\s+JOIN\s+order_assignments/i.test(
              this.sql
            )
          ) {

            if (
              mode ===
                "assign"
            ) {
              return {
                order_id:
                  ORDER_ID,
                order_status:
                  "new",
                order_driver_id:
                  null,
                order_revision:
                  1,
                order_updated_at:
                  1800000000000,
                assignment_id:
                  null,
                assignment_driver_id:
                  null,
                assignment_vehicle_id:
                  null,
                assignment_state:
                  null,
                assignment_revision:
                  null,
                assignment_created_at:
                  null
              };
            }


            return {
              order_id:
                ORDER_ID,
              order_status:
                "taken",
              order_driver_id:
                OLD_DRIVER_ID,
              order_revision:
                2,
              order_updated_at:
                1800000000000,
              assignment_id:
                "assignment_old12345",
              assignment_driver_id:
                OLD_DRIVER_ID,
              assignment_vehicle_id:
                OLD_VEHICLE_ID,
              assignment_state:
                "active",
              assignment_revision:
                1,
              assignment_created_at:
                1799999999000
            };
          }


          if (
            /FROM\s+driver_profiles\s+p/i.test(
              this.sql
            )
            &&
            /LEFT\s+JOIN\s+vehicles/i.test(
              this.sql
            )
          ) {
            return {
              staff_account_id:
                NEW_DRIVER_ID,
              registration_status:
                "approved",
              identity_status:
                "verified",
              vehicle_id:
                NEW_VEHICLE_ID,
              vehicle_status:
                "approved",
              availability_state:
                "off_line",
              active_vehicle_id:
                null
            };
          }


          throw new Error(
            "unexpected notification first query"
          );
        },

        async all() {

          if (
            /FROM\s+staff_permissions/i.test(
              this.sql
            )
          ) {
            return {
              success:
                true,
              results: [
                {
                  permission:
                    mode ===
                      "assign"
                      ? "orders.assign"
                      : "orders.reassign"
                }
              ]
            };
          }


          throw new Error(
            "unexpected notification all query"
          );
        },

        async run() {

          return {
            success:
              true,
            meta: {
              changes:
                1
            }
          };
        }
      };
    },

    async batch(statements) {

      return statements.map(
        () => ({
          success:
            true,
          meta: {
            changes:
              1
          }
        })
      );
    }
  };
}


async function executeAndCollect({
  mode,
  completedIdempotency = null
}) {

  const events = [];
  const scheduled = [];

  const options = {
    nowMs:
      1800000001000,

    requestId:
      "req_assignment_push",

    idempotencyKey:
      mode === "assign"
        ? "assign-push-12345678"
        : "reassign-push-12345678",

    schedule(promise) {
      scheduled.push(
        promise
      );
    },

    async notifyDriverAssignmentEvent(
      _env,
      event
    ) {
      events.push(
        event
      );

      return {
        ok:
          true,
        attempted:
          1,
        delivered:
          1,
        removed:
          0
      };
    }
  };


  const user = {
    id:
      ADMIN_ID,
    role:
      "admin"
  };


  const input = {
    driverId:
      NEW_DRIVER_ID,
    vehicleId:
      NEW_VEHICLE_ID,
    reason:
      mode === "assign"
        ? "Назначение"
        : "Переназначение",
    expectedRevision:
      mode === "assign"
        ? 1
        : 2
  };


  const result =
    mode === "assign"
      ? await assignOrderByAdmin(
          {
            DB:
              createDb({
                mode,
                completedIdempotency
              })
          },
          user,
          ORDER_ID,
          input,
          options
        )
      : await reassignOrderByAdmin(
          {
            DB:
              createDb({
                mode,
                completedIdempotency
              })
          },
          user,
          ORDER_ID,
          input,
          options
        );


  await Promise.all(
    scheduled
  );


  return {
    result,
    events,
    scheduled
  };
}


const assigned =
  await executeAndCollect({
    mode:
      "assign"
  });


assert.equal(
  assigned.result.ok,
  true
);

assert.equal(
  assigned.events.length,
  1
);

assert.deepEqual(
  assigned.events[0],
  {
    type:
      "order_assigned",
    accountId:
      NEW_DRIVER_ID,
    orderId:
      ORDER_ID,
    assignmentId:
      assigned.result
        .assignment
        .id,
    orderRevision:
      2
  }
);


const reassigned =
  await executeAndCollect({
    mode:
      "reassign"
  });


assert.equal(
  reassigned.result.ok,
  true
);

assert.equal(
  reassigned.events.length,
  2
);

assert.deepEqual(
  reassigned.events.map(
    event => ({
      type:
        event.type,
      accountId:
        event.accountId,
      orderId:
        event.orderId,
      orderRevision:
        event.orderRevision
    })
  ),
  [
    {
      type:
        "order_assignment_revoked",
      accountId:
        OLD_DRIVER_ID,
      orderId:
        ORDER_ID,
      orderRevision:
        3
    },
    {
      type:
        "order_assigned",
      accountId:
        NEW_DRIVER_ID,
      orderId:
        ORDER_ID,
      orderRevision:
        3
    }
  ]
);


const replayResult = {
  ok:
    true,
  assignment: {
    id:
      "assignment_replayed",
    orderId:
      ORDER_ID,
    driverId:
      NEW_DRIVER_ID,
    vehicleId:
      NEW_VEHICLE_ID,
    state:
      "active",
    revision:
      1,
    orderRevision:
      2,
    assignedAt:
      1800000001000
  }
};


const replayInput = {
  driverId:
    NEW_DRIVER_ID,
  vehicleId:
    NEW_VEHICLE_ID,
  reason:
    "Назначение",
  expectedRevision:
    1
};


const replayDigest =
  await createMutationIdempotency({
    key:
      "assign-push-12345678",
    operation:
      "admin.order.assign",
    target:
      ORDER_ID,
    body:
      replayInput
  });


const replay =
  await executeAndCollect({
    mode:
      "assign",
    completedIdempotency: {
      actor_account_id:
        ADMIN_ID,
      operation:
        replayDigest.operation,
      key_digest:
        replayDigest.keyDigest,
      request_digest:
        replayDigest.requestDigest,
      claim_id:
        "claim_replayed",
      state:
        "completed",
      http_status:
        200,
      result_code:
        null,
      result_json:
        JSON.stringify(
          replayResult
        ),
      created_at:
        1800000000000,
      completed_at:
        1800000001000
    }
  });


assert.equal(
  replay.result.ok,
  true
);


assert.equal(
  replay.events.length,
  0,
  "completed idempotent replay must not schedule another push"
);


console.log(
  "✓ ORDER ASSIGNMENT PUSH SCHEDULING TESTS PASSED"
);
