import assert from "node:assert/strict";

import {
  completeDriverPrivateUpload,
  issueDriverPrivateUpload
} from "../src/core/driverPrivateUploadService.js";


const DRIVER_ID =
  "staff_driver123";

const NOW =
  1800000000000;


function createFakeDb() {

  const state = {
    upload:
      null,

    documents:
      [],

    photos:
      [],

    audits:
      []
  };


  function validClaim(
    uploadId,
    driverId,
    claimId,
    timestamp
  ) {

    const upload =
      state.upload;

    return Boolean(
      upload
      &&
      upload.id === uploadId
      &&
      upload.driver_id === driverId
      &&
      upload.claim_id === claimId
      &&
      upload.consumed_at === null
      &&
      upload.expires_at >= timestamp
    );
  }


  return {
    state,

    prepare(
      sql
    ) {

      return {
        sql,
        args:
          [],

        bind(
          ...args
        ) {

          this.args =
            args;

          return this;
        },

        async first() {

          if (
            /FROM\s+driver_upload_sessions/i.test(
              this.sql
            )
          ) {

            const [
              uploadId,
              driverId
            ] =
              this.args;


            if (
              state.upload
              &&
              state.upload.id ===
                uploadId
              &&
              state.upload.driver_id ===
                driverId
            ) {

              return {
                ...state.upload
              };
            }


            return null;
          }


          throw new Error(
            "unexpected fake D1 first"
          );
        },

        async run() {

          if (
            /INSERT\s+INTO\s+driver_upload_sessions/i.test(
              this.sql
            )
          ) {

            const [
              id,
              driverId,
              vehicleId,
              photoCheckId,
              resourceType,
              kind,
              objectKey,
              contentType,
              expectedBytes,
              createdAt,
              expiresAt
            ] =
              this.args;


            state.upload = {
              id,
              driver_id:
                driverId,
              vehicle_id:
                vehicleId,
              photo_check_id:
                photoCheckId,
              resource_type:
                resourceType,
              kind,
              private_object_key:
                objectKey,
              content_type:
                contentType,
              expected_bytes:
                expectedBytes,
              created_at:
                createdAt,
              expires_at:
                expiresAt,
              claim_id:
                null,
              claimed_at:
                null,
              consumed_at:
                null
            };


            return {
              success:
                true,

              meta: {
                changes:
                  1
              }
            };
          }


          if (
            /SET\s+claim_id\s*=\s*\?3/i.test(
              this.sql
            )
          ) {

            const [
              uploadId,
              driverId,
              claimId,
              claimedAt
            ] =
              this.args;


            if (
              state.upload
              &&
              state.upload.id ===
                uploadId
              &&
              state.upload.driver_id ===
                driverId
              &&
              state.upload.claim_id ===
                null
              &&
              state.upload.claimed_at ===
                null
              &&
              state.upload.consumed_at ===
                null
              &&
              state.upload.expires_at >=
                claimedAt
            ) {

              state.upload.claim_id =
                claimId;

              state.upload.claimed_at =
                claimedAt;


              return {
                success:
                  true,

                meta: {
                  changes:
                    1
                }
              };
            }


            return {
              success:
                true,

              meta: {
                changes:
                  0
              }
            };
          }


          if (
            /SET\s+claim_id\s*=\s*NULL/i.test(
              this.sql
            )
          ) {

            const [
              uploadId,
              driverId,
              claimId
            ] =
              this.args;


            if (
              state.upload
              &&
              state.upload.id ===
                uploadId
              &&
              state.upload.driver_id ===
                driverId
              &&
              state.upload.claim_id ===
                claimId
              &&
              state.upload.consumed_at ===
                null
            ) {

              state.upload.claim_id =
                null;

              state.upload.claimed_at =
                null;


              return {
                success:
                  true,

                meta: {
                  changes:
                    1
                }
              };
            }


            return {
              success:
                true,

              meta: {
                changes:
                  0
              }
            };
          }


          throw new Error(
            "unexpected fake D1 run"
          );
        }
      };
    },

    async batch(
      statements
    ) {

      return statements.map(
        statement => {

          if (
            /INSERT\s+INTO\s+document_resources/i.test(
              statement.sql
            )
          ) {

            const [
              resourceId,
              uploadId,
              driverId,
              claimId,
              timestamp
            ] =
              statement.args;


            if (
              !validClaim(
                uploadId,
                driverId,
                claimId,
                timestamp
              )
            ) {
              return {
                success:
                  true,

                meta: {
                  changes:
                    0
                }
              };
            }


            state.documents.push({
              id:
                resourceId,

              owner_driver_id:
                driverId,

              vehicle_id:
                state.upload
                  .vehicle_id,

              kind:
                state.upload
                  .kind,

              private_object_key:
                state.upload
                  .private_object_key,

              status:
                "pending"
            });


            return {
              success:
                true,

              meta: {
                changes:
                  1
              }
            };
          }


          if (
            /INSERT\s+INTO\s+audit_events/i.test(
              statement.sql
            )
          ) {

            const [
              auditId,
              resourceId,
              uploadId,
              driverId,
              timestamp,
              requestId,
              claimId
            ] =
              statement.args;


            if (
              !validClaim(
                uploadId,
                driverId,
                claimId,
                timestamp
              )
            ) {
              return {
                success:
                  true,

                meta: {
                  changes:
                    0
                }
              };
            }


            state.audits.push({
              id:
                auditId,

              resourceId,

              requestId
            });


            return {
              success:
                true,

              meta: {
                changes:
                  1
              }
            };
          }


          if (
            /SET\s+consumed_at\s*=\s*\?4/i.test(
              statement.sql
            )
          ) {

            const [
              uploadId,
              driverId,
              claimId,
              timestamp
            ] =
              statement.args;


            if (
              !validClaim(
                uploadId,
                driverId,
                claimId,
                timestamp
              )
            ) {
              return {
                success:
                  true,

                meta: {
                  changes:
                    0
                }
              };
            }


            state.upload.consumed_at =
              timestamp;


            return {
              success:
                true,

              meta: {
                changes:
                  1
              }
            };
          }


          throw new Error(
            "unexpected fake D1 batch statement"
          );
        }
      );
    }
  };
}


