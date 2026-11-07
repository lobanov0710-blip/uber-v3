-- =========================================
-- DRIVER PRIVATE UPLOAD SESSIONS
-- Migration: 0009
--
-- One-time upload authorization for private
-- driver documents and vehicle photos.
-- No public URL is stored.
-- =========================================

CREATE TABLE driver_upload_sessions (
    id TEXT PRIMARY KEY NOT NULL,
    driver_id TEXT NOT NULL,
    vehicle_id TEXT DEFAULT NULL,
    resource_type TEXT NOT NULL
        CHECK (resource_type IN ('document','vehicle_photo')),
    kind TEXT NOT NULL
        CHECK (length(kind) BETWEEN 2 AND 80),
    private_object_key TEXT NOT NULL UNIQUE
        CHECK (length(private_object_key) BETWEEN 1 AND 500),
    content_type TEXT NOT NULL
        CHECK (length(content_type) BETWEEN 3 AND 100),
    expected_bytes INTEGER NOT NULL
        CHECK (expected_bytes > 0),
    created_at INTEGER NOT NULL
        CHECK (created_at > 0),
    expires_at INTEGER NOT NULL
        CHECK (expires_at > created_at),
    claim_id TEXT DEFAULT NULL
        CHECK (
            claim_id IS NULL
            OR length(claim_id) BETWEEN 8 AND 100
        ),
    claimed_at INTEGER DEFAULT NULL
        CHECK (
            claimed_at IS NULL
            OR claimed_at >= created_at
        ),
    consumed_at INTEGER DEFAULT NULL
        CHECK (
            consumed_at IS NULL
            OR consumed_at >= created_at
        ),
    FOREIGN KEY (driver_id)
        REFERENCES driver_profiles(staff_account_id)
        ON UPDATE RESTRICT
        ON DELETE CASCADE,
    FOREIGN KEY (vehicle_id, driver_id)
        REFERENCES vehicles(id, driver_id)
        ON UPDATE RESTRICT
        ON DELETE CASCADE,
    CHECK (
        (resource_type = 'document')
        OR
        (resource_type = 'vehicle_photo' AND vehicle_id IS NOT NULL)
    ),
    CHECK (
        (claim_id IS NULL AND claimed_at IS NULL)
        OR
        (claim_id IS NOT NULL AND claimed_at IS NOT NULL)
    ),
    CHECK (
        consumed_at IS NULL
        OR claim_id IS NOT NULL
    )
);

CREATE INDEX idx_driver_upload_sessions_owner
ON driver_upload_sessions (
    driver_id,
    consumed_at,
    expires_at
);

CREATE INDEX idx_driver_upload_sessions_expiry
ON driver_upload_sessions (
    expires_at
);
