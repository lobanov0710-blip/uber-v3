// =========================================
// ORDER TERMINAL MUTATION REPOSITORY
// =========================================
//
// D3 hardening for public terminal mutations.
// The mutation, assignment terminal state,
// audit row and idempotency completion are
// bound to one opaque claim id in one D1 batch.
// =========================================

import {
  prepareMutationIdempotencyClaim,
  prepareMutationIdempotencyComplete
} from "./mutationIdempotencyRepository.js";


function requireDatabase(env) {
  if (!env?.DB) {
    throw new Error(
      "D1 DB binding is not configured"
    );
  }

  return env.DB;
}


function clean(value) {
  return String(value ?? "")
    .trim();
}


function requireText(value, field) {
  const text =
    clean(value);

  if (!text) {
    throw new Error(
      `invalid terminal mutation ${field}`
    );
  }

  return text;
}


function requirePositiveInteger(value, field) {
  const number =
    Number(value);

  if (
    !Number.isSafeInteger(number) ||
    number <= 0
  ) {
    throw new Error(
      `invalid terminal mutation ${field}`
    );
  }

  return number;
}


function resultChanges(result) {
  if (
    result?.success !== true
  ) {
    throw new Error(
      "terminal mutation D1 failure"
    );
  }

  const count =
    Number(
      result?.meta?.changes ??
      0
    );

  if (
    !Number.isSafeInteger(count) ||
    count < 0 ||
    count > 1
  ) {
    throw new Error(
      "invalid terminal mutation D1 change count"
    );
  }

  return count;
}


export async function getTerminalOrderState(
  env,
  orderId
) {
  const db =
    requireDatabase(env);

  const row =
    await db
      .prepare(`
        SELECT
          id,
          status,
          driver_id,
          revision,
          updated_at

        FROM orders

        WHERE id = ?1

        LIMIT 1
      `)
      .bind(
        requireText(
          orderId,
          "orderId"
        )
      )
      .first();


  if (!row) {
    return null;
  }


  return {
    id:
      clean(row.id),

    status:
      clean(row.status),

    driverId:
      row.driver_id == null
        ? null
        : clean(row.driver_id),

    revision:
      Number(row.revision),

    updatedAt:
      Number(row.updated_at)
  };
}


async function finalizeConflictIdempotency(
  env,
  idempotency,
  {
    actorAccountId,
    result,
    completedAt
  }
) {
  const run =
    await prepareMutationIdempotencyComplete(
      requireDatabase(env),
      {
        actorAccountId,
        operation:
          idempotency.operation,
        keyDigest:
          idempotency.keyDigest,
        requestDigest:
          idempotency.requestDigest,
        claimId:
          idempotency.claimId,
        httpStatus:
          result.status,
        resultCode:
          result.code,
        result,
        completedAt
      }
    )
      .run();


  if (
    resultChanges(run) !== 1
  ) {
    throw new Error(
      "terminal conflict idempotency completion failed"
    );
  }
}