function createFakeBucket() {

  const objects =
    new Map();


  return {
    objects,

    async put(
      key,
      body,
      options
    ) {

      objects.set(
        key,
        {
          bytes:
            new Uint8Array(
              body
            ),

          options
        }
      );


      return {
        key
      };
    },

    async delete(
      key
    ) {

      objects.delete(
        key
      );
    }
  };
}


const DB =
  createFakeDb();

const DRIVER_PRIVATE_FILES =
  createFakeBucket();

const env = {
  DB,
  DRIVER_PRIVATE_FILES,
  DRIVER_UPLOAD_MAX_BYTES:
    "1048576"
};

const user = {
  id:
    DRIVER_ID,

  role:
    "driver"
};


const issued =
  await issueDriverPrivateUpload(
    env,
    user,
    {
      resourceType:
        "document",

      kind:
        "passport_main",

      contentType:
        "image/jpeg",

      contentLength:
        4
    },
    {
      nowMs:
        NOW
    }
  );


assert.equal(
  issued.ok,
  true
);

assert.equal(
  issued.upload.method,
  "PUT"
);

assert.match(
  issued.upload.path,
  /^\/v1\/driver\/uploads\/upload_/
);

assert.equal(
  Object.hasOwn(
    issued.upload,
    "url"
  ),
  false,
  "private upload issuance must not return a public URL"
);


const body =
  new Uint8Array([
    1,
    2,
    3,
    4
  ])
    .buffer;


const completed =
  await completeDriverPrivateUpload(
    env,
    user,
    issued.upload.id,
    {
      contentType:
        "image/jpeg",

      bodyBytes:
        body,

      requestId:
        "req_upload_test"
    },
    {
      nowMs:
        NOW + 1000
    }
  );


assert.equal(
  completed.ok,
  true
);

assert.equal(
  completed.resource.kind,
  "passport_main"
);

assert.equal(
  completed.resource.status,
  "pending"
);

assert.equal(
  DB.state.documents.length,
  1
);

assert.equal(
  DB.state.audits.length,
  1
);

assert.equal(
  DRIVER_PRIVATE_FILES
    .objects
    .size,
  1
);

assert.ok(
  DB.state.upload
    .consumed_at
);


const repeated =
  await completeDriverPrivateUpload(
    env,
    user,
    issued.upload.id,
    {
      contentType:
        "image/jpeg",

      bodyBytes:
        body,

      requestId:
        "req_upload_repeat"
    },
    {
      nowMs:
        NOW + 2000
    }
  );


assert.equal(
  repeated.status,
  409
);

assert.equal(
  repeated.code,
  "upload_already_consumed"
);

assert.equal(
  DB.state.documents.length,
  1
);


const oversized =
  await issueDriverPrivateUpload(
    env,
    user,
    {
      resourceType:
        "document",

      kind:
        "passport_main",

      contentType:
        "image/jpeg",

      contentLength:
        1048577
    },
    {
      nowMs:
        NOW
    }
  );


assert.equal(
  oversized.status,
  400
);

assert.equal(
  oversized.code,
  "invalid_upload_size"
);


const noStorage =
  await completeDriverPrivateUpload(
    {
      DB,
      DRIVER_UPLOAD_MAX_BYTES:
        "1048576"
    },
    user,
    issued.upload.id,
    {
      contentType:
        "image/jpeg",

      bodyBytes:
        body,

      requestId:
        "req_no_storage"
    },
    {
      nowMs:
        NOW + 3000
    }
  );


assert.equal(
  noStorage.status,
  503
);

assert.equal(
  noStorage.code,
  "driver_private_storage_not_configured"
);


console.log(
  "✓ DRIVER PRIVATE UPLOAD TESTS PASSED"
);
