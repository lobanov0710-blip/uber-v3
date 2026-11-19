// =========================================
// DRIVER SUPPORT CASE REPOSITORY
// =========================================

import {
  prepareMutationIdempotencyClaim
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
      `invalid support case ${field}`
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
      `invalid support case ${field}`
    );
  }

  return number;
}


function resultChanges(result) {
  if (
    result?.success !== true
  ) {
    throw new Error(
      "support case D1 failure"
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
      "invalid support case D1 change count"
    );
  }

  return count;
}


export async function createDriverSupportCase(
  env,
  {
    driverId,
    caseId,
    orderId,
    category,
    createdAt,
    requestId,
    auditId,
    idempotency
  }
) {
  const db =
    requireDatabase(env);

  const driver =
    requireText(
      driverId,
      "driverId"
    );

  const supportCaseId =
    requireText(
      caseId,
      "caseId"
    );

  const linkedOrderId =
    orderId == null
      ? null
      : requireText(
          orderId,
          "orderId"
        );

  const timestamp =
    requirePositiveInteger(
      createdAt,
      "createdAt"
    );


  const claim =
    prepareMutationIdempotencyClaim(
      db,
      {
        actorAccountId:
          driver,
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


  const insert =
    db
      .prepare(`
        INSERT INTO support_cases (
          id,
          driver_id,
          order_id,
          category,
          status,
          created_at,
          updated_at,
          resolved_by,
          revision
        )

        SELECT
          ?1,
          p.staff_account_id,
          ?2,
          ?3,
          'open',
          ?4,
          ?4,
          NULL,
          1

        FROM driver_profiles p

        WHERE p.staff_account_id = ?5

          AND (
            ?2 IS NULL
            OR EXISTS (
              SELECT 1
              FROM order_assignments a
              WHERE a.order_id = ?2
                AND a.driver_id = ?5
            )
            OR EXISTS (
              SELECT 1
              FROM orders o
              WHERE o.id = ?2
                AND o.driver_id = ?5
            )
          )

          AND EXISTS (
            SELECT 1
            FROM mutation_idempotency mi
            WHERE mi.actor_account_id = ?5
              AND mi.operation = ?6
              AND mi.key_digest = ?7
              AND mi.request_digest = ?8
              AND mi.claim_id = ?9
              AND mi.state = 'in_progress'
          )
      `)
      .bind(
        supportCaseId,
        linkedOrderId,
        requireText(
          category,
          "category"
        ),
        timestamp,
        driver,
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
        )
      );


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
          'driver.support_case_created',
          'support_case',
          ?3,
          'success',
          ?4,
          ?5

        WHERE changes() = 1

          AND EXISTS (
            SELECT 1
            FROM support_cases
            WHERE id = ?3
              AND driver_id = ?2
          )
      `)
      .bind(
        requireText(
          auditId,
          "auditId"
        ),
        driver,
        supportCaseId,
        clean(requestId) || null,
        timestamp
      );


  const successResult = {
    ok:
      true,

    supportCase: {
      id:
        supportCaseId,
      orderId:
        linkedOrderId,
      category:
        clean(category),
      status:
        "open",
      revision:
        1,
      createdAt:
        timestamp
    }
  };


  const complete =
    db
      .prepare(`
        UPDATE mutation_idempotency

        SET
          state = 'completed',
          http_status = 201,
          result_code = NULL,
          result_json = ?6,
          completed_at = ?7

        WHERE actor_account_id = ?1
          AND operation = ?2
          AND key_digest = ?3
          AND request_digest = ?4
          AND claim_id = ?5
          AND state = 'in_progress'
          AND changes() = 1

          AND EXISTS (
            SELECT 1
            FROM support_cases
            WHERE id = ?8
              AND driver_id = ?1
          )
      `)
      .bind(
        driver,
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
        supportCaseId
      );


  const results =
    await db.batch([
      claim,
      insert,
      audit,
      complete
    ]);


  if (
    !Array.isArray(results) ||
    results.length !== 4
  ) {
    throw new Error(
      "support case transaction failed"
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
        "support case idempotency invariant failed"
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
      counts[2] !== 0 ||
      counts[3] !== 0
    ) {
      throw new Error(
        "support case ownership invariant failed"
      );
    }

    return {
      kind:
        "not_allowed"
    };
  }


  if (
    counts[1] !== 1 ||
    counts[2] !== 1 ||
    counts[3] !== 1
  ) {
    throw new Error(
      "incomplete support case transaction"
    );
  }


  return {
    kind:
      "success",
    result:
      successResult
  };
}
