-- =========================================
-- PHOTO CONTROL + SUPPORT HARDENING
-- Migration: 0016
--
-- D3-only additive schema:
-- - optimistic revision for photo checks/support
-- - server restriction mode for photo checks
-- - creator/audit binding metadata
--
-- No D4-D7 provider or policy choices.
-- =========================================

ALTER TABLE vehicle_photo_checks
ADD COLUMN revision INTEGER NOT NULL DEFAULT 1
    CHECK (revision >= 1);

ALTER TABLE vehicle_photo_checks
ADD COLUMN restriction_mode TEXT NOT NULL DEFAULT 'grace_period'
    CHECK (
        restriction_mode IN (
            'grace_period',
            'after_current_trip',
            'immediate'
        )
    );

ALTER TABLE vehicle_photo_checks
ADD COLUMN created_by TEXT DEFAULT NULL
    REFERENCES staff_accounts(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT;

ALTER TABLE support_cases
ADD COLUMN revision INTEGER NOT NULL DEFAULT 1
    CHECK (revision >= 1);

CREATE INDEX idx_vehicle_photo_checks_blocking
ON vehicle_photo_checks (
    vehicle_id,
    result,
    restriction_mode,
    grace_until
);

CREATE INDEX idx_support_cases_revision
ON support_cases (
    id,
    revision
);
