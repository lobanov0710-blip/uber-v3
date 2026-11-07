// =========================================
// ADMIN REGISTRATION MODERATION REPOSITORY
// =========================================

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

function mapRegistration(row) {
  if (!row) {
    return null;
  }

  return {
    driverId:
      clean(
        row.staff_account_id
      ),

    fullName:
      row.full_name == null
        ? null
        : clean(
            row.full_name
          ),

    region:
      row.region == null
        ? null
        : clean(
            row.region
          ),

    registrationStatus:
      clean(
        row.registration_status
      )
        .toLowerCase(),

    identityStatus:
      clean(
        row.identity_status
      )
        .toLowerCase(),

    revision:
      Number(
        row.revision
      ),

    submittedAt:
      row.submitted_at == null
        ? null
        : Number(
            row.submitted_at
          ),

    updatedAt:
      Number(
        row.updated_at
      )
  };
}


export async function listRegistrationQueue(
  env,
  {
    status,
    limit
  }
) {
  const db =
    requireDatabase(env);

  const normalizedStatus =
    clean(status)
      .toLowerCase();

  const safeLimit =
    Math.min(
      requirePositiveInteger(
        limit,
        "limit"
      ),
      200
    );

  const result =
    normalizedStatus
      ? await db
          .prepare(`
            SELECT
              staff_account_id,
              full_name,
              region,
              registration_status,
              identity_status,
              revision,
              submitted_at,
              updated_at

            FROM driver_profiles

            WHERE registration_status = ?1

            ORDER BY
              submitted_at ASC,
              updated_at ASC

            LIMIT ?2
          `)
          .bind(
            normalizedStatus,
            safeLimit
          )
          .all()
      : await db
          .prepare(`
            SELECT
              staff_account_id,
              full_name,
              region,
              registration_status,
              identity_status,
              revision,
              submitted_at,
              updated_at

            FROM driver_profiles

            WHERE registration_status IN (
              'submitted',
              'under_review',
              'changes_required'
            )

            ORDER BY
              CASE registration_status
                WHEN 'submitted'
                THEN 0
                WHEN 'under_review'
                THEN 1
                ELSE 2
              END,
              submitted_at ASC,
              updated_at ASC

            LIMIT ?1
          `)
          .bind(
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
      "registration queue read failed"
    );
  }

  return result.results
    .map(
      mapRegistration
    )
    .filter(Boolean);
}


export async function startRegistrationReview(
  env,
  {
    driverId,
    expectedRevision,
    actorAccountId,
    reviewId,
    auditId,
    requestId,
    reviewedAt
  }
) {
  const driver =
    requireText(
      driverId,
      "driverId"
    );

  const revision =
    requirePositiveInteger(
      expectedRevision,
      "expectedRevision"
    );

  const actor =
    requireText(
      actorAccountId,
      "actorAccountId"
    );

  const timestamp =
    requirePositiveInteger(
      reviewedAt,
      "reviewedAt"
    );

  const db =
    requireDatabase(env);

  const update =
    db
      .prepare(`
        UPDATE driver_profiles

        SET
          registration_status =
            'under_review',
          revision =
            revision + 1,
          updated_at =
            ?3

        WHERE staff_account_id = ?1
          AND revision = ?2
          AND registration_status =
            'submitted'
      `)
      .bind(
        driver,
        revision,
        timestamp
      );

  const review =
    db
      .prepare(`
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
          'driver_registration',
          ?3,
          'under_review',
          NULL,
          ?4

        WHERE EXISTS (
          SELECT 1
          FROM driver_profiles
          WHERE staff_account_id = ?3
            AND registration_status =
              'under_review'
            AND revision = ?5
            AND updated_at = ?4
        )
      `)
      .bind(
        requireText(
          reviewId,
          "reviewId"
        ),
        actor,
        driver,
        timestamp,
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
          'admin.registration_review_started',
          'driver_profile',
          ?3,
          'success',
          ?4,
          ?5

        WHERE EXISTS (
          SELECT 1
          FROM moderation_reviews
          WHERE id = ?6
            AND actor_account_id = ?2
            AND target_id = ?3
            AND decision =
              'under_review'
        )
      `)
      .bind(
        requireText(
          auditId,
          "auditId"
        ),
        actor,
        driver,
        clean(
          requestId
        ) || null,
        timestamp,
        requireText(
          reviewId,
          "reviewId"
        )
      );

  const results =
    await db.batch([
      update,
      review,
      audit
    ]);

  if (
    !Array.isArray(results) ||
    results.length !== 3
  ) {
    throw new Error(
      "registration review transaction failed"
    );
  }

  const updateChanges =
    resultChanges(
      results[0]
    );

  const reviewChanges =
    resultChanges(
      results[1]
    );

  const auditChanges =
    resultChanges(
      results[2]
    );

  if (
    updateChanges === 0
  ) {
    if (
      reviewChanges !== 0 ||
      auditChanges !== 0
    ) {
      throw new Error(
        "inconsistent registration review"
      );
    }

    return {
      changed:
        false
    };
  }

  if (
    reviewChanges !== 1 ||
    auditChanges !== 1
  ) {
    throw new Error(
      "incomplete registration review"
    );
  }

  return {
    changed:
      true
  };
}
