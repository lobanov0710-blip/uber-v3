// =========================================
// ADMIN ITEM MODERATION REPOSITORY
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
  const text = clean(value);

  if (!text) {
    throw new Error(
      `invalid moderation ${field}`
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
      `invalid moderation ${field}`
    );
  }

  return number;
}


function resultChanges(result) {
  if (
    result?.success !== true
  ) {
    throw new Error(
      "moderation D1 operation failed"
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
      "invalid moderation D1 change count"
    );
  }

  return count;
}


function moderationReviewStatement(
  db,
  {
    reviewId,
    actorAccountId,
    targetType,
    targetId,
    decision,
    note,
    createdAt,
    targetExistsSql,
    targetExistsArgs = []
  }
) {
  const sql = `
    INSERT INTO moderation_reviews (
      id,
      actor_account_id,
      target_type,
      target_id,
      decision,
      note,
      created_at
    )

    SELECT
      ?1,
      ?2,
      ?3,
      ?4,
      ?5,
      ?6,
      ?7

    WHERE EXISTS (
      ${targetExistsSql}
    )
  `;

  return db
    .prepare(sql)
    .bind(
      requireText(
        reviewId,
        "reviewId"
      ),
      requireText(
        actorAccountId,
        "actorAccountId"
      ),
      requireText(
        targetType,
        "targetType"
      ),
      requireText(
        targetId,
        "targetId"
      ),
      requireText(
        decision,
        "decision"
      ),
      note == null
        ? null
        : requireText(
            note,
            "note"
          ),
      requirePositiveInteger(
        createdAt,
        "createdAt"
      ),
      ...targetExistsArgs
    );
}


function auditStatement(
  db,
  {
    auditId,
    actorAccountId,
    action,
    targetType,
    targetId,
    requestId,
    createdAt,
    reviewId
  }
) {
  return db
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
        ?4,
        ?5,
        'success',
        ?6,
        ?7

      WHERE EXISTS (
        SELECT 1
        FROM moderation_reviews
        WHERE id = ?8
          AND actor_account_id = ?2
          AND target_type = ?4
          AND target_id = ?5
      )
    `)
    .bind(
      requireText(
        auditId,
        "auditId"
      ),
      requireText(
        actorAccountId,
        "actorAccountId"
      ),
      requireText(
        action,
        "action"
      ),
      requireText(
        targetType,
        "targetType"
      ),
      requireText(
        targetId,
        "targetId"
      ),
      clean(
        requestId
      ) || null,
      requirePositiveInteger(
        createdAt,
        "createdAt"
      ),
      requireText(
        reviewId,
        "reviewId"
      )
    );
}


function idempotencyCompleteStatement(
  db,
  idempotency,
  {
    actorAccountId,
    httpStatus,
    resultCode,
    result,
    completedAt,
    reviewId
  }
) {
  const statement =
    prepareMutationIdempotencyComplete(
      db,
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
        httpStatus,
        resultCode,
        result,
        completedAt
      }
    );

  // The helper generates the safe UPDATE.
  // Add exact review binding so success can
  // only be persisted when this request's
  // moderation record exists.
  const originalSql =
    statement.sql;

  if (
    typeof originalSql === "string"
  ) {
    // D1 prepared statements do not expose
    // mutable SQL in production; this branch
    // is only relevant to simple test fakes.
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
        AND EXISTS (
          SELECT 1
          FROM moderation_reviews
          WHERE id = ?10
            AND actor_account_id = ?1
        )
    `)
    .bind(
      requireText(
        actorAccountId,
        "actorAccountId"
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
      ),
      requireText(
        idempotency.claimId,
        "claimId"
      ),
      Number(httpStatus),
      resultCode == null
        ? null
        : requireText(
            resultCode,
            "resultCode"
          ),
      JSON.stringify(
        result
      ),
      requirePositiveInteger(
        completedAt,
        "completedAt"
      ),
      requireText(
        reviewId,
        "reviewId"
      )
    );
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
      "idempotency conflict completion failed"
    );
  }
}


