// =========================================
// ORDER ASSIGNMENT REPOSITORY
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
      `invalid assignment ${field}`
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
      `invalid assignment ${field}`
    );
  }

  return number;
}


function resultChanges(result) {
  if (
    result?.success !== true
  ) {
    throw new Error(
      "assignment D1 operation failed"
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
      "invalid assignment D1 change count"
    );
  }

  return count;
}


function assignmentAuditStatement(
  db,
  {
    auditId,
    actorAccountId,
    action,
    assignmentId,
    requestId,
    createdAt
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
        'order_assignment',
        ?4,
        'success',
        ?5,
        ?6

      WHERE EXISTS (
        SELECT 1
        FROM order_assignments
        WHERE id = ?4
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
        assignmentId,
        "assignmentId"
      ),
      clean(
        requestId
      ) || null,
      requirePositiveInteger(
        createdAt,
        "createdAt"
      )
    );
}


function assignmentIdempotencyCompleteStatement(
  db,
  idempotency,
  {
    actorAccountId,
    assignmentId,
    result,
    completedAt
  }
) {
  return db
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
        AND EXISTS (
          SELECT 1
          FROM order_assignments
          WHERE id = ?8
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
      JSON.stringify(
        result
      ),
      requirePositiveInteger(
        completedAt,
        "completedAt"
      ),
      requireText(
        assignmentId,
        "assignmentId"
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
      "assignment idempotency conflict completion failed"
    );
  }
}


export async function getOrderAssignmentState(
  env,
  orderId
) {
  const db =
    requireDatabase(env);

  const row =
    await db
      .prepare(`
        SELECT
          o.id AS order_id,
          o.status AS order_status,
          o.driver_id AS order_driver_id,
          o.revision AS order_revision,
          o.updated_at AS order_updated_at,

          a.id AS assignment_id,
          a.driver_id AS assignment_driver_id,
          a.vehicle_id AS assignment_vehicle_id,
          a.state AS assignment_state,
          a.revision AS assignment_revision,
          a.created_at AS assignment_created_at

        FROM orders o

        LEFT JOIN order_assignments a
          ON a.order_id = o.id
         AND a.state = 'active'
         AND a.revoked_at IS NULL

        WHERE o.id = ?1

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
    orderId:
      clean(
        row.order_id
      ),

    orderStatus:
      clean(
        row.order_status
      ),

    orderDriverId:
      row.order_driver_id == null
        ? null
        : clean(
            row.order_driver_id
          ),

    orderRevision:
      Number(
        row.order_revision
      ),

    orderUpdatedAt:
      Number(
        row.order_updated_at
      ),

    assignment:
      row.assignment_id == null
        ? null
        : {
            id:
              clean(
                row.assignment_id
              ),

            driverId:
              clean(
                row.assignment_driver_id
              ),

            vehicleId:
              clean(
                row.assignment_vehicle_id
              ),

            state:
              clean(
                row.assignment_state
              ),

            revision:
              Number(
                row.assignment_revision
              ),

            createdAt:
              Number(
                row.assignment_created_at
              )
          }
  };
}


export async function getAssignmentCandidateEligibility(
  env,
  driverId,
  vehicleId
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

          v.id AS vehicle_id,
          v.status AS vehicle_status,

          a.state AS availability_state,
          a.active_vehicle_id

        FROM driver_profiles p

        LEFT JOIN vehicles v
          ON v.driver_id = p.staff_account_id
         AND v.id = ?2

        LEFT JOIN driver_availability a
          ON a.driver_id = p.staff_account_id

        WHERE p.staff_account_id = ?1

        LIMIT 1
      `)
      .bind(
        requireText(
          driverId,
          "driverId"
        ),
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

    vehicleId:
      row.vehicle_id == null
        ? null
        : clean(
            row.vehicle_id
          ),

    vehicleStatus:
      row.vehicle_status == null
        ? null
        : clean(
            row.vehicle_status
          ),

    availabilityState:
      row.availability_state == null
        ? "off_line"
        : clean(
            row.availability_state
          ),

    activeVehicleId:
      row.active_vehicle_id == null
        ? null
        : clean(
            row.active_vehicle_id
          )
  };
}


