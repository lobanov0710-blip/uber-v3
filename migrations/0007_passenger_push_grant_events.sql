-- PUSH-01D: additive rolling-window rate limiter (not a fixed window).
-- Do not apply to Cloudflare D1 production without explicit approval.
-- The earlier 0006 passenger_push_grant_limits table is left intact but
-- no longer used; do not destructively alter applied migrations.
CREATE TABLE passenger_push_grant_events (
  event_id TEXT PRIMARY KEY NOT NULL
    CHECK (length(event_id) = 36),
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL CHECK (created_at > 0)
);
CREATE INDEX idx_passenger_push_grant_events_order_time
  ON passenger_push_grant_events(order_id, created_at);
