import assert from "node:assert/strict";
import fs from "node:fs";

const sql =
  fs.readFileSync(
    new URL(
      "../migrations/0008_driver_registration_details.sql",
      import.meta.url
    ),
    "utf8"
  );

for (
  const column of [
    "full_name",
    "birth_date",
    "revision",
    "submitted_at"
  ]
) {

  assert.match(
    sql,
    new RegExp(
      `ADD\\s+COLUMN\\s+${column}\\b`,
      "i"
    ),
    `missing profile field: ${column}`
  );
}

assert.match(
  sql,
  /ADD\s+COLUMN\s+usage_basis\b[\s\S]*'owner'[\s\S]*'rental'[\s\S]*'other'/i
);

assert.match(
  sql,
  /CREATE\s+TABLE\s+vehicle_photos/i
);

for (
  const kind of [
    "left",
    "front",
    "right",
    "rear",
    "open_trunk",
    "rear_cabin",
    "front_cabin"
  ]
) {

  assert.match(
    sql,
    new RegExp(
      `'${kind}'`,
      "i"
    ),
    `missing vehicle photo kind: ${kind}`
  );
}

assert.match(
  sql,
  /private_object_key\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i
);

console.log(
  "✓ DRIVER REGISTRATION MIGRATION CONTRACT PASS"
);