export async function listActiveAssignmentsForDriver(
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
          Number(
            limit
          )
        )
          ? Number(
              limit
            )
          : 100,
        200
      )
    );

  const result =
    await db
      .prepare(`
        SELECT
          a.id AS assignment_id,
          a.order_id,
          a.vehicle_id,
          a.revision AS assignment_revision,
          a.phase AS assignment_phase,
          a.phase_updated_at,
          a.created_at AS assigned_at,

          o.revision AS order_revision,
          o.status AS order_status,
          o.name,
          o.phone,
          o.route,
          o.from_place,
          o.to_place,
          o.trip_date,
          o.comment,
          o.tariff,
          o.distance_km,
          o.duration_minutes,
          o.price_rub,
          o.updated_at AS order_updated_at

        FROM order_assignments a

        INNER JOIN orders o
          ON o.id = a.order_id

        WHERE a.driver_id = ?1
          AND a.state = 'active'
          AND a.revoked_at IS NULL
          AND o.driver_id = ?1
          AND o.status IN (
            'taken',
            'in_progress'
          )

        ORDER BY a.created_at DESC

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
      "driver assignments query failed"
    );
  }


  return result.results.map(
    row => ({
      assignmentId:
        clean(
          row.assignment_id
        ),

      assignmentRevision:
        Number(
          row.assignment_revision
        ),

      assignedAt:
        Number(
          row.assigned_at
        ),

      phase:
        clean(
          row.assignment_phase ||
          "assigned"
        ),

      phaseUpdatedAt:
        row.phase_updated_at == null
          ? null
          : Number(
              row.phase_updated_at
            ),

      vehicleId:
        clean(
          row.vehicle_id
        ),

      order: {
        id:
          clean(
            row.order_id
          ),

        revision:
          Number(
            row.order_revision
          ),

        status:
          clean(
            row.order_status
          ),

        name:
          clean(
            row.name
          ),

        phone:
          clean(
            row.phone
          ),

        route:
          clean(
            row.route
          ),

        from:
          row.from_place == null
            ? ""
            : clean(
                row.from_place
              ),

        to:
          row.to_place == null
            ? ""
            : clean(
                row.to_place
              ),

        date:
          clean(
            row.trip_date
          ),

        comment:
          clean(
            row.comment
          ),

        tariff:
          row.tariff == null
            ? null
            : clean(
                row.tariff
              ),

        distance:
          row.distance_km == null
            ? null
            : Number(
                row.distance_km
              ),

        duration:
          row.duration_minutes == null
            ? null
            : Number(
                row.duration_minutes
              ),

        price:
          row.price_rub == null
            ? null
            : Number(
                row.price_rub
              ),

        updatedAt:
          Number(
            row.order_updated_at
          )
      }
    })
  );
}


async function executeAssignBatch(
  env,
  {
    actorAccountId,
    assignmentId,
    idempotency,
    statements,
    successResult,
    conflictResult,
    completedAt,
    auditId,
    auditAction,
    requestId
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

  const audit =
    assignmentAuditStatement(
      db,
      {
        auditId,
        actorAccountId,
        action:
          auditAction,
        assignmentId,
        requestId,
        createdAt:
          completedAt
      }
    );

  const complete =
    assignmentIdempotencyCompleteStatement(
      db,
      idempotency,
      {
        actorAccountId,
        assignmentId,
        result:
          successResult,
        completedAt
      }
    );

  const results =
    await db.batch([
      claim,
      ...statements,
      audit,
      complete
    ]);


  const expectedLength =
    statements.length +
    3;


  if (
    !Array.isArray(
      results
    ) ||
    results.length !==
      expectedLength
  ) {
    throw new Error(
      "assignment transaction failed"
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
        "assignment idempotency invariant failed"
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
        "assignment conflict invariant failed"
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
    counts.slice(1)
      .some(
        count =>
          count !== 1
      )
  ) {
    throw new Error(
      "incomplete assignment transaction"
    );
  }


  return {
    kind:
      "success",

    result:
      successResult
  };
}


export async function assignOrderToDriverVehicle(
  env,
  {
    actorAccountId,
    orderId,
    driverId,
    vehicleId,
    reason,
    expectedRevision,
    assignedAt,
    assignmentId,
    auditId,
    requestId,
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
      assignedAt,
      "assignedAt"
    );

  const orderUpdate =
    db
      .prepare(`
        UPDATE orders

        SET
          status = 'taken',
          driver_id = ?2,
          revision = revision + 1,
          last_assignment_id = ?3,
          updated_at = ?4

        WHERE id = ?1
          AND revision = ?5
          AND status = 'new'
          AND driver_id IS NULL

          AND NOT EXISTS (
            SELECT 1
            FROM order_assignments a
            WHERE a.order_id = ?1
              AND a.revoked_at IS NULL
          )

          AND EXISTS (
            SELECT 1
            FROM driver_profiles p
            WHERE p.staff_account_id = ?2
              AND p.registration_status =
                'approved'
              AND p.identity_status =
                'verified'
          )

          AND EXISTS (
            SELECT 1
            FROM vehicles v
            WHERE v.id = ?6
              AND v.driver_id = ?2
              AND v.status = 'approved'
          )

          AND NOT EXISTS (
            SELECT 1
            FROM driver_availability da
            WHERE da.driver_id = ?2
              AND da.state = 'on_line'
              AND da.active_vehicle_id IS NOT NULL
              AND da.active_vehicle_id != ?6
          )

          AND EXISTS (
            SELECT 1
            FROM mutation_idempotency mi
            WHERE mi.actor_account_id = ?7
              AND mi.operation = ?8
              AND mi.key_digest = ?9
              AND mi.request_digest = ?10
              AND mi.claim_id = ?11
              AND mi.state = 'in_progress'
          )
      `)
      .bind(
        requireText(
          orderId,
          "orderId"
        ),
        requireText(
          driverId,
          "driverId"
        ),
        requireText(
          assignmentId,
          "assignmentId"
        ),
        timestamp,
        revision,
        requireText(
          vehicleId,
          "vehicleId"
        ),
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


  const assignmentInsert =
    db
      .prepare(`
        INSERT INTO order_assignments (
          id,
          order_id,
          driver_id,
          vehicle_id,
          state,
          revision,
          assigned_by,
          reason,
          created_at,
          revoked_at
        )

        SELECT
          ?1,
          o.id,
          ?2,
          ?3,
          'active',
          1,
          ?4,
          ?5,
          ?6,
          NULL

        FROM orders o

        WHERE o.id = ?7
          AND o.last_assignment_id = ?1
          AND o.driver_id = ?2
          AND o.status = 'taken'
          AND o.revision = ?8
      `)
      .bind(
        requireText(
          assignmentId,
          "assignmentId"
        ),
        requireText(
          driverId,
          "driverId"
        ),
        requireText(
          vehicleId,
          "vehicleId"
        ),
        requireText(
          actorAccountId,
          "actorAccountId"
        ),
        requireText(
          reason,
          "reason"
        ),
        timestamp,
        requireText(
          orderId,
          "orderId"
        ),
        revision + 1
      );


  const successResult = {
    ok:
      true,

    assignment: {
      id:
        assignmentId,

      orderId,
      driverId,
      vehicleId,

      state:
        "active",

      revision:
        1,

      orderRevision:
        revision + 1,

      assignedAt:
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
      "order_assignment_preconditions_failed"
  };


  return executeAssignBatch(
    env,
    {
      actorAccountId,
      assignmentId,
      idempotency,
      statements: [
        orderUpdate,
        assignmentInsert
      ],
      successResult,
      conflictResult,
      completedAt:
        timestamp,
      auditId,
      auditAction:
        "admin.order_assigned",
      requestId
    }
  );
}


export async function reassignOrderToDriverVehicle(
  env,
  {
    actorAccountId,
    orderId,
    driverId,
    vehicleId,
    reason,
    expectedRevision,
    assignedAt,
    assignmentId,
    auditId,
    requestId,
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
      assignedAt,
      "assignedAt"
    );


  const orderUpdate =
    db
      .prepare(`
        UPDATE orders

        SET
          driver_id = ?2,
          revision = revision + 1,
          last_assignment_id = ?3,
          updated_at = ?4

        WHERE id = ?1
          AND revision = ?5
          AND status = 'taken'

          AND EXISTS (
            SELECT 1
            FROM order_assignments current
            WHERE current.order_id = ?1
              AND current.state = 'active'
              AND current.revoked_at IS NULL
              AND (
                current.driver_id != ?2
                OR current.vehicle_id != ?6
              )
          )

          AND EXISTS (
            SELECT 1
            FROM driver_profiles p
            WHERE p.staff_account_id = ?2
              AND p.registration_status =
                'approved'
              AND p.identity_status =
                'verified'
          )

          AND EXISTS (
            SELECT 1
            FROM vehicles v
            WHERE v.id = ?6
              AND v.driver_id = ?2
              AND v.status = 'approved'
          )

          AND NOT EXISTS (
            SELECT 1
            FROM driver_availability da
            WHERE da.driver_id = ?2
              AND da.state = 'on_line'
              AND da.active_vehicle_id IS NOT NULL
              AND da.active_vehicle_id != ?6
          )

          AND EXISTS (
            SELECT 1
            FROM mutation_idempotency mi
            WHERE mi.actor_account_id = ?7
              AND mi.operation = ?8
              AND mi.key_digest = ?9
              AND mi.request_digest = ?10
              AND mi.claim_id = ?11
              AND mi.state = 'in_progress'
          )
      `)
      .bind(
        requireText(
          orderId,
          "orderId"
        ),
        requireText(
          driverId,
          "driverId"
        ),
        requireText(
          assignmentId,
          "assignmentId"
        ),
        timestamp,
        revision,
        requireText(
          vehicleId,
          "vehicleId"
        ),
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


  const revokeCurrent =
    db
      .prepare(`
        UPDATE order_assignments

        SET
          state = 'revoked',
          revision = revision + 1,
          revoked_at = ?3

        WHERE order_id = ?1
          AND state = 'active'
          AND revoked_at IS NULL

          AND EXISTS (
            SELECT 1
            FROM orders o
            WHERE o.id = ?1
              AND o.last_assignment_id = ?2
              AND o.revision = ?4
          )
      `)
      .bind(
        requireText(
          orderId,
          "orderId"
        ),
        requireText(
          assignmentId,
          "assignmentId"
        ),
        timestamp,
        revision + 1
      );


  const assignmentInsert =
    db
      .prepare(`
        INSERT INTO order_assignments (
          id,
          order_id,
          driver_id,
          vehicle_id,
          state,
          revision,
          assigned_by,
          reason,
          created_at,
          revoked_at
        )

        SELECT
          ?1,
          o.id,
          ?2,
          ?3,
          'active',
          1,
          ?4,
          ?5,
          ?6,
          NULL

        FROM orders o

        WHERE o.id = ?7
          AND o.last_assignment_id = ?1
          AND o.driver_id = ?2
          AND o.status = 'taken'
          AND o.revision = ?8

          AND NOT EXISTS (
            SELECT 1
            FROM order_assignments current
            WHERE current.order_id = o.id
              AND current.state = 'active'
              AND current.revoked_at IS NULL
          )
      `)
      .bind(
        requireText(
          assignmentId,
          "assignmentId"
        ),
        requireText(
          driverId,
          "driverId"
        ),
        requireText(
          vehicleId,
          "vehicleId"
        ),
        requireText(
          actorAccountId,
          "actorAccountId"
        ),
        requireText(
          reason,
          "reason"
        ),
        timestamp,
        requireText(
          orderId,
          "orderId"
        ),
        revision + 1
      );


  const successResult = {
    ok:
      true,

    assignment: {
      id:
        assignmentId,

      orderId,
      driverId,
      vehicleId,

      state:
        "active",

      revision:
        1,

      orderRevision:
        revision + 1,

      assignedAt:
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
      "order_reassignment_preconditions_failed"
  };


  return executeAssignBatch(
    env,
    {
      actorAccountId,
      assignmentId,
      idempotency,
      statements: [
        orderUpdate,
        revokeCurrent,
        assignmentInsert
      ],
      successResult,
      conflictResult,
      completedAt:
        timestamp,
      auditId,
      auditAction:
        "admin.order_reassigned",
      requestId
    }
  );
}
