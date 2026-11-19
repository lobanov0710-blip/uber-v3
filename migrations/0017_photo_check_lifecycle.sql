-- =========================================
-- PHOTO CONTROL LIFECYCLE
-- Migration: 0017
--
-- Links private vehicle photos to a concrete
-- photo-control check, records review history,
-- and stores the authoritative next due date.
-- =========================================

ALTER TABLE vehicles
ADD COLUMN last_photo_check_passed_at INTEGER DEFAULT NULL
    CHECK (
        last_photo_check_passed_at IS NULL
        OR last_photo_check_passed_at > 0
    );

ALTER TABLE vehicles
ADD COLUMN next_photo_check_due_at INTEGER DEFAULT NULL
    CHECK (
        next_photo_check_due_at IS NULL
        OR next_photo_check_due_at > 0
    );

ALTER TABLE driver_upload_sessions
ADD COLUMN photo_check_id TEXT DEFAULT NULL
    REFERENCES vehicle_photo_checks(id)
    ON UPDATE RESTRICT
    ON DELETE CASCADE;

ALTER TABLE vehicle_photos
ADD COLUMN photo_check_id TEXT DEFAULT NULL
    REFERENCES vehicle_photo_checks(id)
    ON UPDATE RESTRICT
    ON DELETE CASCADE;

ALTER TABLE vehicle_photo_checks
ADD COLUMN next_due_at INTEGER DEFAULT NULL
    CHECK (
        next_due_at IS NULL
        OR next_due_at > 0
    );

ALTER TABLE vehicle_photo_checks
ADD COLUMN last_review_id TEXT DEFAULT NULL
    CHECK (
        last_review_id IS NULL
        OR length(last_review_id)
           BETWEEN 8 AND 100
    );

CREATE TABLE vehicle_photo_check_reviews (
    id TEXT PRIMARY KEY NOT NULL,
    photo_check_id TEXT NOT NULL,
    actor_account_id TEXT NOT NULL,
    decision TEXT NOT NULL
        CHECK (
            decision IN (
                'passed',
                'failed',
                'manual_review'
            )
        ),
    note TEXT DEFAULT NULL
        CHECK (
            note IS NULL
            OR length(note) BETWEEN 1 AND 1000
        ),
    created_at INTEGER NOT NULL
        CHECK (created_at > 0),
    FOREIGN KEY (photo_check_id)
        REFERENCES vehicle_photo_checks(id)
        ON UPDATE RESTRICT
        ON DELETE CASCADE,
    FOREIGN KEY (actor_account_id)
        REFERENCES staff_accounts(id)
        ON UPDATE RESTRICT
        ON DELETE RESTRICT
);

CREATE INDEX idx_vehicle_photos_photo_check
ON vehicle_photos (
    photo_check_id,
    kind,
    created_at DESC
);

CREATE INDEX idx_upload_sessions_photo_check
ON driver_upload_sessions (
    photo_check_id,
    consumed_at,
    expires_at
);

CREATE INDEX idx_photo_check_reviews_check
ON vehicle_photo_check_reviews (
    photo_check_id,
    created_at DESC
);

CREATE UNIQUE INDEX idx_photo_checks_monthly_due
ON vehicle_photo_checks (
    vehicle_id,
    due_at
)
WHERE kind = 'monthly';

CREATE INDEX idx_vehicles_photo_check_due
ON vehicles (
    status,
    next_photo_check_due_at
);
