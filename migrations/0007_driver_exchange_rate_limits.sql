-- =========================================
-- DRIVER FIREBASE EXCHANGE RATE LIMIT
-- Migration: 0007
--
-- Generic digest buckets only.
-- Raw phone numbers, installation identifiers
-- and IP addresses are not stored here.
-- =========================================

CREATE TABLE driver_exchange_rate_limits (
    bucket_key TEXT PRIMARY KEY NOT NULL
        CHECK (length(bucket_key) = 43),
    window_started_at INTEGER NOT NULL
        CHECK (window_started_at > 0),
    attempt_count INTEGER NOT NULL
        CHECK (attempt_count >= 1),
    blocked_until INTEGER DEFAULT NULL
        CHECK (blocked_until IS NULL OR blocked_until > 0),
    updated_at INTEGER NOT NULL
        CHECK (updated_at >= window_started_at)
);

CREATE INDEX idx_driver_exchange_rate_blocked
ON driver_exchange_rate_limits (
    blocked_until
);

CREATE INDEX idx_driver_exchange_rate_updated
ON driver_exchange_rate_limits (
    updated_at
);
