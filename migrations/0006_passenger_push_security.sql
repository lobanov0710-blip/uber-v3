-- PUSH-01C. Additive security tables. Never apply to remote D1 without approval.
-- Store no tokens or client IPs. A grant jti is single-use for both PUT/DELETE.
CREATE TABLE passenger_push_grant_uses (
  grant_id TEXT PRIMARY KEY NOT NULL CHECK(length(grant_id) = 36),
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  installation_id TEXT NOT NULL CHECK(length(installation_id) = 36),
  used_at INTEGER NOT NULL CHECK(used_at > 0)
);
CREATE INDEX idx_passenger_push_grant_uses_at
  ON passenger_push_grant_uses(used_at);

-- Atomic sliding-window counter per authorized order (no PII / IP).
-- Window=60s; max 5 grants/order/window. This does not replace gateway
-- abuse controls for invalid/untrusted requests.
CREATE TABLE passenger_push_grant_limits (
  order_id TEXT PRIMARY KEY NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  window_start INTEGER NOT NULL CHECK(window_start > 0),
  attempts INTEGER NOT NULL CHECK(attempts BETWEEN 1 AND 5)
);
