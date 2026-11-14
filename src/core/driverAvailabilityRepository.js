// =========================================
// DRIVER AVAILABILITY REPOSITORY
// =========================================

import {
  prepareMutationIdempotencyClaim,
  prepareMutationIdempotencyComplete
} from "./mutationIdempotencyRepository.js";

import {
  PHOTO_CONTROL_GRACE_MS
} from "./photoControlSchedule.js";


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
      `invalid availability ${field}`
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
      `invalid availability ${field}`
    );
  }

  return number;
}


function resultChanges(result) {
  if (
    result?.success !== true
  ) {
    throw new Error(
      "availability D1 operation failed"
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
      "invalid availability D1 change count"
    );
  }

  return count;
}


export async function getDriverAvailabilityState(
  env,
  driverId
) {
  const db =
    requireDatabase(env);

  const row =
    await db
      .prepare(`
        SELECT
          p.staff_account_id,
          p.registration_status,
          p.identity_status,

          a.active_vehicle_id,
          a.state,
          a.revision,
          a.updated_at

        FROM driver_profiles p

        LEFT JOIN driver_availability a
          ON a.driver_id = p.staff_account_id

        WHERE p.staff_account_id = ?1

        LIMIT 1
      `)
      .bind(
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
    driverId:
      clean(
        row.staff_account_id
      ),

    registrationStatus:
      clean(
        row.registration_status
      ),

    identityStatus:
      clean(
        row.identity_status
      ),

    activeVehicleId:
      row.active_vehicle_id == null
        ? null
        : clean(
            row.active_vehicle_id
          ),

    state:
      row.state == null
        ? "off_line"
        : clean(
            row.state
          ),

    revision:
      row.revision == null
        ? null
        : Number(
            row.revision
          ),

    updatedAt:
      row.updated_at == null
        ? null
        : Number(
            row.updated_at
          )
  };
}


