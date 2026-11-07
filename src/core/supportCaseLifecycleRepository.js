// =========================================
// SUPPORT CASE LIFECYCLE REPOSITORY
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
      `invalid support lifecycle ${field}`
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
      `invalid support lifecycle ${field}`
    );
  }

  return number;
}


function resultChanges(result) {
  if (
    result?.success !== true
  ) {
    throw new Error(
      "support lifecycle D1 failure"
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
      "invalid support lifecycle D1 change count"
    );
  }

  return count;
}


function mapCase(row) {
  return {
    id:
      clean(row.id),
    driverId:
      clean(row.driver_id),
    orderId:
      row.order_id == null
        ? null
        : clean(row.order_id),
    category:
      clean(row.category),
    status:
      clean(row.status),
    revision:
      Number(row.revision),
    createdAt:
      Number(row.created_at),
    updatedAt:
      Number(row.updated_at),
    resolvedBy:
      row.resolved_by == null
        ? null
        : clean(row.resolved_by)
  };
}


export async function listDriverSupportCases(
  env,
  driverId,
  limit = 100
) {
  const db =
    requireDatabase(env);

  const safeLimit =
    Math.max(
      1,
      Math.min(
        Number.isSafeInteger(
          Number(limit)
        )
          ? Number(limit)
          : 100,
        200
      )
    );

  const result =
    await db
      .prepare(`
        SELECT
          id,
          driver_id,
          order_id,
          category,
          status,
          revision,
          created_at,
          updated_at,
          resolved_by

        FROM support_cases

        WHERE driver_id = ?1

        ORDER BY
          updated_at DESC,
          id DESC

        LIMIT ?2
      `)
      .bind(
        requireText(
          driverId,
          "driverId"
        ),
        safeLimit
      )
      .all();


  if (
    result?.success !== true ||
    !Array.isArray(
      result?.results
    )
  ) {
    throw new Error(
      "driver support cases query failed"
    );
  }


  return result.results.map(
    mapCase
  );
}


export async function listAdminSupportCases(
  env,
  {
    status = null,
    limit = 100
  } = {}
) {
  const db =
    requireDatabase(env);

  const safeLimit =
    Math.max(
      1,
      Math.min(
        Number.isSafeInteger(
          Number(limit)
        )
          ? Number(limit)
          : 100,
        200
      )
    );

  const normalizedStatus =
    status == null ||
    clean(status) === ""
      ? null
      : requireText(
          status,
          "status"
        );


  const result =
    await db
      .prepare(`
        SELECT
          id,
          driver_id,
          order_id,
          category,
          status,
          revision,
          created_at,
          updated_at,
          resolved_by

        FROM support_cases

        WHERE (
          ?1 IS NULL
          OR status = ?1
        )

        ORDER BY
          updated_at DESC,
          id DESC

        LIMIT ?2
      `)
      .bind(
        normalizedStatus,
        safeLimit
      )
      .all();


  if (
    result?.success !== true ||
    !Array.isArray(
      result?.results
    )
  ) {
    throw new Error(
      "admin support cases query failed"
    );
  }


  return result.results.map(
    mapCase
  );
}


