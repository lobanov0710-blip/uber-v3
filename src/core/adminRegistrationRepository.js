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
