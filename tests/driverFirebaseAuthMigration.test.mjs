import assert from "node:assert/strict";
import fs from "node:fs";

const authSql =
  fs.readFileSync(
    new URL(
      "../migrations/0006_driver_firebase_auth.sql",
      import.meta.url
    ),
    "utf8"
  );

const rateSql =
  fs.readFileSync(
    new URL(
      "../migrations/0007_driver_exchange_rate_limits.sql",
      import.meta.url
    ),
    "utf8"
  );

assert.match(
  authSql,
  /CREATE\s+TABLE\s+driver_firebase_identities/i
);

assert.match(
  authSql,
  /firebase_uid\s+TEXT\s+PRIMARY\s+KEY/i
);

assert.match(
  authSql,
  /staff_account_id\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i
);

assert.match(
  authSql,
  /normalized_phone\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i
);

assert.match(
  authSql,
  /CREATE\s+TABLE\s+driver_firebase_exchange_replay/i
);

assert.match(
  authSql,
  /token_digest\s+TEXT\s+PRIMARY\s+KEY[\s\S]*length\(token_digest\)\s*=\s*43/i
);

assert.doesNotMatch(
  authSql,
  /firebase_id_token|raw_token/i,
  "raw Firebase tokens must never be persisted"
);

assert.match(
  rateSql,
  /CREATE\s+TABLE\s+driver_exchange_rate_limits/i
);

assert.match(
  rateSql,
  /bucket_key\s+TEXT\s+PRIMARY\s+KEY[\s\S]*length\(bucket_key\)\s*=\s*43/i
);

assert.doesNotMatch(
  rateSql,
  /phone_number|ip_address|installation_id/i,
  "rate limit storage must not persist raw identifiers"
);

console.log(
  "✓ DRIVER FIREBASE AUTH MIGRATION CONTRACT PASS"
);
