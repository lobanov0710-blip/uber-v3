// =========================================
// VEHICLE PHOTO CONTROL REPOSITORY
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
      `invalid photo control ${field}`
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
      `invalid photo control ${field}`
    );
  }

  return number;
}


function resultChanges(result) {
  if (
    result?.success !== true
  ) {
    throw new Error(
      "photo control D1 failure"
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
      "invalid photo control D1 change count"
    );
  }

  return count;
}


export async function getVehiclePhotoControlState(
  env,
  vehicleId
) {
  const db =
    requireDatabase(env);

  const row =
    await db
      .prepare(`
        SELECT
          id,
          driver_id,
          status,
          revision,
          updated_at

        FROM vehicles

        WHERE id = ?1

        LIMIT 1
      `)
      .bind(
        requireText(
          vehicleId,
          "vehicleId"
        )
      )
      .first();


  if (!row) {
    return null;
  }


  return {
    id:
      clean(row.id),

    driverId:
      clean(row.driver_id),

    status:
      clean(row.status),

    revision:
      Number(row.revision),

    updatedAt:
      Number(row.updated_at)
  };
}


export async function getDriverPhotoCheckUploadState(
  env,
  {
    driverId,
    vehicleId,
    photoCheckId
  }
) {
  const db =
    requireDatabase(env);

  const row =
    await db
      .prepare(`
        SELECT
          pc.id,
          pc.vehicle_id,
          pc.result,
          pc.revision,
          pc.due_at,
          pc.grace_until,
          pc.restriction_mode,
          v.driver_id

        FROM vehicle_photo_checks pc

        INNER JOIN vehicles v
          ON v.id = pc.vehicle_id

        WHERE pc.id = ?1
          AND pc.vehicle_id = ?2
          AND v.driver_id = ?3

        LIMIT 1
      `)
      .bind(
        requireText(
          photoCheckId,
          "photoCheckId"
        ),
        requireText(
          vehicleId,
          "vehicleId"
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
      clean(row.id),
    vehicleId:
      clean(row.vehicle_id),
    driverId:
      clean(row.driver_id),
    result:
      clean(row.result),
    revision:
      Number(row.revision),
    dueAt:
      Number(row.due_at),
    graceUntil:
      Number(row.grace_until),
    restrictionMode:
      clean(row.restriction_mode)
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
      "photo control conflict idempotency completion failed"
    );
  }
}


