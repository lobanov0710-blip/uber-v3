-- =========================================
-- ADMIN MODERATION HISTORY
-- Migration: 0010
-- =========================================

CREATE TABLE moderation_reviews (
    id TEXT PRIMARY KEY NOT NULL,
    actor_account_id TEXT NOT NULL,
    target_type TEXT NOT NULL
        CHECK (target_type IN (
            'driver_registration',
            'document',
            'vehicle',
            'vehicle_photo'
        )),
    target_id TEXT NOT NULL
        CHECK (length(target_id) BETWEEN 1 AND 120),
    decision TEXT NOT NULL
        CHECK (decision IN (
            'under_review',
            'verified',
            'changes_required',
            'approved',
            'rejected'
        )),
    note TEXT DEFAULT NULL
        CHECK (
            note IS NULL
            OR length(note) BETWEEN 1 AND 1000
        ),
    created_at INTEGER NOT NULL
        CHECK (created_at > 0),
    FOREIGN KEY (actor_account_id)
        REFERENCES staff_accounts(id)
        ON UPDATE RESTRICT
        ON DELETE RESTRICT
);

CREATE INDEX idx_moderation_reviews_target
ON moderation_reviews (
    target_type,
    target_id,
    created_at DESC
);

CREATE INDEX idx_moderation_reviews_actor
ON moderation_reviews (
    actor_account_id,
    created_at DESC
);
