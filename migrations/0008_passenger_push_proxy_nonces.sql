-- PUSH-01F. New passenger-only HMAC replay cache. Additive migration.
-- DO NOT apply to production or staging without separate approval.
-- The existing v1 proxy authentication and staff endpoints are unaffected.
CREATE TABLE passenger_push_proxy_nonces (
  nonce TEXT PRIMARY KEY NOT NULL
    CHECK(length(nonce) = 32),
  seen_at INTEGER NOT NULL
    CHECK(seen_at > 0)
);
CREATE INDEX idx_passenger_push_proxy_nonces_seen_at
  ON passenger_push_proxy_nonces(seen_at);
