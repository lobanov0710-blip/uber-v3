// =========================================
// DRIVER TRIP OPERATIONAL REPOSITORY
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
      `invalid trip operation ${field}`
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
      `invalid trip operation ${field}`
    );
  }

  return number;
}


function resultChanges(result) {
  if (
    result?.success !== true
  ) {
    throw new Error(
      "trip operation D1 failure"
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
      "invalid trip operation D1 change count"
    );
  }

  return count;
}


export async function getDriverOperationalAssignment(
  env,
  driverId,
  assignmentId
) {
  const db =
    requireDatabase(env);

  const row =
    await db
      .prepare(`
        SELECT
          a.id,
          a.order_id,
          a.driver_id,
          a.vehicle_id,
          a.state,
          a.revision,
          a.phase,
          a.phase_updated_at,
          a.verification_session_id,
          a.revoked_at,

          o.status AS order_status,
          o.revision AS order_revision

        FROM order_assignments a

        INNER JOIN orders o
          ON o.id = a.order_id

        WHERE a.id = ?1
          AND a.driver_id = ?2

        LIMIT 1
      `)
      .bind(
        requireText(
          assignmentId,
          "assignmentId"
        ),
        requireText(
          driverId,
          "driverId"
        )
      )
      .first();


  if (!row) {
    return null;
  }


  return {
    id:
      clean(
        row.id
      ),

    orderId:
      clean(
        row.order_id
      ),

    driverId:
      clean(
        row.driver_id
      ),

    vehicleId:
      clean(
        row.vehicle_id
      ),

    state:
      clean(
        row.state
      ),

    revision:
      Number(
        row.revision
      ),

    phase:
      clean(
        row.phase ||
        "assigned"
      ),

    phaseUpdatedAt:
      row.phase_updated_at == null
        ? null
        : Number(
            row.phase_updated_at
          ),

    verificationSessionId:
      row.verification_session_id == null
        ? null
        : clean(
            row.verification_session_id
          ),

    revokedAt:
      row.revoked_at == null
        ? null
        : Number(
            row.revoked_at
          ),

    orderStatus:
      clean(
        row.order_status
      ),

    orderRevision:
      Number(
        row.order_revision
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
  const statement =
    prepareMutationIdempotencyComplete(
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
    );


  const run =
    await statement.run();


  if (
    resultChanges(
      run
    ) !== 1
  ) {
    throw new Error(
      "trip operation conflict idempotency completion failed"
    );
  }
}


export async function insertTripVerificationChallenge(
  env,
  {
    driverId,
    assignmentId,
    expectedRevision,
    verificationSessionId,
    challengeDigest,
    expiresAt,
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

  const assignment =
    requireText(
      assignmentId,
      "assignmentId"
    );

  const revision =
    requirePositiveInteger(
      expectedRevision,
      "expectedRevision"
    );

  const sessionId =
    requireText(
      verificationSessionId,
      "verificationSessionId"
    );

  const digest =
    requireText(
      challengeDigest,
      "challengeDigest"
    );

  const created =
    requirePositiveInteger(
      createdAt,
      "createdAt"
    );

  const expires =
    requirePositiveInteger(
      expiresAt,
      "expiresAt"
    );


  if (
    expires <=
      created
  ) {
    throw new Error(
      "invalid trip verification expiry"
    );
  }


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
          created
      }
    );


  const insert =
    db
      .prepare(`
        INSERT INTO identity_verifications (
          id,
          assignment_id,
          order_id,
          driver_id,
          vehicle_id,
          challenge_digest,
          state,
          expires_at,
          verified_at,
          created_at,
          updated_at,
          assignment_revision
        )

        SELECT
          ?1,
          a.id,
          a.order_id,
          a.driver_id,
          a.vehicle_id,
          ?2,
          'pending',
          ?3,
          NULL,
          ?4,
          ?4,
          a.revision

        FROM order_assignments a

        INNER JOIN orders o
          ON o.id = a.order_id

        WHERE a.id = ?5
          AND a.driver_id = ?6
          AND a.state = 'active'
          AND a.revoked_at IS NULL
          AND a.revision = ?7
          AND a.phase = 'assigned'
          AND o.driver_id = ?6
          AND o.status = 'taken'

          AND NOT EXISTS (
            SELECT 1
            FROM identity_verifications iv
            WHERE iv.assignment_id = a.id
              AND iv.assignment_revision =
                  a.revision
              AND iv.state IN (
                'pending',
                'manual_review_required'
              )
              AND iv.expires_at > ?4
          )

          AND EXISTS (
            SELECT 1
            FROM mutation_idempotency mi
            WHERE mi.actor_account_id = ?6
              AND mi.operation = ?8
              AND mi.key_digest = ?9
              AND mi.request_digest = ?10
              AND mi.claim_id = ?11
              AND mi.state = 'in_progress'
          )
      `)
      .bind(
        sessionId,
        digest,
        expires,
        created,
        assignment,
        driver,
        revision,
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
          'driver.trip_verification_challenge_created',
          'identity_verification',
          ?3,
          'success',
          ?4,
          ?5

        WHERE EXISTS (
          SELECT 1
          FROM identity_verifications
          WHERE id = ?3
            AND driver_id = ?2
            AND assignment_id = ?6
            AND assignment_revision = ?7
        )
      `)
      .bind(
        requireText(
          auditId,
          "auditId"
        ),
        driver,
        sessionId,
        clean(
          requestId
        ) || null,
        created,
        assignment,
        revision
      );


  const successResult = {
    ok:
      true,

    verification: {
      verificationSessionId:
        sessionId,

      assignmentId:
        assignment,

      assignmentRevision:
        revision,

      state:
        "pending",

      expiresAt:
        expires
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

          AND EXISTS (
            SELECT 1
            FROM identity_verifications
            WHERE id = ?8
              AND driver_id = ?1
              AND assignment_id = ?9
              AND assignment_revision = ?10
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
        created,
        sessionId,
        assignment,
        revision
      );


  const results =
    await db.batch([
      claim,
      insert,
      audit,
      complete
    ]);


  if (
    !Array.isArray(
      results
    )
    ||
    results.length !== 4
  ) {
    throw new Error(
      "trip verification transaction failed"
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
        "trip verification idempotency invariant failed"
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
      counts[2] !== 0
      ||
      counts[3] !== 0
    ) {
      throw new Error(
        "trip verification conflict invariant failed"
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
        "verification_challenge_preconditions_failed"
    };


    await finalizeConflictIdempotency(
      env,
      idempotency,
      {
        actorAccountId:
          driver,

        result:
          conflictResult,

        completedAt:
          created
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
    counts[1] !== 1
    ||
    counts[2] !== 1
    ||
    counts[3] !== 1
  ) {
    throw new Error(
      "incomplete trip verification transaction"
    );
  }


  return {
    kind:
      "success",

    result:
      successResult
  };
}


export async function advanceDriverAssignmentPhase(
  env,
  {
    driverId,
    assignmentId,
    expectedRevision,
    expectedPhase,
    targetPhase,
    verificationSessionId,
    changedAt,
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

  const assignment =
    requireText(
      assignmentId,
      "assignmentId"
    );

  const revision =
    requirePositiveInteger(
      expectedRevision,
      "expectedRevision"
    );

  const fromPhase =
    requireText(
      expectedPhase,
      "expectedPhase"
    );

  const toPhase =
    requireText(
      targetPhase,
      "targetPhase"
    );

  const timestamp =
    requirePositiveInteger(
      changedAt,
      "changedAt"
    );

  const verification =
    verificationSessionId == null
      ? null
      : requireText(
          verificationSessionId,
          "verificationSessionId"
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


  const verificationGuard =
    toPhase ===
      "en_route_to_pickup"
      ? `
          AND ?8 IS NOT NULL

          AND EXISTS (
            SELECT 1
            FROM identity_verifications iv
            WHERE iv.id = ?8
              AND iv.assignment_id = a.id
              AND iv.assignment_revision =
                  a.revision
              AND iv.order_id = a.order_id
              AND iv.driver_id = a.driver_id
              AND iv.vehicle_id = a.vehicle_id
              AND iv.state = 'verified'
              AND iv.verified_at IS NOT NULL
              AND iv.expires_at >= ?7
          )
        `
      : "";


  const assignmentUpdate =
    db
      .prepare(`
        UPDATE order_assignments AS a

        SET
          phase = ?4,
          phase_updated_at = ?7,
          verification_session_id =
            CASE
              WHEN ?4 =
                'en_route_to_pickup'
              THEN ?8
              ELSE verification_session_id
            END,
          revision = revision + 1

        WHERE a.id = ?1
          AND a.driver_id = ?2
          AND a.revision = ?3
          AND a.phase = ?5
          AND a.state = 'active'
          AND a.revoked_at IS NULL

          AND EXISTS (
            SELECT 1
            FROM orders o
            WHERE o.id = a.order_id
              AND o.driver_id = ?2
              AND o.status = 'taken'
          )

          ${verificationGuard}

          AND EXISTS (
            SELECT 1
            FROM mutation_idempotency mi
            WHERE mi.actor_account_id = ?2
              AND mi.operation = ?9
              AND mi.key_digest = ?10
              AND mi.request_digest = ?11
              AND mi.claim_id = ?12
              AND mi.state = 'in_progress'
          )
      `)
      .bind(
        assignment,
        driver,
        revision,
        toPhase,
        fromPhase,
        null,
        timestamp,
        verification,
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


  const statements = [
    claim,
    assignmentUpdate
  ];


  if (
    toPhase ===
      "in_trip"
  ) {

    statements.push(
      db
        .prepare(`
          UPDATE orders

          SET
            status = 'in_progress',
            revision = revision + 1,
            updated_at = ?4

          WHERE changes() = 1 AND id = (
            SELECT order_id
            FROM order_assignments
            WHERE id = ?1
              AND driver_id = ?2
              AND revision = ?3
              AND phase = 'in_trip'
              AND state = 'active'
              AND revoked_at IS NULL
          )
            AND driver_id = ?2
            AND status = 'taken'
        `)
        .bind(
          assignment,
          driver,
          revision + 1,
          timestamp
        )
    );
  }


  statements.push(
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
          'driver.assignment_phase_changed',
          'order_assignment',
          ?3,
          'success',
          ?4,
          ?5

        -- Immediately follows this batch's assignment/order UPDATE.
        WHERE changes() = 1 AND EXISTS (
          SELECT 1
          FROM order_assignments
          WHERE id = ?3
            AND driver_id = ?2
            AND revision = ?6
            AND phase = ?7
        )
      `)
      .bind(
        requireText(
          auditId,
          "auditId"
        ),
        driver,
        assignment,
        clean(
          requestId
        ) || null,
        timestamp,
        revision + 1,
        toPhase
      )
  );


  const successResult = {
    ok:
      true,

    assignment: {
      id:
        assignment,

      phase:
        toPhase,

      revision:
        revision + 1,

      verificationSessionId:
        toPhase ===
          "en_route_to_pickup"
          ? verification
          : null,

      updatedAt:
        timestamp
    }
  };


  statements.push(
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
            FROM order_assignments
            WHERE id = ?8
              AND driver_id = ?1
              AND revision = ?9
              AND phase = ?10
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
        assignment,
        revision + 1,
        toPhase
      )
  );


  const results =
    await db.batch(
      statements
    );


  if (
    !Array.isArray(
      results
    )
    ||
    results.length !==
      statements.length
  ) {
    throw new Error(
      "assignment phase transaction failed"
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
        "assignment phase idempotency invariant failed"
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
        "assignment phase conflict invariant failed"
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
        toPhase ===
          "en_route_to_pickup"
          ? "trip_verification_required"
          : "phase_preconditions_failed"
    };


    await finalizeConflictIdempotency(
      env,
      idempotency,
      {
        actorAccountId:
          driver,

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
      "incomplete assignment phase transaction"
    );
  }


  return {
    kind:
      "success",

    result:
      successResult
  };
}
