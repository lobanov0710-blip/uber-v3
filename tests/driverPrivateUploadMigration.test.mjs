import assert from "node:assert/strict";
import fs from "node:fs";

const sql =
  fs.readFileSync(
    new URL(
      "../migrations/0009_driver_private_uploads.sql",
      import.meta.url
    ),
    "utf8"
  );


assert.match(
  sql,
  /CREATE\s+TABLE\s+driver_upload_sessions/i
);

assert.match(
  sql,
  /private_object_key\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i
);

assert.match(
  sql,
  /claim_id\s+TEXT\s+DEFAULT\s+NULL/i
);

assert.match(
  sql,
  /claimed_at\s+INTEGER\s+DEFAULT\s+NULL/i
);

assert.match(
  sql,
  /consumed_at\s+INTEGER\s+DEFAULT\s+NULL/i
);

assert.doesNotMatch(
  sql,
  /public_url|download_url|https?:\/\//i,
  "private upload schema must not persist public URLs"
);


console.log(
  "✓ DRIVER PRIVATE UPLOAD MIGRATION CONTRACT PASS"
);
