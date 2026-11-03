-- PUSH-01A, additive D1 schema only. Do NOT apply to production without approval.
-- Independent of staff_push_devices. All timestamps are Unix milliseconds.
-- Authorization does NOT reside in SQL: callers must verify a dedicated
-- passenger push-management grant; device eligibility is additionally
-- bounded atomically to a non-terminal D1 order.

CREATE TABLE passenger_push_devices (
  installation_id TEXT PRIMARY KEY NOT NULL
    CHECK (length(installation_id) = 36),

  order_id TEXT NOT NULL
    REFERENCES orders(id)
    ON UPDATE RESTRICT
    ON DELETE CASCADE,

  platform TEXT NOT NULL DEFAULT 'android'
    CHECK (platform = 'android'),

  fcm_token TEXT NOT NULL
    CHECK (length(fcm_token) BETWEEN 1 AND 4096),

  created_at INTEGER NOT NULL
    CHECK (created_at > 0),

  updated_at INTEGER NOT NULL
    CHECK (updated_at >= created_at),

  expires_at INTEGER NOT NULL
    CHECK (expires_at > created_at),

  revoked_at INTEGER DEFAULT NULL
    CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE INDEX idx_passenger_push_order_expiry
ON passenger_push_devices(order_id, expires_at);

CREATE INDEX idx_passenger_push_expiry
ON passenger_push_devices(expires_at);

-- No FCM token UNIQUE constraint: Firebase token rotation may overlap.
-- No trigger/sending: this migration does not dispatch notifications.
