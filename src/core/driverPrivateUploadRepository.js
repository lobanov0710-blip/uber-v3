// =========================================
// DRIVER PRIVATE UPLOAD REPOSITORY
// =========================================

function requireDatabase(env) {
  if (!env?.DB) {
    throw new Error("D1 DB binding is not configured");
  }
  return env.DB;
}

function clean(value) {
  return String(value ?? "").trim();
}

function requireText(value, field) {
  const text = clean(value);

  if (!text) {
    throw new Error(`invalid upload ${field}`);
  }

  return text;
}

function requireTimestamp(value, field) {
  const number = Number(value);

  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new Error(`invalid upload ${field}`);
  }

  return number;
}

function requirePositiveInteger(value, field) {
  return requireTimestamp(value, field);
}

function requireRun(result, expectedChanges = 1) {
  if (result?.success !== true) {
    throw new Error("private upload D1 operation failed");
  }

  const count = Number(result?.meta?.changes ?? 0);

  if (
    !Number.isSafeInteger(count) ||
    count !== expectedChanges
  ) {
    throw new Error("private upload D1 change count mismatch");
  }
}

function mapUpload(row) {
  if (!row) {
    return null;
  }

  return {
    id: clean(row.id),
    driverId: clean(row.driver_id),
    vehicleId:
      row.vehicle_id == null
        ? null
        : clean(row.vehicle_id),
    resourceType: clean(row.resource_type),
    kind: clean(row.kind),
    privateObjectKey: clean(row.private_object_key),
    contentType: clean(row.content_type).toLowerCase(),
    expectedBytes: Number(row.expected_bytes),
    createdAt: Number(row.created_at),
    expiresAt: Number(row.expires_at),
    consumedAt:
      row.consumed_at == null
        ? null
        : Number(row.consumed_at)
  };
}

export async function getDriverUploadSession(
  env,
  driverId,
  uploadId
) {
  const driver = requireText(driverId, "driverId");
  const id = requireText(uploadId, "uploadId");
  const db = requireDatabase(env);

  const row =
    await db
      .prepare(`
        SELECT
          id,
          driver_id,
          vehicle_id,
          resource_type,
          kind,
          private_object_key,
          content_type,
          expected_bytes,
          created_at,
          expires_at,
          consumed_at

        FROM driver_upload_sessions

        WHERE id = ?1
          AND driver_id = ?2

        LIMIT 1
      `)
      .bind(
        id,
        driver
      )
      .first();

  return mapUpload(row);
}

export async function insertDriverUploadSession(
  env,
  upload
) {
  const db = requireDatabase(env);

  const result =
    await db
      .prepare(`
        INSERT INTO driver_upload_sessions (
          id,
          driver_id,
          vehicle_id,
          resource_type,
          kind,
          private_object_key,
          content_type,
          expected_bytes,
          created_at,
          expires_at,
          consumed_at
        )
        VALUES (
          ?1,
          ?2,
          ?3,
          ?4,
          ?5,
          ?6,
          ?7,
          ?8,
          ?9,
          ?10,
          NULL
        )
      `)
      .bind(
        requireText(upload.id, "uploadId"),
        requireText(upload.driverId, "driverId"),
        upload.vehicleId == null
          ? null
          : requireText(upload.vehicleId, "vehicleId"),
        requireText(upload.resourceType, "resourceType"),
        requireText(upload.kind, "kind"),
        requireText(upload.privateObjectKey, "privateObjectKey"),
        requireText(upload.contentType, "contentType"),
        requirePositiveInteger(upload.expectedBytes, "expectedBytes"),
        requireTimestamp(upload.createdAt, "createdAt"),
        requireTimestamp(upload.expiresAt, "expiresAt")
      )
      .run();

  requireRun(result);

  const persisted =
    await getDriverUploadSession(
      env,
      upload.driverId,
      upload.id
    );

  if (!persisted) {
    throw new Error("private upload readback failed");
  }

  return persisted;
}

