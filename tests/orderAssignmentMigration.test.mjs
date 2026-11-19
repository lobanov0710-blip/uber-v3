import assert from "node:assert/strict";
import fs from "node:fs";

const sql =
  fs.readFileSync(
    new URL(
      "../migrations/0013_order_assignment_revision.sql",
      import.meta.url
    ),
    "utf8"
  );


assert.match(
  sql,
  /ALTER\s+TABLE\s+orders[\s\S]*ADD\s+COLUMN\s+revision\s+INTEGER\s+NOT\s+NULL\s+DEFAULT\s+1/i
);

assert.match(
  sql,
  /ALTER\s+TABLE\s+orders[\s\S]*ADD\s+COLUMN\s+last_assignment_id\s+TEXT/i
);


console.log(
  "✓ ORDER ASSIGNMENT MIGRATION TESTS PASSED"
);