export async function getSupportCaseBundle(
  env,
  caseId,
  nowMs
) {
  const db =
    requireDatabase(env);

  const id =
    requireText(
      caseId,
      "caseId"
    );

  const now =
    requirePositiveInteger(
      nowMs,
      "nowMs"
    );


  const row =
    await db
      .prepare(`
        SELECT
          id,
          driver_id,
          order_id,
          category,
          status,
          revision,
          created_at,
          updated_at,
          resolved_by

        FROM support_cases

        WHERE id = ?1

        LIMIT 1
      `)
      .bind(
        id
      )
      .first();


  if (!row) {
    return null;
  }


  const messages =
    await db
      .prepare(`
        SELECT
          id,
          sender_kind,
          sender_account_id,
          body,
          created_at,
          expires_at

        FROM chat_messages

        WHERE support_case_id = ?1
          AND expires_at > ?2

        ORDER BY
          created_at ASC,
          id ASC

        LIMIT 500
      `)
      .bind(
        id,
        now
      )
      .all();


  if (
    messages?.success !== true ||
    !Array.isArray(
      messages?.results
    )
  ) {
    throw new Error(
      "support messages query failed"
    );
  }


  return {
    ...mapCase(row),

    messages:
      messages.results.map(
        message => ({
          id:
            clean(message.id),
          senderKind:
            clean(message.sender_kind),
          senderAccountId:
            message.sender_account_id == null
              ? null
              : clean(
                  message.sender_account_id
                ),
          body:
            clean(message.body),
          createdAt:
            Number(message.created_at),
          expiresAt:
            Number(message.expires_at)
        })
      )
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
      "support conflict idempotency completion failed"
    );
  }
}


