import assert from "node:assert/strict";
import fs from "node:fs";

const idempotencySql =
  fs.readFileSync(
    new URL(
      "../migrations/0011_mutation_idempotency.sql",
      import.meta.url
    ),
    "utf8"
  );

const lockingSql =
  fs.readFileSync(
    new URL(
      "../migrations/0012_moderation_optimistic_locking.sql",
      import.meta.url
    ),
    "utf8"
  );


assert.match(
  idempotencySql,
  /CREATE\s+TABLE\s+mutation_idempotency/i
);

assert.match(
  idempotencySql,
  /key_digest\s+TEXT\s+NOT\s+NULL[\s\S]*length\(key_digest\)\s*=\s*43/i
);

assert.match(
  idempotencySql,
  /request_digest\s+TEXT\s+NOT\s+NULL[\s\S]*length\(request_digest\)\s*=\s*43/i
);

assert.match(
  idempotencySql,
  /claim_id\s+TEXT\s+NOT\s+NULL/i
);

assert.doesNotMatch(
  idempotencySql,
  /idempotency_key\s+TEXT/i,
  "raw Idempotency-Key must not be persisted"
);


for (
  const table of [
    "document_resources",
    "vehicle_photos"
  ]
) {
  assert.match(
    lockingSql,
    new RegExp(
      `ALTER\\s+TABLE\\s+${table}[\\s\\S]*ADD\\s+COLUMN\\s+revision`,
      "i"
    )
  );
}


for (
  const table of [
    "driver_profiles",
    "vehicles",
    "document_resources",
    "vehicle_photos"
  ]
) {
  assert.match(
    lockingSql,
    new RegExp(
      `ALTER\\s+TABLE\\s+${table}[\\s\\S]*ADD\\s+COLUMN\\s+last_review_id`,
      "i"
    )
  );
}


console.log(
  "✓ MODERATION IDEMPOTENCY MIGRATION TESTS PASSED"
);