export async function createVehiclePhotoCheck(
  env,
  {
    actorAccountId,
    vehicleId,
    expectedRevision,
    checkId,
    kind,
    reason,
    restrictionMode,
    dueAt,
    graceUntil,
    createdAt,
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

  const vehicle =
    requireText(
      vehicleId,
      "vehicleId"
    );

  const revision =
    requirePositiveInteger(
      expectedRevision,
      "expectedRevision"
    );

  const check =
    requireText(
      checkId,
      "checkId"
    );

  const timestamp =
    requirePositiveInteger(
      createdAt,
      "createdAt"
    );

  const due =
    requirePositiveInteger(
      dueAt,
      "dueAt"
    );

  const grace =
    requirePositiveInteger(
      graceUntil,
      "graceUntil"
    );


  if (
    grace < due
  ) {
    throw new Error(
      "invalid photo control grace"
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


  const vehicleUpdate =
    db
      .prepare(`
        UPDATE vehicles

        SET
          revision = revision + 1,
          updated_at =
            CASE
              WHEN updated_at >= ?3
                THEN updated_at + 1
              ELSE ?3
            END

        WHERE id = ?1
          AND revision = ?2
          AND status IN (
            'approved',
            'photo_check_required',
            'suspended'
          )

          AND EXISTS (
            SELECT 1
            FROM mutation_idempotency mi
            WHERE mi.actor_account_id = ?4
              AND mi.operation = ?5
              AND mi.key_digest = ?6
              AND mi.request_digest = ?7
              AND mi.claim_id = ?8
              AND mi.state = 'in_progress'
          )
      `)
      .bind(
        vehicle,
        revision,
        timestamp,
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
        )
      );


  const insert =
    db
      .prepare(`
        INSERT INTO vehicle_photo_checks (
          id,
          vehicle_id,
          kind,
          reason,
          due_at,
          grace_until,
          result,
          reviewed_by,
          reviewed_at,
          created_at,
          updated_at,
          revision,
          restriction_mode,
          created_by
        )

        SELECT
          ?1,
          ?2,
          ?3,
          ?4,
          ?5,
          ?6,
          'pending',
          NULL,
          NULL,
          ?7,
          ?7,
          1,
          ?8,
          ?9

        WHERE changes() = 1

          AND EXISTS (
            SELECT 1
            FROM vehicles v
            WHERE v.id = ?2
              AND v.revision = ?10
          )

          AND EXISTS (
            SELECT 1
            FROM mutation_idempotency mi
            WHERE mi.actor_account_id = ?9
              AND mi.operation = ?11
              AND mi.key_digest = ?12
              AND mi.request_digest = ?13
              AND mi.claim_id = ?14
              AND mi.state = 'in_progress'
          )
      `)
      .bind(
        check,
        vehicle,
        requireText(
          kind,
          "kind"
        ),
        requireText(
          reason,
          "reason"
        ),
        due,
        grace,
        timestamp,
        requireText(
          restrictionMode,
          "restrictionMode"
        ),
        actor,
        revision + 1,
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
          'admin.vehicle_photo_check_requested',
          'vehicle_photo_check',
          ?3,
          'success',
          ?4,
          ?5

        WHERE changes() = 1

          AND EXISTS (
            SELECT 1
            FROM vehicle_photo_checks
            WHERE id = ?3
              AND vehicle_id = ?6
              AND created_by = ?2
          )
      `)
      .bind(
        requireText(
          auditId,
          "auditId"
        ),
        actor,
        check,
        clean(requestId) || null,
        timestamp,
        vehicle
      );


  const successResult = {
    ok:
      true,

    photoCheck: {
      id:
        check,
      vehicleId:
        vehicle,
      kind:
        clean(kind),
      restrictionMode:
        clean(restrictionMode),
      result:
        "pending",
      dueAt:
        due,
      graceUntil:
        grace,
      revision:
        1,
      vehicleRevision:
        revision + 1,
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
            FROM vehicle_photo_checks
            WHERE id = ?8
              AND vehicle_id = ?9
              AND created_by = ?1
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
        check,
        vehicle
      );


  const results =
    await db.batch([
      claim,
      vehicleUpdate,
      insert,
      audit,
      complete
    ]);


  if (
    !Array.isArray(results) ||
    results.length !== 5
  ) {
    throw new Error(
      "photo control transaction failed"
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
        "photo control idempotency invariant failed"
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
        "photo control conflict invariant failed"
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
        "vehicle_photo_check_preconditions_failed"
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
      "incomplete photo control transaction"
    );
  }


  return {
    kind:
      "success",
    result:
      successResult
  };
}

// =========================================
// PHOTO-CHECK READ MODELS
// =========================================

const REQUIRED_PHOTO_KINDS = [
  "left",
  "front",
  "right",
  "rear",
  "open_trunk",
  "rear_cabin",
  "front_cabin"
];


export async function getAdminVehiclePhotoCheckBundle(
  env,
  vehicleId,
  photoCheckId
) {
  const db =
    requireDatabase(env);

  const vehicle =
    requireText(
      vehicleId,
      "vehicleId"
    );

  const checkId =
    requireText(
      photoCheckId,
      "photoCheckId"
    );


  const row =
    await db
      .prepare(`
        SELECT
          pc.id,
          pc.vehicle_id,
          pc.kind,
          pc.reason,
          pc.due_at,
          pc.grace_until,
          pc.result,
          pc.reviewed_by,
          pc.reviewed_at,
          pc.created_at,
          pc.updated_at,
          pc.revision,
          pc.restriction_mode,
          pc.created_by,
          pc.next_due_at,

          v.driver_id,
          v.status AS vehicle_status,
          v.revision AS vehicle_revision,
          v.last_photo_check_passed_at,
          v.next_photo_check_due_at

        FROM vehicle_photo_checks pc

        INNER JOIN vehicles v
          ON v.id = pc.vehicle_id

        WHERE pc.id = ?1
          AND pc.vehicle_id = ?2

        LIMIT 1
      `)
      .bind(
        checkId,
        vehicle
      )
      .first();


  if (!row) {
    return null;
  }


  const photos =
    await db
      .prepare(`
        SELECT
          id,
          kind,
          status,
          revision,
          created_at,
          updated_at

        FROM vehicle_photos

        WHERE photo_check_id = ?1
          AND vehicle_id = ?2

        ORDER BY
          created_at ASC,
          id ASC
      `)
      .bind(
        checkId,
        vehicle
      )
      .all();


  const reviews =
    await db
      .prepare(`
        SELECT
          id,
          actor_account_id,
          decision,
          note,
          created_at

        FROM vehicle_photo_check_reviews

        WHERE photo_check_id = ?1

        ORDER BY
          created_at DESC,
          id DESC

        LIMIT 100
      `)
      .bind(
        checkId
      )
      .all();


  if (
    photos?.success !== true ||
    !Array.isArray(
      photos?.results
    ) ||
    reviews?.success !== true ||
    !Array.isArray(
      reviews?.results
    )
  ) {
    throw new Error(
      "photo control bundle read failed"
    );
  }


  return {
    id:
      clean(row.id),
    vehicleId:
      clean(row.vehicle_id),
    driverId:
      clean(row.driver_id),
    kind:
      clean(row.kind),
    reason:
      clean(row.reason),
    dueAt:
      Number(row.due_at),
    graceUntil:
      Number(row.grace_until),
    result:
      clean(row.result),
    reviewedBy:
      row.reviewed_by == null
        ? null
        : clean(row.reviewed_by),
    reviewedAt:
      row.reviewed_at == null
        ? null
        : Number(row.reviewed_at),
    createdAt:
      Number(row.created_at),
    updatedAt:
      Number(row.updated_at),
    revision:
      Number(row.revision),
    restrictionMode:
      clean(row.restriction_mode),
    createdBy:
      row.created_by == null
        ? null
        : clean(row.created_by),
    nextDueAt:
      row.next_due_at == null
        ? null
        : Number(row.next_due_at),
    vehicleStatus:
      clean(row.vehicle_status),
    vehicleRevision:
      Number(row.vehicle_revision),
    lastPhotoCheckPassedAt:
      row.last_photo_check_passed_at == null
        ? null
        : Number(
            row.last_photo_check_passed_at
          ),
    vehicleNextPhotoCheckDueAt:
      row.next_photo_check_due_at == null
        ? null
        : Number(
            row.next_photo_check_due_at
          ),
    photos:
      photos.results.map(
        photo => ({
          id:
            clean(photo.id),
          kind:
            clean(photo.kind),
          status:
            clean(photo.status),
          revision:
            Number(photo.revision),
          createdAt:
            Number(photo.created_at),
          updatedAt:
            Number(photo.updated_at)
        })
      ),
    reviews:
      reviews.results.map(
        review => ({
          id:
            clean(review.id),
          actorAccountId:
            clean(
              review.actor_account_id
            ),
          decision:
            clean(review.decision),
          note:
            review.note == null
              ? null
              : clean(review.note),
          createdAt:
            Number(review.created_at)
        })
      )
  };
}


export async function listDriverOpenPhotoChecks(
  env,
  driverId
) {
  const db =
    requireDatabase(env);

  const driver =
    requireText(
      driverId,
      "driverId"
    );


  const result =
    await db
      .prepare(`
        SELECT
          pc.id,
          pc.vehicle_id,
          pc.kind,
          pc.reason,
          pc.due_at,
          pc.grace_until,
          pc.result,
          pc.revision,
          pc.restriction_mode,
          pc.created_at,
          pc.updated_at,

          (
            SELECT COUNT(
              DISTINCT vp.kind
            )
            FROM vehicle_photos vp
            WHERE vp.photo_check_id = pc.id
              AND vp.vehicle_id = pc.vehicle_id
              AND vp.kind IN (
                'left',
                'front',
                'right',
                'rear',
                'open_trunk',
                'rear_cabin',
                'front_cabin'
              )
          ) AS uploaded_kind_count,

          (
            SELECT GROUP_CONCAT(
              vp.kind,
              '|'
            )
            FROM vehicle_photos vp
            WHERE vp.photo_check_id = pc.id
              AND vp.vehicle_id = pc.vehicle_id
              AND vp.kind IN (
                'left',
                'front',
                'right',
                'rear',
                'open_trunk',
                'rear_cabin',
                'front_cabin'
              )
          ) AS uploaded_kinds

        FROM vehicle_photo_checks pc

        INNER JOIN vehicles v
          ON v.id = pc.vehicle_id

        WHERE v.driver_id = ?1
          AND pc.result != 'passed'

        ORDER BY
          pc.due_at ASC,
          pc.created_at ASC
      `)
      .bind(
        driver
      )
      .all();


  if (
    result?.success !== true ||
    !Array.isArray(
      result?.results
    )
  ) {
    throw new Error(
      "driver photo controls query failed"
    );
  }


  return result.results.map(
    row => ({
      id:
        clean(row.id),
      vehicleId:
        clean(row.vehicle_id),
      kind:
        clean(row.kind),
      reason:
        clean(row.reason),
      dueAt:
        Number(row.due_at),
      graceUntil:
        Number(row.grace_until),
      result:
        clean(row.result),
      revision:
        Number(row.revision),
      restrictionMode:
        clean(row.restriction_mode),
      uploadedKindCount:
        Number(
          row.uploaded_kind_count
        ),
      uploadedKinds:
        REQUIRED_PHOTO_KINDS
          .filter(
            kind =>
              new Set(
                clean(
                  row.uploaded_kinds
                )
                  .split("|")
                  .filter(Boolean)
              )
                .has(kind)
          ),
      requiredKindCount:
        REQUIRED_PHOTO_KINDS.length,
      createdAt:
        Number(row.created_at),
      updatedAt:
        Number(row.updated_at)
    })
  );
}


// =========================================
// PHOTO-CHECK REVIEW
// =========================================

export async function reviewVehiclePhotoCheck(
  env,
  {
    actorAccountId,
    vehicleId,
    photoCheckId,
    expectedRevision,
    expectedVehicleRevision,
    decision,
    note,
    reviewedAt,
    nextDueAt,
    reviewId,
    auditId,
    requestId,
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

  const vehicle =
    requireText(
      vehicleId,
      "vehicleId"
    );

  const checkId =
    requireText(
      photoCheckId,
      "photoCheckId"
    );

  const revision =
    requirePositiveInteger(
      expectedRevision,
      "expectedRevision"
    );

  const vehicleRevision =
    requirePositiveInteger(
      expectedVehicleRevision,
      "expectedVehicleRevision"
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

  const review =
    requireText(
      reviewId,
      "reviewId"
    );

  const normalizedNextDue =
    normalizedDecision === "passed"
      ? requirePositiveInteger(
          nextDueAt,
          "nextDueAt"
        )
      : null;


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


  const photoGuard =
    normalizedDecision === "passed"
      ? `
          AND 7 = (
            SELECT COUNT(
              DISTINCT vp.kind
            )
            FROM vehicle_photos vp
            WHERE vp.photo_check_id = ?1
              AND vp.vehicle_id = ?2
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


  const checkUpdate =
    db
      .prepare(`
        UPDATE vehicle_photo_checks

        SET
          result = ?4,
          reviewed_by = ?5,
          reviewed_at = ?6,
          updated_at = ?6,
          revision = revision + 1,
          next_due_at = ?7,
          last_review_id = ?8

        WHERE id = ?1
          AND vehicle_id = ?2
          AND revision = ?3
          AND result != 'passed'

          ${photoGuard}

          AND EXISTS (
            SELECT 1
            FROM vehicles v
            WHERE v.id = ?2
              AND v.revision = ?9
          )

          AND EXISTS (
            SELECT 1
            FROM mutation_idempotency mi
            WHERE mi.actor_account_id = ?5
              AND mi.operation = ?10
              AND mi.key_digest = ?11
              AND mi.request_digest = ?12
              AND mi.claim_id = ?13
              AND mi.state = 'in_progress'
          )
      `)
      .bind(
        checkId,
        vehicle,
        revision,
        normalizedDecision,
        actor,
        timestamp,
        normalizedNextDue,
        review,
        vehicleRevision,
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


  const reviewInsert =
    db
      .prepare(`
        INSERT INTO vehicle_photo_check_reviews (
          id,
          photo_check_id,
          actor_account_id,
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
          ?6

        WHERE changes() = 1

          AND EXISTS (
            SELECT 1
            FROM vehicle_photo_checks pc
            WHERE pc.id = ?2
              AND pc.vehicle_id = ?7
              AND pc.revision = ?8
              AND pc.result = ?4
              AND pc.last_review_id = ?1
          )
      `)
      .bind(
        review,
        checkId,
        actor,
        normalizedDecision,
        note == null ||
          clean(note) === ""
          ? null
          : requireText(
              note,
              "note"
            ),
        timestamp,
        vehicle,
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
          'admin.vehicle_photo_check_reviewed',
          'vehicle_photo_check',
          ?3,
          'success',
          ?4,
          ?5

        WHERE changes() = 1

          AND EXISTS (
            SELECT 1
            FROM vehicle_photo_check_reviews r
            WHERE r.id = ?6
              AND r.photo_check_id = ?3
              AND r.actor_account_id = ?2
          )
      `)
      .bind(
        requireText(
          auditId,
          "auditId"
        ),
        actor,
        checkId,
        clean(requestId) || null,
        timestamp,
        review
      );


  const vehicleUpdate =
    normalizedDecision === "passed"
      ? db
          .prepare(`
            UPDATE vehicles

            SET
              last_photo_check_passed_at = ?3,
              next_photo_check_due_at = ?4,
              revision = revision + 1,
              updated_at =
                CASE
                  WHEN updated_at >= ?3
                    THEN updated_at + 1
                  ELSE ?3
                END

            WHERE id = ?1
              AND revision = ?2

              AND changes() = 1

              AND EXISTS (
                SELECT 1
                FROM vehicle_photo_checks pc
                WHERE pc.id = ?5
                  AND pc.vehicle_id = ?1
                  AND pc.result = 'passed'
                  AND pc.revision = ?6
                  AND pc.last_review_id = ?7
              )
          `)
          .bind(
            vehicle,
            vehicleRevision,
            timestamp,
            normalizedNextDue,
            checkId,
            revision + 1,
            review
          )
      : null;


  const successResult = {
    ok:
      true,
    photoCheck: {
      id:
        checkId,
      vehicleId:
        vehicle,
      result:
        normalizedDecision,
      revision:
        revision + 1,
      reviewedBy:
        actor,
      reviewedAt:
        timestamp,
      nextDueAt:
        normalizedNextDue,
      ...(
        normalizedDecision === "passed"
          ? {
              vehicleRevision:
                vehicleRevision + 1
            }
          : {}
      )
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
            FROM vehicle_photo_checks pc
            WHERE pc.id = ?8
              AND pc.vehicle_id = ?9
              AND pc.revision = ?10
              AND pc.result = ?11
              AND pc.last_review_id = ?12
          )

          AND (
            ?11 != 'passed'
            OR EXISTS (
              SELECT 1
              FROM vehicles v
              WHERE v.id = ?9
                AND v.revision = ?13
                AND v.last_photo_check_passed_at = ?7
                AND v.next_photo_check_due_at = ?14
            )
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
        checkId,
        vehicle,
        revision + 1,
        normalizedDecision,
        review,
        vehicleRevision + 1,
        normalizedNextDue
      );


  const statements = [
    claim,
    checkUpdate,
    reviewInsert,
    audit,
    ...(
      vehicleUpdate
        ? [
            vehicleUpdate
          ]
        : []
    ),
    complete
  ];


  const results =
    await db.batch(
      statements
    );


  if (
    !Array.isArray(results) ||
    results.length !==
      statements.length
  ) {
    throw new Error(
      "photo control review transaction failed"
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
        "photo control review idempotency invariant failed"
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
        "photo control review conflict invariant failed"
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
        "photo_check_review_preconditions_failed"
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
      "incomplete photo control review transaction"
    );
  }


  return {
    kind:
      "success",
    result:
      successResult
  };
}


// =========================================
// MONTHLY DUE GENERATION
// =========================================

export async function generateDueMonthlyPhotoChecks(
  env,
  {
    nowMs,
    graceMs,
    limit = 100
  }
) {
  const db =
    requireDatabase(env);

  const now =
    requirePositiveInteger(
      nowMs,
      "nowMs"
    );

  const grace =
    requirePositiveInteger(
      graceMs,
      "graceMs"
    );

  const safeLimit =
    Math.max(
      1,
      Math.min(
        Number.isSafeInteger(
          Number(limit)
        )
          ? Number(limit)
          : 100,
        500
      )
    );


  const due =
    await db
      .prepare(`
        SELECT
          id,
          next_photo_check_due_at

        FROM vehicles

        WHERE status = 'approved'
          AND next_photo_check_due_at IS NOT NULL
          AND next_photo_check_due_at <= ?1

        ORDER BY
          next_photo_check_due_at ASC,
          id ASC

        LIMIT ?2
      `)
      .bind(
        now,
        safeLimit
      )
      .all();


  if (
    due?.success !== true ||
    !Array.isArray(
      due?.results
    )
  ) {
    throw new Error(
      "monthly photo control due query failed"
    );
  }


  let generated =
    0;


  for (
    const row of
      due.results
  ) {
    const vehicleId =
      requireText(
        row.id,
        "vehicleId"
      );

    const dueAt =
      requirePositiveInteger(
        row.next_photo_check_due_at,
        "dueAt"
      );

    const graceUntil =
      dueAt + grace;


    if (
      !Number.isSafeInteger(
        graceUntil
      )
    ) {
      throw new Error(
        "invalid photo control grace"
      );
    }


    const checkId =
      "photo-check_" +
      crypto.randomUUID();

    const auditId =
      "audit_" +
      crypto.randomUUID();


    const insert =
      db
        .prepare(`
          INSERT OR IGNORE INTO vehicle_photo_checks (
            id,
            vehicle_id,
            kind,
            reason,
            due_at,
            grace_until,
            result,
            reviewed_by,
            reviewed_at,
            created_at,
            updated_at,
            revision,
            restriction_mode,
            created_by,
            next_due_at,
            last_review_id
          )
          VALUES (
            ?1,
            ?2,
            'monthly',
            'Плановый ежемесячный фотоконтроль',
            ?3,
            ?4,
            'pending',
            NULL,
            NULL,
            ?5,
            ?5,
            1,
            'grace_period',
            NULL,
            NULL,
            NULL
          )
        `)
        .bind(
          checkId,
          vehicleId,
          dueAt,
          graceUntil,
          now
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
            NULL,
            'system.vehicle_photo_check_due',
            'vehicle_photo_check',
            ?2,
            'success',
            NULL,
            ?3

          WHERE changes() = 1

            AND EXISTS (
              SELECT 1
              FROM vehicle_photo_checks
              WHERE id = ?2
                AND vehicle_id = ?4
                AND kind = 'monthly'
                AND due_at = ?5
            )
        `)
        .bind(
          auditId,
          checkId,
          now,
          vehicleId,
          dueAt
        );


    const results =
      await db.batch([
        insert,
        audit
      ]);


    if (
      !Array.isArray(results) ||
      results.length !== 2
    ) {
      throw new Error(
        "monthly photo control generation failed"
      );
    }


    const inserted =
      resultChanges(
        results[0]
      );

    const audited =
      resultChanges(
        results[1]
      );


    if (
      inserted === 1 &&
      audited === 1
    ) {
      generated += 1;
      continue;
    }


    if (
      inserted === 0 &&
      audited === 0
    ) {
      continue;
    }


    throw new Error(
      "monthly photo control generation invariant failed"
    );
  }


  return {
    scanned:
      due.results.length,
    generated
  };
}