export async function getOwnedVehicleEligibility(
  env,
  driverId,
  vehicleId,
  nowMs
) {
  const db =
    requireDatabase(env);

  const timestamp =
    requirePositiveInteger(
      nowMs,
      "nowMs"
    );

  const row =
    await db
      .prepare(`
        SELECT
          v.id,
          v.driver_id,
          v.status,
          v.next_photo_check_due_at,

          (
            (
              v.next_photo_check_due_at IS NOT NULL
              AND v.next_photo_check_due_at + ?4 < ?3
            )
            OR EXISTS (
            SELECT 1
            FROM vehicle_photo_checks pc
            WHERE pc.vehicle_id = v.id
              AND (
                pc.result IN (
                  'failed',
                  'manual_review'
                )
                OR (
                  pc.result = 'pending'
                  AND (
                    pc.restriction_mode IN (
                      'after_current_trip',
                      'immediate'
                    )
                    OR (
                      pc.restriction_mode =
                        'grace_period'
                      AND pc.grace_until < ?3
                    )
                  )
                )
              )
          )
          ) AS photo_control_blocked,

          EXISTS (
            SELECT 1
            FROM vehicle_photo_checks pc
            WHERE pc.vehicle_id = v.id
              AND pc.result = 'pending'
              AND pc.restriction_mode =
                'grace_period'
              AND pc.due_at <= ?3
              AND pc.grace_until >= ?3
          ) AS photo_control_grace

        FROM vehicles v

        WHERE v.id = ?1
          AND v.driver_id = ?2

        LIMIT 1
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
        timestamp,
        PHOTO_CONTROL_GRACE_MS
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

    driverId:
      clean(
        row.driver_id
      ),

    status:
      clean(
        row.status
      ),

    photoControlBlocked:
      Number(
        row.photo_control_blocked
      ) === 1,

    photoControlGrace:
      Number(
        row.photo_control_grace
      ) === 1
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
      "availability conflict idempotency completion failed"
    );
  }
}


export async function updateDriverAvailability(
  env,
  {
    driverId,
    requestedState,
    activeVehicleId,
    expectedRevision,
    updatedAt,
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

  const state =
    requireText(
      requestedState,
      "requestedState"
    );

  const revision =
    requirePositiveInteger(
      expectedRevision,
      "expectedRevision"
    );

  const timestamp =
    requirePositiveInteger(
      updatedAt,
      "updatedAt"
    );

  const vehicle =
    activeVehicleId == null
      ? null
      : requireText(
          activeVehicleId,
          "activeVehicleId"
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


  const update =
    db
      .prepare(`
        UPDATE driver_availability

        SET
          active_vehicle_id = ?3,
          state = ?4,
          revision = revision + 1,
          updated_at = ?5

        WHERE driver_id = ?1
          AND revision = ?2

          AND (?4 = 'off_line' OR EXISTS (
            SELECT 1
            FROM driver_profiles p
            WHERE p.staff_account_id = ?1
              AND p.registration_status =
                'approved'
              AND p.identity_status =
                'verified'
          ))

          AND (
            ?3 IS NULL
            OR EXISTS (
              SELECT 1
              FROM vehicles v
              WHERE v.id = ?3
                AND v.driver_id = ?1
                AND (?4 = 'off_line' OR v.status = 'approved')
            )
          )

          AND (
            ?4 = 'off_line'
            OR (
              ?4 = 'on_line'
              AND ?3 IS NOT NULL
            )
          )

          AND (
            ?4 = 'off_line'
            OR (
              NOT EXISTS (
                SELECT 1
                FROM vehicle_photo_checks pc
                WHERE pc.vehicle_id = ?3
                  AND (
                    pc.result IN (
                      'failed',
                      'manual_review'
                    )
                    OR (
                      pc.result = 'pending'
                      AND (
                        pc.restriction_mode IN (
                          'after_current_trip',
                          'immediate'
                        )
                        OR (
                          pc.restriction_mode =
                            'grace_period'
                          AND pc.grace_until < ?5
                        )
                      )
                    )
                  )
              )

              AND NOT EXISTS (
                SELECT 1
                FROM vehicles v
                WHERE v.id = ?3
                  AND v.next_photo_check_due_at IS NOT NULL
                  AND v.next_photo_check_due_at + ?10 < ?5
              )
            )
          )

          AND (
            state = 'off_line'
            OR active_vehicle_id = ?3
            OR (
              ?4 = 'off_line'
              AND ?3 IS NULL
            )
          )

          AND NOT EXISTS (
            SELECT 1
            FROM order_assignments a
            WHERE a.driver_id = ?1
              AND a.state = 'active'
              AND a.revoked_at IS NULL
              AND (?3 IS NULL OR a.vehicle_id <> ?3)
          )

          AND EXISTS (
            SELECT 1
            FROM mutation_idempotency mi
            WHERE mi.actor_account_id = ?1
              AND mi.operation = ?6
              AND mi.key_digest = ?7
              AND mi.request_digest = ?8
              AND mi.claim_id = ?9
              AND mi.state = 'in_progress'
          )
      `)
      .bind(
        driver,
        revision,
        vehicle,
        state,
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
        PHOTO_CONTROL_GRACE_MS
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
          'driver.availability_changed',
          'driver_availability',
          ?2,
          'success',
          ?3,
          ?4

        -- This statement immediately follows the availability UPDATE in the batch.
        -- Matching state alone cannot prove that THIS request changed the row.
        WHERE changes() = 1 AND EXISTS (
          SELECT 1
          FROM driver_availability
          WHERE driver_id = ?2
            AND revision = ?5
            AND state = ?6
            AND (
              active_vehicle_id = ?7
              OR (
                active_vehicle_id IS NULL
                AND ?7 IS NULL
              )
            )
        )
      `)
      .bind(
        requireText(
          auditId,
          "auditId"
        ),
        driver,
        clean(
          requestId
        ) || null,
        timestamp,
        revision + 1,
        state,
        vehicle
      );


  const successResult = {
    ok:
      true,

    availability: {
      state,
      activeVehicleId:
        vehicle,
      revision:
        revision + 1,
      updatedAt:
        timestamp
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

          -- The preceding audit INSERT must belong to a successful mutation.
          AND changes() = 1

          AND EXISTS (
            SELECT 1
            FROM driver_availability
            WHERE driver_id = ?1
              AND revision = ?8
              AND state = ?9
              AND (
                active_vehicle_id = ?10
                OR (
                  active_vehicle_id IS NULL
                  AND ?10 IS NULL
                )
              )
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
        revision + 1,
        state,
        vehicle
      );


  const results =
    await db.batch([
      claim,
      update,
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
      "availability transaction failed"
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
        "availability idempotency invariant failed"
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
        "availability conflict invariant failed"
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
        "availability_preconditions_failed"
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
    counts[1] !== 1
    ||
    counts[2] !== 1
    ||
    counts[3] !== 1
  ) {
    throw new Error(
      "incomplete availability transaction"
    );
  }


  return {
    kind:
      "success",

    result:
      successResult
  };
}
