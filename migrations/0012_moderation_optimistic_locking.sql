-- =========================================
-- MODERATION OPTIMISTIC LOCKING
-- Migration: 0012
--
-- Adds revision to resources that did not
-- previously have one and an opaque internal
-- review marker used to bind state changes to
-- moderation history atomically.
-- =========================================

ALTER TABLE driver_profiles
ADD COLUMN last_review_id TEXT DEFAULT NULL
    CHECK (
        last_review_id IS NULL
        OR length(last_review_id) BETWEEN 8 AND 100
    );

ALTER TABLE vehicles
ADD COLUMN last_review_id TEXT DEFAULT NULL
    CHECK (
        last_review_id IS NULL
        OR length(last_review_id) BETWEEN 8 AND 100
    );

ALTER TABLE document_resources
ADD COLUMN revision INTEGER NOT NULL DEFAULT 1
    CHECK (revision >= 1);

ALTER TABLE document_resources
ADD COLUMN last_review_id TEXT DEFAULT NULL
    CHECK (
        last_review_id IS NULL
        OR length(last_review_id) BETWEEN 8 AND 100
    );

ALTER TABLE vehicle_photos
ADD COLUMN revision INTEGER NOT NULL DEFAULT 1
    CHECK (revision >= 1);

ALTER TABLE vehicle_photos
ADD COLUMN last_review_id TEXT DEFAULT NULL
    CHECK (
        last_review_id IS NULL
        OR length(last_review_id) BETWEEN 8 AND 100
    );