async function executeModerationBatch(
  env,
  {
    actorAccountId,
    idempotency,
    updateStatement,
    reviewStatement,
    audit,
    successResult,
    conflictResult,
    completedAt,
    reviewId
  }
) {
  const db =
    requireDatabase(env);

  const claim =
    prepareMutationIdempotencyClaim(
      db,
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
        createdAt:
          completedAt
      }
    );

  const complete =
    idempotencyCompleteStatement(
      db,
      idempotency,
      {
        actorAccountId,
        httpStatus:
          200,
        resultCode:
          null,
        result:
          successResult,
        completedAt,
        reviewId
      }
    );

  const results =
    await db.batch([
      claim,
      updateStatement,
      reviewStatement,
      audit,
      complete
    ]);

  if (
    !Array.isArray(results) ||
    results.length !== 5
  ) {
    throw new Error(
      "moderation transaction failed"
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
        "idempotency race invariant failed"
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
      counts[3] !== 0 ||
      counts[4] !== 0
    ) {
      throw new Error(
        "moderation conflict invariant failed"
      );
    }

    await finalizeConflictIdempotency(
      env,
      idempotency,
      {
        actorAccountId,
        result:
          conflictResult,
        completedAt
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
    counts[3] !== 1 ||
    counts[4] !== 1
  ) {
    throw new Error(
      "incomplete moderation transaction"
    );
  }

  return {
    kind:
      "success",

    result:
      successResult
  };
}


export async function getAdminRegistrationReviewBundle(
  env,
  driverId
) {
  const driver =
    requireText(
      driverId,
      "driverId"
    );

  const db =
    requireDatabase(env);

  const profile =
    await db
      .prepare(`
        SELECT
          staff_account_id,
          full_name,
          birth_date,
          region,
          registration_status,
          identity_status,
          revision,
          submitted_at,
          updated_at

        FROM driver_profiles

        WHERE staff_account_id = ?1

        LIMIT 1
      `)
      .bind(
        driver
      )
      .first();

  if (!profile) {
    return null;
  }

  const vehicles =
    await db
      .prepare(`
        SELECT
          id,
          vin,
          plate,
          make,
          model,
          class,
          capacity,
          baggage_capacity,
          usage_basis,
          status,
          revision,
          updated_at

        FROM vehicles

        WHERE driver_id = ?1

        ORDER BY created_at ASC
      `)
      .bind(
        driver
      )
      .all();

  const documents =
    await db
      .prepare(`
        SELECT
          id,
          vehicle_id,
          kind,
          status,
          revision,
          updated_at

        FROM document_resources

        WHERE owner_driver_id = ?1

        ORDER BY created_at ASC
      `)
      .bind(
        driver
      )
      .all();

  const photos =
    await db
      .prepare(`
        SELECT
          vp.id,
          vp.vehicle_id,
          vp.kind,
          vp.status,
          vp.revision,
          vp.updated_at

        FROM vehicle_photos vp

        INNER JOIN vehicles v
          ON v.id = vp.vehicle_id

        WHERE v.driver_id = ?1
          AND vp.photo_check_id IS NULL

        ORDER BY vp.created_at ASC
      `)
      .bind(
        driver
      )
      .all();

  const reviews =
    await db
      .prepare(`
        SELECT
          target_type,
          target_id,
          decision,
          note,
          created_at

        FROM moderation_reviews

        WHERE target_id = ?1
           OR target_id IN (
                SELECT id
                FROM vehicles
                WHERE driver_id = ?1
              )
           OR target_id IN (
                SELECT id
                FROM document_resources
                WHERE owner_driver_id = ?1
              )
           OR target_id IN (
                SELECT vp.id
                FROM vehicle_photos vp
                INNER JOIN vehicles v
                  ON v.id = vp.vehicle_id
                WHERE v.driver_id = ?1
              )

        ORDER BY created_at DESC

        LIMIT 200
      `)
      .bind(
        driver
      )
      .all();

  for (
    const result of [
      vehicles,
      documents,
      photos,
      reviews
    ]
  ) {
    if (
      result?.success !== true ||
      !Array.isArray(
        result?.results
      )
    ) {
      throw new Error(
        "registration review bundle read failed"
      );
    }
  }

  return {
    profile: {
      driverId:
        clean(
          profile.staff_account_id
        ),
      fullName:
        profile.full_name == null
          ? null
          : clean(
              profile.full_name
            ),
      birthDate:
        profile.birth_date == null
          ? null
          : clean(
              profile.birth_date
            ),
      region:
        profile.region == null
          ? null
          : clean(
              profile.region
            ),
      registrationStatus:
        clean(
          profile.registration_status
        ),
      identityStatus:
        clean(
          profile.identity_status
        ),
      revision:
        Number(
          profile.revision
        ),
      submittedAt:
        profile.submitted_at == null
          ? null
          : Number(
              profile.submitted_at
            ),
      updatedAt:
        Number(
          profile.updated_at
        )
    },

    vehicles:
      vehicles.results.map(
        row => ({
          id:
            clean(
              row.id
            ),
          vin:
            clean(
              row.vin
            ),
          plate:
            clean(
              row.plate
            ),
          make:
            clean(
              row.make
            ),
          model:
            clean(
              row.model
            ),
          vehicleClass:
            clean(
              row.class
            ),
          capacity:
            Number(
              row.capacity
            ),
          baggageCapacity:
            clean(
              row.baggage_capacity
            ),
          usageBasis:
            row.usage_basis == null
              ? null
              : clean(
                  row.usage_basis
                ),
          status:
            clean(
              row.status
            ),
          revision:
            Number(
              row.revision
            ),
          updatedAt:
            Number(
              row.updated_at
            )
        })
      ),

    documents:
      documents.results.map(
        row => ({
          id:
            clean(
              row.id
            ),
          vehicleId:
            row.vehicle_id == null
              ? null
              : clean(
                  row.vehicle_id
                ),
          kind:
            clean(
              row.kind
            ),
          status:
            clean(
              row.status
            ),
          revision:
            Number(
              row.revision
            ),
          updatedAt:
            Number(
              row.updated_at
            )
        })
      ),

    photos:
      photos.results.map(
        row => ({
          id:
            clean(
              row.id
            ),
          vehicleId:
            clean(
              row.vehicle_id
            ),
          kind:
            clean(
              row.kind
            ),
          status:
            clean(
              row.status
            ),
          revision:
            Number(
              row.revision
            ),
          updatedAt:
            Number(
              row.updated_at
            )
        })
      ),

    reviews:
      reviews.results.map(
        row => ({
          targetType:
            clean(
              row.target_type
            ),
          targetId:
            clean(
              row.target_id
            ),
          decision:
            clean(
              row.decision
            ),
          note:
            row.note == null
              ? null
              : clean(
                  row.note
                ),
          createdAt:
            Number(
              row.created_at
            )
        })
      )
  };
}


export async function moderateDocument(
  env,
  {
    actorAccountId,
    driverId,
    documentId,
    expectedRevision,
    decision,
    note,
    reviewedAt,
    requestId,
    reviewId,
    auditId,
    idempotency
  }
) {
  const db =
    requireDatabase(env);

  const newStatus =
    requireText(
      decision,
      "decision"
    );

  const revision =
    requirePositiveInteger(
      expectedRevision,
      "expectedRevision"
    );

  const timestamp =
    requirePositiveInteger(
      reviewedAt,
      "reviewedAt"
    );

  const update =
    db
      .prepare(`
        UPDATE document_resources

        SET
          status = ?5,
          revision = revision + 1,
          last_review_id = ?6,
          updated_at = ?7

        WHERE id = ?1
          AND owner_driver_id = ?2
          AND revision = ?3
          AND status = ?4
          AND EXISTS (
            SELECT 1
            FROM driver_profiles
            WHERE staff_account_id = ?2
              AND registration_status =
                'under_review'
          )
          AND EXISTS (
            SELECT 1
            FROM mutation_idempotency
            WHERE actor_account_id = ?8
              AND operation = ?9
              AND key_digest = ?10
              AND request_digest = ?11
              AND claim_id = ?12
              AND state = 'in_progress'
          )
      `)
      .bind(
        requireText(
          documentId,
          "documentId"
        ),
        requireText(
          driverId,
          "driverId"
        ),
        revision,
        "pending",
        newStatus,
        requireText(
          reviewId,
          "reviewId"
        ),
        timestamp,
        requireText(
          actorAccountId,
          "actorAccountId"
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
        ),
        requireText(
          idempotency.claimId,
          "claimId"
        )
      );

  const review =
    moderationReviewStatement(
      db,
      {
        reviewId,
        actorAccountId,
        targetType:
          "document",
        targetId:
          documentId,
        decision,
        note,
        createdAt:
          timestamp,
        targetExistsSql: `
          SELECT 1
          FROM document_resources
          WHERE id = ?8
            AND owner_driver_id = ?9
            AND revision = ?10
            AND last_review_id = ?11
            AND status = ?12
        `,
        targetExistsArgs: [
          documentId,
          driverId,
          revision + 1,
          reviewId,
          newStatus
        ]
      }
    );

  const successResult = {
    ok:
      true,
    target: {
      type:
        "document",
      id:
        documentId,
      status:
        newStatus,
      revision:
        revision + 1
    }
  };

  const conflictResult = {
    ok:
      false,
    status:
      409,
    error:
      "conflict",
    code:
      "moderation_revision_conflict"
  };

  return executeModerationBatch(
    env,
    {
      actorAccountId,
      idempotency,
      updateStatement:
        update,
      reviewStatement:
        review,
      audit:
        auditStatement(
          db,
          {
            auditId,
            actorAccountId,
            action:
              "admin.document_reviewed",
            targetType:
              "document",
            targetId:
              documentId,
            requestId,
            createdAt:
              timestamp,
            reviewId
          }
        ),
      successResult,
      conflictResult,
      completedAt:
        timestamp,
      reviewId
    }
  );
}


export async function moderateVehiclePhoto(
  env,
  {
    actorAccountId,
    driverId,
    photoId,
    expectedRevision,
    decision,
    note,
    reviewedAt,
    requestId,
    reviewId,
    auditId,
    idempotency
  }
) {
  const db =
    requireDatabase(env);

  const newStatus =
    requireText(
      decision,
      "decision"
    );

  const revision =
    requirePositiveInteger(
      expectedRevision,
      "expectedRevision"
    );

  const timestamp =
    requirePositiveInteger(
      reviewedAt,
      "reviewedAt"
    );

  const update =
    db
      .prepare(`
        UPDATE vehicle_photos

        SET
          status = ?5,
          revision = revision + 1,
          last_review_id = ?6,
          updated_at = ?7

        WHERE id = ?1
          AND revision = ?3
          AND status = ?4
          AND EXISTS (
            SELECT 1
            FROM vehicles v
            INNER JOIN driver_profiles p
              ON p.staff_account_id =
                 v.driver_id
            WHERE v.id =
                  vehicle_photos.vehicle_id
              AND v.driver_id = ?2
              AND p.registration_status =
                  'under_review'
          )
          AND EXISTS (
            SELECT 1
            FROM mutation_idempotency
            WHERE actor_account_id = ?8
              AND operation = ?9
              AND key_digest = ?10
              AND request_digest = ?11
              AND claim_id = ?12
              AND state = 'in_progress'
          )
      `)
      .bind(
        requireText(
          photoId,
          "photoId"
        ),
        requireText(
          driverId,
          "driverId"
        ),
        revision,
        "pending",
        newStatus,
        requireText(
          reviewId,
          "reviewId"
        ),
        timestamp,
        requireText(
          actorAccountId,
          "actorAccountId"
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
        ),
        requireText(
          idempotency.claimId,
          "claimId"
        )
      );

  const review =
    moderationReviewStatement(
      db,
      {
        reviewId,
        actorAccountId,
        targetType:
          "vehicle_photo",
        targetId:
          photoId,
        decision,
        note,
        createdAt:
          timestamp,
        targetExistsSql: `
          SELECT 1
          FROM vehicle_photos vp
          INNER JOIN vehicles v
            ON v.id = vp.vehicle_id
          WHERE vp.id = ?8
            AND v.driver_id = ?9
            AND vp.revision = ?10
            AND vp.last_review_id = ?11
            AND vp.status = ?12
        `,
        targetExistsArgs: [
          photoId,
          driverId,
          revision + 1,
          reviewId,
          newStatus
        ]
      }
    );

  const successResult = {
    ok:
      true,
    target: {
      type:
        "vehicle_photo",
      id:
        photoId,
      status:
        newStatus,
      revision:
        revision + 1
    }
  };

  const conflictResult = {
    ok:
      false,
    status:
      409,
    error:
      "conflict",
    code:
      "moderation_revision_conflict"
  };

  return executeModerationBatch(
    env,
    {
      actorAccountId,
      idempotency,
      updateStatement:
        update,
      reviewStatement:
        review,
      audit:
        auditStatement(
          db,
          {
            auditId,
            actorAccountId,
            action:
              "admin.vehicle_photo_reviewed",
            targetType:
              "vehicle_photo",
            targetId:
              photoId,
            requestId,
            createdAt:
              timestamp,
            reviewId
          }
        ),
      successResult,
      conflictResult,
      completedAt:
        timestamp,
      reviewId
    }
  );
}


export async function moderateVehicle(
  env,
  {
    actorAccountId,
    driverId,
    vehicleId,
    expectedRevision,
    decision,
    note,
    reviewedAt,
    requestId,
    reviewId,
    auditId,
    idempotency
  }
) {
  const db =
    requireDatabase(env);

  const revision =
    requirePositiveInteger(
      expectedRevision,
      "expectedRevision"
    );

  const timestamp =
    requirePositiveInteger(
      reviewedAt,
      "reviewedAt"
    );

  const normalizedDecision =
    requireText(
      decision,
      "decision"
    );

  const newStatus =
    normalizedDecision ===
      "approved"
      ? "approved"
      : normalizedDecision ===
          "rejected"
        ? "rejected"
        : "pending_review";

  const approvalGuard =
    normalizedDecision ===
      "approved"
      ? `
          AND usage_basis IS NOT NULL

          AND EXISTS (
            SELECT 1
            FROM document_resources d
            WHERE d.owner_driver_id = ?2
              AND d.vehicle_id = ?1
              AND d.kind = 'sts_front'
              AND d.status = 'verified'
          )

          AND EXISTS (
            SELECT 1
            FROM document_resources d
            WHERE d.owner_driver_id = ?2
              AND d.vehicle_id = ?1
              AND d.kind = 'sts_back'
              AND d.status = 'verified'
          )

          AND (
            usage_basis != 'rental'
            OR EXISTS (
              SELECT 1
              FROM document_resources d
              WHERE d.owner_driver_id = ?2
                AND d.vehicle_id = ?1
                AND d.kind = 'rental_contract'
                AND d.status = 'verified'
            )
          )

          AND 7 = (
            SELECT COUNT(
              DISTINCT vp.kind
            )
            FROM vehicle_photos vp
            WHERE vp.vehicle_id = ?1
              AND vp.photo_check_id IS NULL
              AND vp.status = 'verified'
              AND vp.kind IN (
                'left',
                'front',
                'right',
                'rear',
                'open_trunk',
                'rear_cabin',
                'front_cabin'
              )
          )
        `
      : "";

  const update =
    db
      .prepare(`
        UPDATE vehicles

        SET
          status = ?5,
          revision = revision + 1,
          last_review_id = ?6,
          updated_at = ?7

        WHERE id = ?1
          AND driver_id = ?2
          AND revision = ?3
          AND status = ?4

          ${approvalGuard}

          AND EXISTS (
            SELECT 1
            FROM driver_profiles
            WHERE staff_account_id = ?2
              AND registration_status =
                'under_review'
          )

          AND EXISTS (
            SELECT 1
            FROM mutation_idempotency
            WHERE actor_account_id = ?8
              AND operation = ?9
              AND key_digest = ?10
              AND request_digest = ?11
              AND claim_id = ?12
              AND state = 'in_progress'
          )
      `)
      .bind(
        requireText(
          vehicleId,
          "vehicleId"
        ),
        requireText(
          driverId,
          "driverId"
        ),
        revision,
        "pending_review",
        newStatus,
        requireText(
          reviewId,
          "reviewId"
        ),
        timestamp,
        requireText(
          actorAccountId,
          "actorAccountId"
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
        ),
        requireText(
          idempotency.claimId,
          "claimId"
        )
      );

  const review =
    moderationReviewStatement(
      db,
      {
        reviewId,
        actorAccountId,
        targetType:
          "vehicle",
        targetId:
          vehicleId,
        decision:
          normalizedDecision,
        note,
        createdAt:
          timestamp,
        targetExistsSql: `
          SELECT 1
          FROM vehicles
          WHERE id = ?8
            AND driver_id = ?9
            AND revision = ?10
            AND last_review_id = ?11
            AND status = ?12
        `,
        targetExistsArgs: [
          vehicleId,
          driverId,
          revision + 1,
          reviewId,
          newStatus
        ]
      }
    );

  const successResult = {
    ok:
      true,
    target: {
      type:
        "vehicle",
      id:
        vehicleId,
      status:
        newStatus,
      decision:
        normalizedDecision,
      revision:
        revision + 1
    }
  };

  const conflictResult = {
    ok:
      false,
    status:
      409,
    error:
      "conflict",
    code:
      normalizedDecision ===
        "approved"
        ? "vehicle_review_preconditions_failed"
        : "moderation_revision_conflict"
  };

  return executeModerationBatch(
    env,
    {
      actorAccountId,
      idempotency,
      updateStatement:
        update,
      reviewStatement:
        review,
      audit:
        auditStatement(
          db,
          {
            auditId,
            actorAccountId,
            action:
              "admin.vehicle_reviewed",
            targetType:
              "vehicle",
            targetId:
              vehicleId,
            requestId,
            createdAt:
              timestamp,
            reviewId
          }
        ),
      successResult,
      conflictResult,
      completedAt:
        timestamp,
      reviewId
    }
  );
}


export async function finalizeDriverRegistrationModeration(
  env,
  {
    actorAccountId,
    driverId,
    expectedRevision,
    decision,
    note,
    reviewedAt,
    requestId,
    reviewId,
    auditId,
    idempotency
  }
) {
  const db =
    requireDatabase(env);

  const revision =
    requirePositiveInteger(
      expectedRevision,
      "expectedRevision"
    );

  const timestamp =
    requirePositiveInteger(
      reviewedAt,
      "reviewedAt"
    );

  const normalizedDecision =
    requireText(
      decision,
      "decision"
    );

  const newStatus =
    normalizedDecision ===
      "approved"
      ? "approved"
      : normalizedDecision ===
          "rejected"
        ? "rejected"
        : "changes_required";

  const approvalGuard =
    normalizedDecision ===
      "approved"
      ? `
          AND identity_status = 'verified'

          AND EXISTS (
            SELECT 1
            FROM document_resources d
            WHERE d.owner_driver_id = ?1
              AND d.vehicle_id IS NULL
              AND d.kind = 'passport_main'
              AND d.status = 'verified'
          )

          AND EXISTS (
            SELECT 1
            FROM document_resources d
            WHERE d.owner_driver_id = ?1
              AND d.vehicle_id IS NULL
              AND d.kind = 'passport_registration'
              AND d.status = 'verified'
          )

          AND EXISTS (
            SELECT 1
            FROM document_resources d
            WHERE d.owner_driver_id = ?1
              AND d.vehicle_id IS NULL
              AND d.kind = 'passport_selfie'
              AND d.status = 'verified'
          )

          AND EXISTS (
            SELECT 1
            FROM document_resources d
            WHERE d.owner_driver_id = ?1
              AND d.vehicle_id IS NULL
              AND d.kind = 'identity_reference_selfie'
              AND d.status = 'verified'
          )

          AND EXISTS (
            SELECT 1
            FROM document_resources d
            WHERE d.owner_driver_id = ?1
              AND d.vehicle_id IS NULL
              AND d.kind = 'driver_license_front'
              AND d.status = 'verified'
          )

          AND EXISTS (
            SELECT 1
            FROM document_resources d
            WHERE d.owner_driver_id = ?1
              AND d.vehicle_id IS NULL
              AND d.kind = 'driver_license_back'
              AND d.status = 'verified'
          )

          AND EXISTS (
            SELECT 1
            FROM vehicles v
            WHERE v.driver_id = ?1
              AND v.status = 'approved'
          )
        `
      : "";

  const update =
    db
      .prepare(`
        UPDATE driver_profiles

        SET
          registration_status = ?4,
          revision = revision + 1,
          last_review_id = ?5,
          updated_at = ?6

        WHERE staff_account_id = ?1
          AND revision = ?2
          AND registration_status = ?3

          ${approvalGuard}

          AND EXISTS (
            SELECT 1
            FROM mutation_idempotency
            WHERE actor_account_id = ?7
              AND operation = ?8
              AND key_digest = ?9
              AND request_digest = ?10
              AND claim_id = ?11
              AND state = 'in_progress'
          )
      `)
      .bind(
        requireText(
          driverId,
          "driverId"
        ),
        revision,
        "under_review",
        newStatus,
        requireText(
          reviewId,
          "reviewId"
        ),
        timestamp,
        requireText(
          actorAccountId,
          "actorAccountId"
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
        ),
        requireText(
          idempotency.claimId,
          "claimId"
        )
      );

  const review =
    moderationReviewStatement(
      db,
      {
        reviewId,
        actorAccountId,
        targetType:
          "driver_registration",
        targetId:
          driverId,
        decision:
          normalizedDecision,
        note,
        createdAt:
          timestamp,
        targetExistsSql: `
          SELECT 1
          FROM driver_profiles
          WHERE staff_account_id = ?8
            AND revision = ?9
            AND last_review_id = ?10
            AND registration_status = ?11
        `,
        targetExistsArgs: [
          driverId,
          revision + 1,
          reviewId,
          newStatus
        ]
      }
    );

  const successResult = {
    ok:
      true,
    registration: {
      driverId,
      status:
        newStatus,
      decision:
        normalizedDecision,
      revision:
        revision + 1
    }
  };

  const conflictResult = {
    ok:
      false,
    status:
      409,
    error:
      "conflict",
    code:
      normalizedDecision ===
        "approved"
        ? "registration_approval_preconditions_failed"
        : "moderation_revision_conflict"
  };

  return executeModerationBatch(
    env,
    {
      actorAccountId,
      idempotency,
      updateStatement:
        update,
      reviewStatement:
        review,
      audit:
        auditStatement(
          db,
          {
            auditId,
            actorAccountId,
            action:
              "admin.registration_review_completed",
            targetType:
              "driver_profile",
            targetId:
              driverId,
            requestId,
            createdAt:
              timestamp,
            reviewId
          }
        ),
      successResult,
      conflictResult,
      completedAt:
        timestamp,
      reviewId
    }
  );
}


export async function startRegistrationReviewIdempotent(
  env,
  {
    actorAccountId,
    driverId,
    expectedRevision,
    reviewedAt,
    requestId,
    reviewId,
    auditId,
    idempotency
  }
) {
  const db =
    requireDatabase(env);

  const revision =
    requirePositiveInteger(
      expectedRevision,
      "expectedRevision"
    );

  const timestamp =
    requirePositiveInteger(
      reviewedAt,
      "reviewedAt"
    );

  const update =
    db
      .prepare(`
        UPDATE driver_profiles

        SET
          registration_status =
            'under_review',
          revision =
            revision + 1,
          last_review_id =
            ?4,
          updated_at =
            ?5

        WHERE staff_account_id = ?1
          AND revision = ?2
          AND registration_status = ?3

          AND EXISTS (
            SELECT 1
            FROM mutation_idempotency
            WHERE actor_account_id = ?6
              AND operation = ?7
              AND key_digest = ?8
              AND request_digest = ?9
              AND claim_id = ?10
              AND state = 'in_progress'
          )
      `)
      .bind(
        requireText(
          driverId,
          "driverId"
        ),
        revision,
        "submitted",
        requireText(
          reviewId,
          "reviewId"
        ),
        timestamp,
        requireText(
          actorAccountId,
          "actorAccountId"
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
        ),
        requireText(
          idempotency.claimId,
          "claimId"
        )
      );

  const review =
    moderationReviewStatement(
      db,
      {
        reviewId,
        actorAccountId,
        targetType:
          "driver_registration",
        targetId:
          driverId,
        decision:
          "under_review",
        note:
          null,
        createdAt:
          timestamp,
        targetExistsSql: `
          SELECT 1
          FROM driver_profiles
          WHERE staff_account_id = ?8
            AND revision = ?9
            AND last_review_id = ?10
            AND registration_status =
              'under_review'
        `,
        targetExistsArgs: [
          driverId,
          revision + 1,
          reviewId
        ]
      }
    );

  const successResult = {
    ok:
      true,
    registration: {
      driverId,
      status:
        "under_review",
      revision:
        revision + 1,
      reviewedAt:
        timestamp
    }
  };

  const conflictResult = {
    ok:
      false,
    status:
      409,
    error:
      "conflict",
    code:
      "registration_review_conflict"
  };

  return executeModerationBatch(
    env,
    {
      actorAccountId,
      idempotency,
      updateStatement:
        update,
      reviewStatement:
        review,
      audit:
        auditStatement(
          db,
          {
            auditId,
            actorAccountId,
            action:
              "admin.registration_review_started",
            targetType:
              "driver_profile",
            targetId:
              driverId,
            requestId,
            createdAt:
              timestamp,
            reviewId
          }
        ),
      successResult,
      conflictResult,
      completedAt:
        timestamp,
      reviewId
    }
  );
}