export async function transitionTerminalOrder(
  env,
  {
    actorAccountId,
    orderId,
    expectedRevision,
    targetStatus,
    currentDriverId,
    changedAt,
    requestId,
    auditId,
    idempotency
  }
) {
  const db =
    requireDatabase(env);

  const actor =
    requireText(
      actorAccountId,
      "actorAccountId"
    );

  const id =
    requireText(
      orderId,
      "orderId"
    );

  const revision =
    requirePositiveInteger(
      expectedRevision,
      "expectedRevision"
    );

  const target =
    requireText(
      targetStatus,
      "targetStatus"
    )
      .toLowerCase();

  const timestamp =
    requirePositiveInteger(
      changedAt,
      "changedAt"
    );

  const resultDriverId =
    currentDriverId == null
      ? null
      : requireText(
          currentDriverId,
          "currentDriverId"
        );


  if (
    target !== "done" &&
    target !== "canceled"
  ) {
    throw new Error(
      "invalid terminal target status"
    );
  }


  const claim =
    prepareMutationIdempotencyClaim(
      db,
      {
        actorAccountId:
          actor,
        operation:
          idempotency.operation,
        keyDigest:
          idempotency.keyDigest,
        requestDigest:
          idempotency.requestDigest,
        claimId:
          idempotency.claimId,
        createdAt:
          timestamp
      }
    );


  let orderUpdate;


  if (
    target === "done"
  ) {
    const driver =
      requireText(
        resultDriverId,
        "driverId"
      );

    orderUpdate =
      db
        .prepare(`
          UPDATE orders

          SET
            status = 'done',
            revision = revision + 1,
            updated_at =
              CASE
                WHEN updated_at >= ?4
                  THEN updated_at + 1
                ELSE ?4
              END,
            last_terminal_claim_id = ?5

          WHERE id = ?1
            AND revision = ?2
            AND status = 'in_progress'
            AND driver_id = ?3

            AND (
              NOT EXISTS (
                SELECT 1
                FROM order_assignments a
                WHERE a.order_id = ?1
                  AND a.state = 'active'
                  AND a.revoked_at IS NULL
              )

              OR EXISTS (
                SELECT 1
                FROM order_assignments a
                WHERE a.order_id = ?1
                  AND a.driver_id = ?3
                  AND a.state = 'active'
                  AND a.revoked_at IS NULL
                  AND a.phase = 'in_trip'
              )
            )

            AND EXISTS (
              SELECT 1
              FROM mutation_idempotency mi
              WHERE mi.actor_account_id = ?6
                AND mi.operation = ?7
                AND mi.key_digest = ?8
                AND mi.request_digest = ?9
                AND mi.claim_id = ?5
                AND mi.state = 'in_progress'
            )
        `)
        .bind(
          id,
          revision,
          driver,
          timestamp,
          requireText(
            idempotency.claimId,
            "claimId"
          ),
          actor,
          requireText(
            idempotency.operation,
            "operation"
          ),
          requireText(
            idempotency.keyDigest,
            "keyDigest"
          ),
          requireText(
            idempotency.requestDigest,
            "requestDigest"
          )
        );

  } else {

    orderUpdate =
      db
        .prepare(`
          UPDATE orders

          SET
            status = 'canceled',
            revision = revision + 1,
            updated_at =
              CASE
                WHEN updated_at >= ?3
                  THEN updated_at + 1
                ELSE ?3
              END,
            last_terminal_claim_id = ?4

          WHERE id = ?1
            AND revision = ?2
            AND status IN (
              'new',
              'taken',
              'in_progress'
            )

            AND EXISTS (
              SELECT 1
              FROM mutation_idempotency mi
              WHERE mi.actor_account_id = ?5
                AND mi.operation = ?6
                AND mi.key_digest = ?7
                AND mi.request_digest = ?8
                AND mi.claim_id = ?4
                AND mi.state = 'in_progress'
            )
        `)
        .bind(
          id,
          revision,
          timestamp,
          requireText(
            idempotency.claimId,
            "claimId"
          ),
          actor,
          requireText(
            idempotency.operation,
            "operation"
          ),
          requireText(
            idempotency.keyDigest,
            "keyDigest"
          ),
          requireText(
            idempotency.requestDigest,
            "requestDigest"
          )
        );
  }


  const assignmentUpdate =
    target === "done"
      ? db
          .prepare(`
            UPDATE order_assignments

            SET
              state = 'completed',
              revision = revision + 1

            WHERE order_id = ?1
              AND driver_id = ?2
              AND state = 'active'
              AND revoked_at IS NULL
              AND phase = 'in_trip'

              AND EXISTS (
                SELECT 1
                FROM orders o
                WHERE o.id = ?1
                  AND o.status = 'done'
                  AND o.revision = ?3
                  AND o.last_terminal_claim_id = ?4
              )
          `)
          .bind(
            id,
            requireText(
              resultDriverId,
              "driverId"
            ),
            revision + 1,
            requireText(
              idempotency.claimId,
              "claimId"
            )
          )
      : db
          .prepare(`
            UPDATE order_assignments

            SET
              state = 'revoked',
              revision = revision + 1,
              revoked_at =
                CASE
                  WHEN created_at > ?2
                    THEN created_at
                  ELSE ?2
                END

            WHERE order_id = ?1
              AND state = 'active'
              AND revoked_at IS NULL

              AND EXISTS (
                SELECT 1
                FROM orders o
                WHERE o.id = ?1
                  AND o.status = 'canceled'
                  AND o.revision = ?3
                  AND o.last_terminal_claim_id = ?4
              )
          `)
          .bind(
            id,
            timestamp,
            revision + 1,
            requireText(
              idempotency.claimId,
              "claimId"
            )
          );


  const action =
    target === "done"
      ? "driver.order_completed"
      : "admin.order_canceled";


  const audit =
    db
      .prepare(`
        INSERT INTO audit_events (
          id,
          actor_account_id,
          action,
          target_type,
          target_id,
          outcome,
          request_id,
          created_at
        )

        SELECT
          ?1,
          ?2,
          ?3,
          'order',
          ?4,
          'success',
          ?5,
          ?6

        WHERE EXISTS (
          SELECT 1
          FROM orders o
          WHERE o.id = ?4
            AND o.status = ?7
            AND o.revision = ?8
            AND o.last_terminal_claim_id = ?9
        )

        AND EXISTS (
          SELECT 1
          FROM mutation_idempotency mi
          WHERE mi.actor_account_id = ?2
            AND mi.operation = ?10
            AND mi.key_digest = ?11
            AND mi.request_digest = ?12
            AND mi.claim_id = ?9
            AND mi.state = 'in_progress'
        )
      `)
      .bind(
        requireText(
          auditId,
          "auditId"
        ),
        actor,
        action,
        id,
        clean(requestId) || null,
        timestamp,
        target,
        revision + 1,
        requireText(
          idempotency.claimId,
          "claimId"
        ),
        requireText(
          idempotency.operation,
          "operation"
        ),
        requireText(
          idempotency.keyDigest,
          "keyDigest"
        ),
        requireText(
          idempotency.requestDigest,
          "requestDigest"
        )
      );


  const successResult = {
    ok:
      true,

    order: {
      id,
      status:
        target,
      driverId:
        resultDriverId,
      updatedAt:
        timestamp,
      revision:
        revision + 1
    }
  };


  const complete =
    db
      .prepare(`
        UPDATE mutation_idempotency

        SET
          state = 'completed',
          http_status = 200,
          result_code = NULL,
          result_json = ?6,
          completed_at = ?7

        WHERE actor_account_id = ?1
          AND operation = ?2
          AND key_digest = ?3
          AND request_digest = ?4
          AND claim_id = ?5
          AND state = 'in_progress'

          -- Immediately follows the audit INSERT.
          AND changes() = 1

          AND EXISTS (
            SELECT 1
            FROM orders o
            WHERE o.id = ?8
              AND o.status = ?9
              AND o.revision = ?10
              AND o.last_terminal_claim_id = ?5
          )
      `)
      .bind(
        actor,
        requireText(
          idempotency.operation,
          "operation"
        ),
        requireText(
          idempotency.keyDigest,
          "keyDigest"
        ),
        requireText(
          idempotency.requestDigest,
          "requestDigest"
        ),
        requireText(
          idempotency.claimId,
          "claimId"
        ),
        JSON.stringify(
          successResult
        ),
        timestamp,
        id,
        target,
        revision + 1
      );


  const results =
    await db.batch([
      claim,
      orderUpdate,
      assignmentUpdate,
      audit,
      complete
    ]);


  if (
    !Array.isArray(results) ||
    results.length !== 5
  ) {
    throw new Error(
      "terminal mutation transaction failed"
    );
  }


  const counts =
    results.map(
      resultChanges
    );


  if (
    counts[0] === 0
  ) {
    if (
      counts.slice(1)
        .some(
          count =>
            count !== 0
        )
    ) {
      throw new Error(
        "terminal idempotency invariant failed"
      );
    }

    return {
      kind:
        "existing_idempotency"
    };
  }


  if (
    counts[1] === 0
  ) {
    if (
      counts.slice(2)
        .some(
          count =>
            count !== 0
        )
    ) {
      throw new Error(
        "terminal conflict invariant failed"
      );
    }


    const conflictResult = {
      ok:
        false,

      status:
        409,

      error:
        "order transition conflict",

      code:
        "order_terminal_preconditions_failed"
    };


    await finalizeConflictIdempotency(
      env,
      idempotency,
      {
        actorAccountId:
          actor,
        result:
          conflictResult,
        completedAt:
          timestamp
      }
    );


    return {
      kind:
        "conflict",

      result:
        conflictResult
    };
  }


  if (
    counts[1] !== 1 ||
    ![0, 1].includes(
      counts[2]
    ) ||
    counts[3] !== 1 ||
    counts[4] !== 1
  ) {
    throw new Error(
      "incomplete terminal mutation transaction"
    );
  }


  return {
    kind:
      "success",

    result:
      successResult
  };
}
