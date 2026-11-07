import assert from "node:assert/strict";
import fs from "node:fs";

const sql =
  fs.readFileSync(
    new URL(
      "../migrations/0005_driver_platform_core.sql",
      import.meta.url
    ),
    "utf8"
  );

const requiredTables = [
  "driver_profiles",
  "vehicles",
  "document_resources",
  "driver_availability",
  "staff_owner_binding",
  "staff_permissions",
  "order_assignments",
  "identity_verifications",
  "vehicle_photo_checks",
  "support_cases",
  "chat_messages",
  "calls",
  "audit_events"
];

for (const table of requiredTables) {
  assert.match(
    sql,
    new RegExp(
      `CREATE\\s+TABLE\\s+${table}\\s*\\(`,
      "i"
    ),
    `missing table: ${table}`
  );
}

assert.match(
  sql,
  /vin\s+TEXT\s+NOT\s+NULL\s+UNIQUE[\s\S]*length\(vin\)\s*=\s*17/i,
  "VIN must be mandatory and unique"
);

assert.match(
  sql,
  /FOREIGN\s+KEY\s*\(active_vehicle_id,\s*driver_id\)[\s\S]*REFERENCES\s+vehicles\s*\(id,\s*driver_id\)/i,
  "active vehicle must belong to the driver"
);

assert.match(
  sql,
  /CREATE\s+UNIQUE\s+INDEX\s+idx_order_assignments_current[\s\S]*ON\s+order_assignments\s*\(order_id\)[\s\S]*WHERE\s+revoked_at\s+IS\s+NULL/i,
  "only one current assignment per order is allowed"
);

assert.match(
  sql,
  /FOREIGN\s+KEY\s*\(vehicle_id,\s*driver_id\)[\s\S]*REFERENCES\s+vehicles\s*\(id,\s*driver_id\)/i,
  "assignment vehicle must belong to assigned driver"
);

assert.match(
  sql,
  /FOREIGN\s+KEY\s*\(assignment_id,\s*order_id,\s*driver_id,\s*vehicle_id\)[\s\S]*REFERENCES\s+order_assignments/i,
  "identity verification must be bound to exact assignment tuple"
);

assert.match(
  sql,
  /staff_owner_binding[\s\S]*CHECK\s*\(singleton\s*=\s*1\)/i,
  "OWNER binding must be singleton"
);

assert.match(
  sql,
  /CREATE\s+TABLE\s+staff_permissions[\s\S]*PRIMARY\s+KEY\s*\(account_id,\s*permission\)/i,
  "permissions must be account-scoped and deduplicated"
);

assert.match(
  sql,
  /private_object_key\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i,
  "document resources must reference private object keys, not public URLs"
);

assert.match(
  sql,
  /CREATE\s+TABLE\s+chat_messages[\s\S]*expires_at\s+INTEGER\s+NOT\s+NULL/i,
  "chat messages require explicit expiry metadata"
);

assert.doesNotMatch(
  sql,
  /https?:\/\//i,
  "migration must not contain public resource URLs"
);

console.log("✓ DRIVER PLATFORM MIGRATION CONTRACT PASS");
