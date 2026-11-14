// =========================================
// ADMIN PRIVATE RESOURCE REPOSITORY
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
  const text =
    clean(value);

  if (!text) {
    throw new Error(
      `invalid private resource ${field}`
    );
  }

  return text;
}


function requireTimestamp(value) {
  const number =
    Number(value);

  if (
    !Number.isSafeInteger(number) ||
    number <= 0
  ) {
    throw new Error(
      "invalid private resource timestamp"
    );
  }

  return number;
}


export async function getAdminPrivateResourceMetadata(
  env,
  {
    driverId,
    resourceType,
    resourceId
  }
) {
  const db =
    requireDatabase(env);

  const driver =
    requireText(
      driverId,
      "driverId"
    );

  const type =
    requireText(
      resourceType,
      "resourceType"
    );

  const id =
    requireText(
      resourceId,
      "resourceId"
    );

  let row;


  if (
    type === "document"
  ) {

    row =
      await db
        .prepare(`
          SELECT
            id,
            owner_driver_id,
            vehicle_id,
            kind,
            status,
            private_object_key

          FROM document_resources

          WHERE id = ?1
            AND owner_driver_id = ?2

          LIMIT 1
        `)
        .bind(
          id,
          driver
        )
        .first();

  } else if (
    type === "vehicle_photo"
  ) {

    row =
      await db
        .prepare(`
          SELECT
            vp.id,
            v.driver_id AS owner_driver_id,
            vp.vehicle_id,
            vp.kind,
            vp.status,
            vp.private_object_key

          FROM vehicle_photos vp

          INNER JOIN vehicles v
            ON v.id = vp.vehicle_id

          WHERE vp.id = ?1
            AND v.driver_id = ?2

          LIMIT 1
        `)
        .bind(
          id,
          driver
        )
        .first();

  } else {

    throw new Error(
      "invalid private resource type"
    );
  }


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
        row.owner_driver_id
      ),

    vehicleId:
      row.vehicle_id == null
        ? null
        : clean(
            row.vehicle_id
          ),

    type,

    kind:
      clean(
        row.kind
      ),

    status:
      clean(
        row.status
      ),

    privateObjectKey:
      requireText(
        row.private_object_key,
        "privateObjectKey"
      )
  };
}


export async function auditAdminPrivateResourceRead(
  env,
  {
    actorAccountId,
    resourceType,
    resourceId,
    requestId,
    readAt
  }
) {
  const db =
    requireDatabase(env);

  const result =
    await db
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
        VALUES (
          ?1,
          ?2,
          'admin.private_resource_read',
          ?3,
          ?4,
          'success',
          ?5,
          ?6
        )
      `)
      .bind(
        "audit_" +
          crypto.randomUUID(),
        requireText(
          actorAccountId,
          "actorAccountId"
        ),
        requireText(
          resourceType,
          "resourceType"
        ),
        requireText(
          resourceId,
          "resourceId"
        ),
        clean(
          requestId
        ) || null,
        requireTimestamp(
          readAt
        )
      )
      .run();


  if (
    result?.success !== true ||
    Number(
      result?.meta?.changes ??
      0
    ) !== 1
  ) {
    throw new Error(
      "private resource audit failed"
    );
  }
}
