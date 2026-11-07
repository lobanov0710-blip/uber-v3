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