async function appendSupportMessage(
  env,
  {
    actorAccountId,
    driverConstraint,
    caseId,
    expectedRevision,
    senderKind,
    body,
    messageId,
    createdAt,
    expiresAt,
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
      caseId,
      "caseId"
    );

  const revision =
    requirePositiveInteger(
      expectedRevision,
      "expectedRevision"
    );

  const timestamp =
    requirePositiveInteger(
      createdAt,
      "createdAt"
    );

  const expiry =
    requirePositiveInteger(
      expiresAt,
      "expiresAt"
    );


  if (
    expiry <= timestamp
  ) {
    throw new Error(
      "invalid support message expiry"
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


  const caseUpdate =
    db
      .prepare(`
        UPDATE support_cases

        SET
          revision = revision + 1,
          updated_at =
            CASE
              WHEN updated_at >= ?4
                THEN updated_at + 1
              ELSE ?4
            END

        WHERE id = ?1
          AND revision = ?2
          AND status != 'closed'
          AND (
            ?9 IS NULL
            OR driver_id = ?9
          )

          AND EXISTS (
            SELECT 1
            FROM mutation_idempotency mi
            WHERE mi.actor_account_id = ?3
              AND mi.operation = ?5
              AND mi.key_digest = ?6
              AND mi.request_digest = ?7
              AND mi.claim_id = ?8
              AND mi.state = 'in_progress'
          )
      `)
      .bind(
        id,
        revision,
        actor,
        timestamp,
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
        driverConstraint == null
          ? null
          : requireText(
              driverConstraint,
              "driverConstraint"
            )
      );


  const insert =
    db
      .prepare(`
        INSERT INTO chat_messages (
          id,
          order_id,
          support_case_id,
          sender_kind,
          sender_account_id,
          body,
          created_at,
          expires_at
        )

        SELECT
          ?1,
          sc.order_id,
          sc.id,
          ?2,
          ?3,
          ?4,
          ?5,
          ?6

        FROM support_cases sc

        WHERE sc.id = ?7
          AND sc.revision = ?8
          AND changes() = 1
      `)
      .bind(
        requireText(
          messageId,
          "messageId"
        ),
        requireText(
          senderKind,
          "senderKind"
        ),
        actor,
        requireText(
          body,
          "body"
        ),
        timestamp,
        expiry,
        id,
        revision + 1
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
          'support.message_sent',
          'support_case',
          ?3,
          'success',
          ?4,
          ?5

        WHERE changes() = 1

          AND EXISTS (
            SELECT 1
            FROM chat_messages
            WHERE id = ?6
              AND support_case_id = ?3
              AND sender_account_id = ?2
          )
      `)
      .bind(
        requireText(
          auditId,
          "auditId"
        ),
        actor,
        id,
        clean(requestId) || null,
        timestamp,
        requireText(
          messageId,
          "messageId"
        )
      );


  const successResult = {
    ok:
      true,

    message: {
      id:
        messageId,
      supportCaseId:
        id,
      senderKind:
        clean(senderKind),
      createdAt:
        timestamp,
      expiresAt:
        expiry
    },

    supportCaseRevision:
      revision + 1
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
            FROM chat_messages
            WHERE id = ?8
              AND support_case_id = ?9
              AND sender_account_id = ?1
          )

          AND EXISTS (
            SELECT 1
            FROM support_cases
            WHERE id = ?9
              AND revision = ?10
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
        requireText(
          messageId,
          "messageId"
        ),
        id,
        revision + 1
      );


  const results =
    await db.batch([
      claim,
      caseUpdate,
      insert,
      audit,
      complete
    ]);


  if (
    !Array.isArray(results) ||
    results.length !== 5
  ) {
    throw new Error(
      "support message transaction failed"
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
        "support message idempotency invariant failed"
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
        "support message conflict invariant failed"
      );
    }


    const conflictResult = {
      ok:
        false,
      status:
        409,
      error:
        "conflict",
      code:
        "support_message_preconditions_failed"
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
    counts.slice(1)
      .some(
        count =>
          count !== 1
      )
  ) {
    throw new Error(
      "incomplete support message transaction"
    );
  }


  return {
    kind:
      "success",
    result:
      successResult
  };
}


export async function appendDriverSupportMessage(
  env,
  input
) {
  return appendSupportMessage(
    env,
    {
      ...input,
      driverConstraint:
        input.actorAccountId
    }
  );
}


export async function appendAdminSupportMessage(
  env,
  input
) {
  return appendSupportMessage(
    env,
    {
      ...input,
      driverConstraint:
        null
    }
  );
}


export async function updateAdminSupportCaseStatus(
  env,
  {
    actorAccountId,
    caseId,
    expectedRevision,
    targetStatus,
    updatedAt,
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
      caseId,
      "caseId"
    );

  const revision =
    requirePositiveInteger(
      expectedRevision,
      "expectedRevision"
    );

  const status =
    requireText(
      targetStatus,
      "targetStatus"
    );

  const timestamp =
    requirePositiveInteger(
      updatedAt,
      "updatedAt"
    );


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


  const update =
    db
      .prepare(`
        UPDATE support_cases

        SET
          status = ?4,
          revision = revision + 1,
          updated_at =
            CASE
              WHEN updated_at >= ?5
                THEN updated_at + 1
              ELSE ?5
            END,
          resolved_by =
            CASE
              WHEN ?4 IN (
                'resolved',
                'closed'
              )
                THEN ?2
              ELSE NULL
            END

        WHERE id = ?1
          AND revision = ?3
          AND status != ?4

          AND EXISTS (
            SELECT 1
            FROM mutation_idempotency mi
            WHERE mi.actor_account_id = ?2
              AND mi.operation = ?6
              AND mi.key_digest = ?7
              AND mi.request_digest = ?8
              AND mi.claim_id = ?9
              AND mi.state = 'in_progress'
          )
      `)
      .bind(
        id,
        actor,
        revision,
        status,
        timestamp,
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
          'admin.support_case_status_changed',
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
              AND revision = ?6
              AND status = ?7
          )
      `)
      .bind(
        requireText(
          auditId,
          "auditId"
        ),
        actor,
        id,
        clean(requestId) || null,
        timestamp,
        revision + 1,
        status
      );


  const successResult = {
    ok:
      true,

    supportCase: {
      id,
      status,
      revision:
        revision + 1,
      updatedAt:
        timestamp,
      resolvedBy:
        [
          "resolved",
          "closed"
        ].includes(status)
          ? actor
          : null
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
          AND changes() = 1

          AND EXISTS (
            SELECT 1
            FROM support_cases
            WHERE id = ?8
              AND revision = ?9
              AND status = ?10
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
        revision + 1,
        status
      );


  const results =
    await db.batch([
      claim,
      update,
      audit,
      complete
    ]);


  if (
    !Array.isArray(results) ||
    results.length !== 4
  ) {
    throw new Error(
      "support status transaction failed"
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
        "support status idempotency invariant failed"
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
        "support status conflict invariant failed"
      );
    }


    const conflictResult = {
      ok:
        false,
      status:
        409,
      error:
        "conflict",
      code:
        "support_case_status_preconditions_failed"
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
    counts[2] !== 1 ||
    counts[3] !== 1
  ) {
    throw new Error(
      "incomplete support status transaction"
    );
  }


  return {
    kind:
      "success",
    result:
      successResult
  };
}


export async function deleteExpiredSupportMessages(
  env,
  {
    nowMs,
    retentionMs,
    limit = 500
  }
) {
  const db =
    requireDatabase(env);

  const now =
    requirePositiveInteger(
      nowMs,
      "nowMs"
    );

  const retention =
    requirePositiveInteger(
      retentionMs,
      "retentionMs"
    );

  const cutoff =
    now -
    retention;


  if (
    !Number.isSafeInteger(
      cutoff
    )
  ) {
    throw new Error(
      "invalid support retention cutoff"
    );
  }

  const safeLimit =
    Math.max(
      1,
      Math.min(
        Number.isSafeInteger(
          Number(limit)
        )
          ? Number(limit)
          : 500,
        1000
      )
    );


  const deleteIdempotency =
    db
      .prepare(`
        DELETE FROM mutation_idempotency

        WHERE (
          actor_account_id,
          operation,
          key_digest
        ) IN (
          SELECT
            actor_account_id,
            operation,
            key_digest

          FROM mutation_idempotency

          WHERE operation IN (
            'driver.support.message.create',
            'admin.support.message.create'
          )
            AND state = 'completed'
            AND completed_at IS NOT NULL
            AND completed_at <= ?1

          ORDER BY
            completed_at ASC,
            actor_account_id ASC,
            key_digest ASC

          LIMIT ?2
        )
      `)
      .bind(
        cutoff,
        safeLimit
      );


  const deleteStatement =
    db
      .prepare(`
        DELETE FROM chat_messages

        WHERE id IN (
          SELECT id
          FROM chat_messages
          WHERE support_case_id IS NOT NULL
            AND expires_at <= ?1
          ORDER BY
            expires_at ASC,
            id ASC
          LIMIT ?2
        )
      `)
      .bind(
        now,
        safeLimit
      );


  const auditStatement =
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
          NULL,
          'system.support_chat_retention_deleted',
          'support_chat_retention',
          'expired_batch',
          'success',
          NULL,
          ?2

        WHERE changes() > 0
      `)
      .bind(
        "audit_" +
          crypto.randomUUID(),
        now
      );


  const results =
    await db.batch([
      deleteIdempotency,
      deleteStatement,
      auditStatement
    ]);


  if (
    !Array.isArray(results) ||
    results.length !== 3 ||
    results[0]?.success !== true ||
    results[1]?.success !== true ||
    results[2]?.success !== true
  ) {
    throw new Error(
      "support chat retention failed"
    );
  }


  const idempotencyDeleted =
    Number(
      results[0]?.meta?.changes ??
      0
    );

  const deleted =
    Number(
      results[1]?.meta?.changes ??
      0
    );

  const audited =
    Number(
      results[2]?.meta?.changes ??
      0
    );


  if (
    !Number.isSafeInteger(
      idempotencyDeleted
    ) ||
    idempotencyDeleted < 0 ||
    idempotencyDeleted > safeLimit ||
    !Number.isSafeInteger(deleted) ||
    deleted < 0 ||
    deleted > safeLimit ||
    ![0, 1].includes(audited) ||
    (
      deleted === 0 &&
      audited !== 0
    ) ||
    (
      deleted > 0 &&
      audited !== 1
    )
  ) {
    throw new Error(
      "support chat retention invariant failed"
    );
  }


  return {
    deleted,
    idempotencyDeleted
  };
}