export async function commitDriverUploadResource(
  env,
  upload,
  {
    resourceId,
    consumedAt
  }
) {
  const db = requireDatabase(env);

  const timestamp =
    requireTimestamp(
      consumedAt,
      "consumedAt"
    );

  const statements = [];

  if (upload.resourceType === "document") {

    statements.push(
      db
        .prepare(`
          INSERT INTO document_resources (
            id,
            owner_driver_id,
            vehicle_id,
            kind,
            private_object_key,
            status,
            expires_at,
            retention_until,
            created_at,
            updated_at
          )
          VALUES (
            ?1,
            ?2,
            ?3,
            ?4,
            ?5,
            'pending',
            NULL,
            NULL,
            ?6,
            ?6
          )
        `)
        .bind(
          requireText(resourceId, "resourceId"),
          requireText(upload.driverId, "driverId"),
          upload.vehicleId,
          requireText(upload.kind, "kind"),
          requireText(upload.privateObjectKey, "privateObjectKey"),
          timestamp
        )
    );

  } else if (
    upload.resourceType ===
      "vehicle_photo"
  ) {

    statements.push(
      db
        .prepare(`
          INSERT INTO vehicle_photos (
            id,
            vehicle_id,
            kind,
            private_object_key,
            status,
            created_at,
            updated_at
          )
          VALUES (
            ?1,
            ?2,
            ?3,
            ?4,
            'pending',
            ?5,
            ?5
          )
        `)
        .bind(
          requireText(resourceId, "resourceId"),
          requireText(upload.vehicleId, "vehicleId"),
          requireText(upload.kind, "kind"),
          requireText(upload.privateObjectKey, "privateObjectKey"),
          timestamp
        )
    );

  } else {

    throw new Error(
      "invalid private upload resource type"
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
        VALUES (
          ?1,
          ?2,
          'driver.private_resource_uploaded',
          ?3,
          ?4,
          'success',
          ?5,
          ?6
        )
      `)
      .bind(
        "audit_" + crypto.randomUUID(),
        requireText(upload.driverId, "driverId"),
        upload.resourceType,
        requireText(resourceId, "resourceId"),
        clean(arguments[2]?.requestId) || null,
        timestamp
      )
  );


  statements.push(
    db
      .prepare(`
        UPDATE driver_upload_sessions

        SET consumed_at = ?3

        WHERE id = ?1
          AND driver_id = ?2
          AND consumed_at IS NULL
          AND expires_at >= ?3
      `)
      .bind(
        requireText(upload.id, "uploadId"),
        requireText(upload.driverId, "driverId"),
        timestamp
      )
  );


  const results =
    await db.batch(
      statements
    );


  if (
    !Array.isArray(results) ||
    results.length !== statements.length
  ) {
    throw new Error(
      "private upload transaction failed"
    );
  }


  for (const result of results) {
    requireRun(result);
  }


  return {
    ok: true
  };
}


export async function getDriverRegistrationMaterials(
  env,
  driverId
) {
  const driver = requireText(driverId, "driverId");
  const db = requireDatabase(env);

  const documents =
    await db
      .prepare(`
        SELECT
          id,
          vehicle_id,
          kind,
          status

        FROM document_resources

        WHERE owner_driver_id = ?1

        ORDER BY created_at DESC
      `)
      .bind(driver)
      .all();

  const photos =
    await db
      .prepare(`
        SELECT
          vp.id,
          vp.vehicle_id,
          vp.kind,
          vp.status

        FROM vehicle_photos vp

        INNER JOIN vehicles v
          ON v.id = vp.vehicle_id

        WHERE v.driver_id = ?1

        ORDER BY vp.created_at DESC
      `)
      .bind(driver)
      .all();

  if (
    documents?.success !== true ||
    photos?.success !== true ||
    !Array.isArray(documents?.results) ||
    !Array.isArray(photos?.results)
  ) {
    throw new Error(
      "registration materials query failed"
    );
  }

  return {
    documents:
      documents.results.map(
        row => ({
          id: clean(row.id),
          vehicleId:
            row.vehicle_id == null
              ? null
              : clean(row.vehicle_id),
          kind: clean(row.kind),
          status: clean(row.status)
        })
      ),

    photos:
      photos.results.map(
        row => ({
          id: clean(row.id),
          vehicleId: clean(row.vehicle_id),
          kind: clean(row.kind),
          status: clean(row.status)
        })
      )
  };
}


export async function submitDriverRegistration(
  env,
  driverId,
  {
    expectedRevision,
    submittedAt,
    vehicleIds,
    requestId
  }
) {
  const driver = requireText(driverId, "driverId");
  const revision =
    requirePositiveInteger(
      expectedRevision,
      "expectedRevision"
    );
  const timestamp =
    requireTimestamp(
      submittedAt,
      "submittedAt"
    );

  if (
    !Array.isArray(vehicleIds) ||
    vehicleIds.length === 0
  ) {
    throw new Error(
      "invalid registration vehicleIds"
    );
  }

  const uniqueVehicleIds =
    [
      ...new Set(
        vehicleIds.map(
          value =>
            requireText(
              value,
              "vehicleId"
            )
        )
      )
    ];

  const db =
    requireDatabase(env);

  const statements = [
    db
      .prepare(`
        UPDATE driver_profiles

        SET
          registration_status = 'submitted',
          submitted_at = ?3,
          revision = revision + 1,
          updated_at = ?3

        WHERE staff_account_id = ?1
          AND revision = ?2
          AND registration_status IN (
            'draft',
            'changes_required'
          )
      `)
      .bind(
        driver,
        revision,
        timestamp
      )
  ];

  for (const vehicleId of uniqueVehicleIds) {
    statements.push(
      db
        .prepare(`
          UPDATE vehicles

          SET
            status = 'pending_review',
            revision = revision + 1,
            updated_at = ?3

          WHERE id = ?1
            AND driver_id = ?2
            AND status IN (
              'draft',
              'pending_review'
            )
        `)
        .bind(
          vehicleId,
          driver,
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
        VALUES (
          ?1,
          ?2,
          'driver.registration_submitted',
          'driver_profile',
          ?2,
          'success',
          ?3,
          ?4
        )
      `)
      .bind(
        "audit_" + crypto.randomUUID(),
        driver,
        clean(requestId) || null,
        timestamp
      )
  );

  const results =
    await db.batch(
      statements
    );

  if (
    !Array.isArray(results) ||
    results.length !== statements.length
  ) {
    throw new Error(
      "registration submit transaction failed"
    );
  }

  const profileChanges =
    Number(
      results[0]?.meta?.changes ??
      0
    );

  if (
    results[0]?.success !== true ||
    !Number.isSafeInteger(
      profileChanges
    ) ||
    profileChanges < 0 ||
    profileChanges > 1
  ) {
    throw new Error(
      "registration submit failed"
    );
  }

  if (profileChanges !== 1) {
    return {
      submitted:
        false
    };
  }

  for (
    let index = 1;
    index <= uniqueVehicleIds.length;
    index++
  ) {
    requireRun(
      results[index]
    );
  }

  requireRun(
    results[
      results.length - 1
    ]
  );

  return {
    submitted:
      true
  };
}

