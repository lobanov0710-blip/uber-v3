# Admin vehicle/photo-control read API v1

Утверждено владельцем 2026-11-16: «Утверждают каталог и список».
Источник утверждённого предложения: TransferDriver6f4e3caf0ce283bbcca086ccf9b9e18f48935796,
docs/G2_PHOTO_CONTROL_NEXT_SLICE_PROPOSAL_2026-11-16.md.

GET /v1/admin/vehicles?status=...&limit=20&cursor=...
- vehicles.read, active staff session, current OWNER MFA.
- optional status: draft/pending_review/approved/photo_check_required/suspended/rejected.
- fields: id,driverId,make,model,plate,status,revision,lastPhotoCheckPassedAt,nextPhotoCheckDueAt.
- nullable dates; safe integer revisions/timestamps. No VIN/contact/materials.
- response: ok,vehicles,nextCursor,requestId.

GET /v1/admin/vehicles/{vehicleId}/photo-checks?limit=20&cursor=...
- vehicles.read + vehicles.verify; current OWNER MFA.
- fields: id,vehicleId,kind,restrictionMode,result,revision,dueAt,graceUntil,createdAt,updatedAt.
- response: ok,vehicleId,vehicleRevision,checks,nextCursor,requestId.
- No reason/review notes/photos/storage metadata. Vehicle revision and page in one batch snapshot.

Both: default20, limit1–50, strict unknown/duplicate/empty query rejection,
opaque canonical base64url cursor≤512 scoped to filter or vehicleId, keyset ID order.
no-store, safe error code/requestId, read audit with no query/cursor/free text.
Audit failure returns safe500 without data. Missing vehicle404; invalid ID/query400;
current auth401/403. Existing POST/create/review permissions and versions unchanged.
OWNER-only phone-test staging denies these operations404 before DB/auth.
No new tables, permissions, classifier activation, real material reads or deployment.

Verification: tests/adminVehicleRead.test.mjs (actual SQLite/HTTP), shared native
workflow tools/check_admin_vehicle_read_d1.mjs. Full final receipt is recorded
only after actual CI results; current work is not declared fully verified yet.
