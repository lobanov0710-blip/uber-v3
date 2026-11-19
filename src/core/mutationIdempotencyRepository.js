// =========================================
// MUTATION IDEMPOTENCY REPOSITORY
// =========================================

function clean(value) {
  return String(value ?? "").trim();
}

function requireText(value, field) {
  const text = clean(value);

  if (!text) {
    throw new Error(
      `invalid idempotency ${field}`
    );
  }

  return text;
}

function requireTimestamp(value, field) {
  const number = Number(value);

  if (
    !Number.isSafeInteger(number) ||
    number <= 0
  ) {
    throw new Error(
      `invalid idempotency ${field}`
    );
  }

  return number;
}

function requireHttpStatus(value) {
  const number = Number(value);

  if (
    !Number.isSafeInteger(number) ||
    number < 200 ||
    number > 599
  ) {
    throw new Error(
      "invalid idempotency http status"
    );
  }

  return number;
}

export function prepareMutationIdempotencyClaim(
  db,
  {
    actorAccountId,
    operation,
    keyDigest,
    requestDigest,
    claimId,
    createdAt
  }
) {
  return db
    .prepare(`
      INSERT OR IGNORE INTO mutation_idempotency (
        actor_account_id,
        operation,
        key_digest,
        request_digest,
        claim_id,
        state,
        http_status,
        result_code,
        result_json,
        created_at,
        completed_at
      )
      VALUES (
        ?1,
        ?2,
        ?3,
        ?4,
        ?5,
        'in_progress',
        NULL,
        NULL,
        NULL,
        ?6,
        NULL
      )
    `)
    .bind(
      requireText(
        actorAccountId,
        "actorAccountId"
      ),
      requireText(
        operation,
        "operation"
      ),
      requireText(
        keyDigest,
        "keyDigest"
      ),
      requireText(
        requestDigest,
        "requestDigest"
      ),
      requireText(
        claimId,
        "claimId"
      ),
      requireTimestamp(
        createdAt,
        "createdAt"
      )
    );
}


export function prepareMutationIdempotencyComplete(
  db,
  {
    actorAccountId,
    operation,
    keyDigest,
    requestDigest,
    claimId,
    httpStatus,
    resultCode,
    result,
    completedAt
  }
) {
  const serialized =
    JSON.stringify(
      result
    );

  if (
    serialized.length < 2 ||
    serialized.length > 4000
  ) {
    throw new Error(
      "invalid idempotency result size"
    );
  }

  return db
    .prepare(`
      UPDATE mutation_idempotency

      SET
        state = 'completed',
        http_status = ?6,
        result_code = ?7,
        result_json = ?8,
        completed_at = ?9

      WHERE actor_account_id = ?1
        AND operation = ?2
        AND key_digest = ?3
        AND request_digest = ?4
        AND claim_id = ?5
        AND state = 'in_progress'
    `)
    .bind(
      requireText(
        actorAccountId,
        "actorAccountId"
      ),
      requireText(
        operation,
        "operation"
      ),
      requireText(
        keyDigest,
        "keyDigest"
      ),
      requireText(
        requestDigest,
        "requestDigest"
      ),
      requireText(
        claimId,
        "claimId"
      ),
      requireHttpStatus(
        httpStatus
      ),
      resultCode == null
        ? null
        : requireText(
            resultCode,
            "resultCode"
          ),
      serialized,
      requireTimestamp(
        completedAt,
        "completedAt"
      )
    );
}


export async function getMutationIdempotencyRecord(
  env,
  {
    actorAccountId,
    operation,
    keyDigest
  }
) {
  if (!env?.DB) {
    throw new Error(
      "D1 DB binding is not configured"
    );
  }

  const row =
    await env.DB
      .prepare(`
        SELECT
          actor_account_id,
          operation,
          key_digest,
          request_digest,
          claim_id,
          state,
          http_status,
          result_code,
          result_json,
          created_at,
          completed_at

        FROM mutation_idempotency

        WHERE actor_account_id = ?1
          AND operation = ?2
          AND key_digest = ?3

        LIMIT 1
      `)
      .bind(
        requireText(
          actorAccountId,
          "actorAccountId"
        ),
        requireText(
          operation,
          "operation"
        ),
        requireText(
          keyDigest,
          "keyDigest"
        )
      )
      .first();

  if (!row) {
    return null;
  }

  let result = null;

  if (
    row.result_json != null
  ) {
    try {
      result =
        JSON.parse(
          String(
            row.result_json
          )
        );
    } catch {
      throw new Error(
        "invalid persisted idempotency result"
      );
    }
  }

  return {
    actorAccountId:
      clean(
        row.actor_account_id
      ),

    operation:
      clean(
        row.operation
      ),

    keyDigest:
      clean(
        row.key_digest
      ),

    requestDigest:
      clean(
        row.request_digest
      ),

    claimId:
      clean(
        row.claim_id
      ),

    state:
      clean(
        row.state
      ),

    httpStatus:
      row.http_status == null
        ? null
        : Number(
            row.http_status
          ),

    resultCode:
      row.result_code == null
        ? null
        : clean(
            row.result_code
          ),

    result,

    createdAt:
      Number(
        row.created_at
      ),

    completedAt:
      row.completed_at == null
        ? null
        : Number(
            row.completed_at
          )
  };
}
