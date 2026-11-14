# Driver private uploads — backend Phase 1D

Status: backend foundation only. No production R2 bucket or deploy is created by this document.

## Security model

Driver documents and vehicle photos are private resources.

The API never returns a permanent public object URL. Upload flow:

1. authenticated Driver calls `POST /v1/driver/uploads`;
2. backend validates resource kind, vehicle ownership, content type and declared size;
3. backend creates a short-lived one-time upload session;
4. client sends the exact binary payload to `PUT /v1/driver/uploads/{uploadId}`;
5. backend atomically claims the upload session before object storage write;
6. Worker writes the object through the private R2 binding;
7. D1 records only private object metadata and audit state;
8. the upload session becomes consumed and cannot be reused.

A failed finalization performs best-effort R2 object and upload-claim compensation.

## Runtime configuration

Production/staging deployment must explicitly configure:

- R2 binding name: `DRIVER_PRIVATE_FILES`;
- numeric environment value: `DRIVER_UPLOAD_MAX_BYTES`.

The code is fail-closed when either storage binding or upload-size limit is absent.

Example Wrangler shape only (do not copy a bucket name blindly):

```toml
[[r2_buckets]]
binding = "DRIVER_PRIVATE_FILES"
bucket_name = "<private-driver-files-bucket>"

[vars]
DRIVER_UPLOAD_MAX_BYTES = "<approved-byte-limit>"
```

The actual bucket name and byte limit must be selected for the target environment before deploy.

## Accepted material types

Image:
- `image/jpeg`
- `image/png`
- `image/webp`

Documents may additionally use:
- `application/pdf`

Selfie resources and vehicle photos are image-only.

## Registration submission

`POST /v1/driver/registration/submit` checks:

Driver:
- full name;
- birth date;
- region;
- passport main page;
- passport registration page;
- passport selfie;
- identity reference selfie;
- driver licence front;
- driver licence back.

At least one vehicle must be complete:
- usage basis selected;
- STS front;
- STS back;
- rental contract only when usage basis is `rental`;
- left;
- front;
- right;
- rear;
- open trunk;
- rear cabin;
- front cabin.

An incomplete additional vehicle does not block a registration when at least one vehicle is complete.

Successful self-submit changes:
- driver registration: `draft|changes_required → submitted`;
- complete submitted vehicles: `draft → pending_review`;
- audit event: `driver.registration_submitted`.

The `submitted → under_review` transition belongs to the administrative moderation phase and is not performed by the driver endpoint.
