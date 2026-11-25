import assert from "node:assert/strict";
import fs from "node:fs";

const sql =
  fs.readFileSync(
    new URL(
      "../migrations/0014_assignment_operational_phases.sql",
      import.meta.url
    ),
    "utf8"
  );


for (
  const phase of [
    "assigned",
    "en_route_to_pickup",
    "arrived",
    "in_trip"
  ]
) {
  assert.match(
    sql,
    new RegExp(
      `'${phase}'`,
      "i"
    )
  );
}


assert.match(
  sql,
  /ADD\s+COLUMN\s+verification_session_id\s+TEXT/i
);

assert.match(
  sql,
  /ALTER\s+TABLE\s+identity_verifications[\s\S]*ADD\s+COLUMN\s+assignment_revision\s+INTEGER/i
);


console.log(
  "✓ ASSIGNMENT OPERATIONAL MIGRATION TESTS PASSED"
);
