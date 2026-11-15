# G2 Admin registration moderation

Implementation of approved specification §§28–35 and D3, continued by the owner
on 2026-11-15. G1 remains suspended; D4–D7 are not approved by this work.
This document describes the implemented feature branch, not a deployment.

All requests require an active D1 staff session and current server permissions.
OWNER additionally requires the approved, unexpired server MFA evidence.
All JSON responses use no-store; no private object keys or public download URLs.

| Endpoint | Permission / body |
|---|---|
| GET /v1/admin/registrations?status=…&limit=50 | drivers.read. Explicit status: submitted, under_review, changes_required, approved, rejected. Missing status keeps the existing active queue of the first three. No draft filter. |
| GET /v1/admin/registrations/{driverId} | Any of drivers.verify_documents, drivers.verify_identity, vehicles.verify; OWNER. Returns profile, vehicles, documents/photos metadata and up to 200 review events. |
| POST …/{driverId}/review | drivers.verify_documents or drivers.verify_identity; expectedRevision. |
| POST …/{driverId}/review/items/{type}/{id} | document: drivers.verify_documents; vehicle/vehicle_photo: vehicles.verify. decision, expectedRevision, optional note. |
| POST …/{driverId}/review/complete | All three review grants, or OWNER. decision, expectedRevision, optional note. |
| GET …/{driverId}/resources/document/{id} | documents.read_sensitive AND the matching drivers.verify_documents / drivers.verify_identity permission; OWNER. Every successful read is audited before body is returned. |
| GET …/{driverId}/resources/vehicle_photo/{id} | vehicles.verify; OWNER. Audited private read. |

Mutation bodies are bounded to 4096 bytes, including streamed/chunked JSON.
Every mutation requires Idempotency-Key and the original target revision.
Document/photo decisions: verified, changes_required, rejected. Vehicle/final
decisions: approved, changes_required, rejected. A nonempty note (up to 1000
characters, no prohibited controls) is required for changes_required/rejected.
This enforces the owner's approved correction-with-reason workflow.

The existing atomic transactions store the target update, review history,
idempotency outcome and audit together. Retry rechecks current authorization
before replaying an acknowledgement. Stale revisions and another body under the
same key are rejected. Returning one item preserves already verified items.

Manual identity verified/approved remains rejected: D4 provider is not approved.
Final approval still requires server-confirmed identity, complete verified driver
documents and an approved vehicle; an Admin button cannot bypass these checks.

The Android client uses the existing fixed resource routes directly, keeps bounded
JPEG/PNG/WebP previews only in foreground memory, and never exports them or launches
an external viewer. Notes, metadata, preview and pending action are excluded from
saved state and cleared on background. An uncertain POST can only be retried
explicitly with its original actor/target/revision/body/key, or followed by a fresh
read. A POST is never automatically repeated after 401 or as a different account.

Tests use synthetic data and ephemeral SQLite/native workerd D1. No new migration,
real storage credentials, production data, remote migration, merge or deployment.
Full results and remaining limitations are recorded in PROJECT_JOURNAL.md.
