import assert from "node:assert/strict";

import {
  assignOrderToDriverVehicle,
  reassignOrderToDriverVehicle
} from "../src/core/orderAssignmentRepository.js";


function fakeDb({
  batchChanges
}) {
  const calls = [];

  return {
    calls,

    prepare(sql) {
      const statement = {
        sql,
        args: [],

        bind(...args) {
          this.args = args;
          calls.push(this);
          return this;
        },

        async run() {
          return {
            success: true,
            meta: {
              changes: 1
            }
          };
        }
      };

      return statement;
    },

    async batch(statements) {
      return statements.map(
        (_, index) => ({
          success: true,
          meta: {
            changes:
              batchChanges?.[index] ??
              1
          }
        })
      );
    }
  };
}


const idempotency = {
  operation:
    "admin.order.assign",
  keyDigest:
    "A".repeat(43),
  requestDigest:
    "B".repeat(43),
  claimId:
    "idem-claim-12345678"
};


const assignDb =
  fakeDb({
    batchChanges: [
      1,
      1,
      1,
      1,
      1
    ]
  });


const assigned =
  await assignOrderToDriverVehicle(
    {
      DB:
        assignDb
    },
    {
      actorAccountId:
        "staff_owner123",
      orderId:
        "order_12345678",
      driverId:
        "staff_driver123",
      vehicleId:
        "vehicle_12345678",
      reason:
        "Назначение диспетчером",
      expectedRevision:
        1,
      assignedAt:
        1800000000000,
      assignmentId:
        "assignment_12345678",
      auditId:
        "audit_12345678",
      requestId:
        "req_12345678",
      idempotency
    }
  );


assert.equal(
  assigned.kind,
  "success"
);

assert.equal(
  assigned.result.assignment.orderRevision,
  2
);


const orderUpdate =
  assignDb.calls.find(
    call =>
      /UPDATE\s+orders/i.test(
        call.sql
      )
      &&
      /status\s*=\s*'taken'/i.test(
        call.sql
      )
  );


assert.ok(
  orderUpdate
);

assert.match(
  orderUpdate.sql,
  /registration_status\s*=\s*'approved'/i
);

assert.match(
  orderUpdate.sql,
  /identity_status\s*=\s*'verified'/i
);

assert.match(
  orderUpdate.sql,
  /v\.status\s*=\s*'approved'/i
);

assert.match(
  orderUpdate.sql,
  /active_vehicle_id\s*!=\s*\?6/i
);

assert.match(
  orderUpdate.sql,
  /mutation_idempotency/i
);


const assignmentInsert =
  assignDb.calls.find(
    call =>
      /INSERT\s+INTO\s+order_assignments/i.test(
        call.sql
      )
  );


assert.ok(
  assignmentInsert
);

assert.match(
  assignmentInsert.sql,
  /last_assignment_id\s*=\s*\?1/i
);


const reassignDb =
  fakeDb({
    batchChanges: [
      1,
      1,
      1,
      1,
      1,
      1
    ]
  });


const reassigned =
  await reassignOrderToDriverVehicle(
    {
      DB:
        reassignDb
    },
    {
      actorAccountId:
        "staff_owner123",
      orderId:
        "order_12345678",
      driverId:
        "staff_driver999",
      vehicleId:
        "vehicle_99999999",
      reason:
        "Замена водителя",
      expectedRevision:
        2,
      assignedAt:
        1800000001000,
      assignmentId:
        "assignment_99999999",
      auditId:
        "audit_99999999",
      requestId:
        "req_99999999",
      idempotency: {
        ...idempotency,
        operation:
          "admin.order.reassign",
        keyDigest:
          "C".repeat(43),
        requestDigest:
          "D".repeat(43),
        claimId:
          "idem-claim-99999999"
      }
    }
  );


assert.equal(
  reassigned.kind,
  "success"
);

assert.equal(
  reassigned.result.assignment.orderRevision,
  3
);


const revokeIndex =
  reassignDb.calls.findIndex(
    call =>
      /UPDATE\s+order_assignments/i.test(
        call.sql
      )
      &&
      /state\s*=\s*'revoked'/i.test(
        call.sql
      )
  );


const insertIndex =
  reassignDb.calls.findIndex(
    call =>
      /INSERT\s+INTO\s+order_assignments/i.test(
        call.sql
      )
  );


assert.ok(
  revokeIndex >= 0
);

assert.ok(
  insertIndex >
    revokeIndex,
  "old assignment must be revoked before new assignment insert"
);


const conflictDb =
  fakeDb({
    batchChanges: [
      1,
      0,
      0,
      0,
      0
    ]
  });


const conflict =
  await assignOrderToDriverVehicle(
    {
      DB:
        conflictDb
    },
    {
      actorAccountId:
        "staff_owner123",
      orderId:
        "order_12345678",
      driverId:
        "staff_driver123",
      vehicleId:
        "vehicle_12345678",
      reason:
        "Назначение диспетчером",
      expectedRevision:
        99,
      assignedAt:
        1800000002000,
      assignmentId:
        "assignment_conflict123",
      auditId:
        "audit_conflict123",
      requestId:
        "req_conflict123",
      idempotency: {
        ...idempotency,
        keyDigest:
          "E".repeat(43),
        requestDigest:
          "F".repeat(43),
        claimId:
          "idem-claim-conflict123"
      }
    }
  );


assert.equal(
  conflict.kind,
  "conflict"
);

assert.equal(
  conflict.result.code,
  "order_assignment_preconditions_failed"
);


console.log(
  "✓ ORDER ASSIGNMENT REPOSITORY TESTS PASSED"
);
