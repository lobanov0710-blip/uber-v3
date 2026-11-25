-- =========================================
-- DRIVER REGISTRATION DETAILS
-- Migration: 0008
--
-- Extends the approved driver/profile and
-- vehicle model with registration fields
-- required by Transfer Driver TЗ v1.0.
-- =========================================

ALTER TABLE driver_profiles
ADD COLUMN full_name TEXT DEFAULT NULL
    CHECK (
        full_name IS NULL
        OR length(full_name) BETWEEN 2 AND 100
    );

ALTER TABLE driver_profiles
ADD COLUMN birth_date TEXT DEFAULT NULL
    CHECK (
        birth_date IS NULL
        OR birth_date GLOB
           '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    );

ALTER TABLE driver_profiles
ADD COLUMN revision INTEGER NOT NULL DEFAULT 1
    CHECK (revision >= 1);

ALTER TABLE driver_profiles
ADD COLUMN submitted_at INTEGER DEFAULT NULL
    CHECK (submitted_at IS NULL OR submitted_at > 0);


ALTER TABLE vehicles
ADD COLUMN usage_basis TEXT DEFAULT NULL
    CHECK (
        usage_basis IS NULL
        OR usage_basis IN ('owner','rental','other')
    );


CREATE TABLE vehicle_photos (
    id TEXT PRIMARY KEY NOT NULL,
    vehicle_id TEXT NOT NULL,
    kind TEXT NOT NULL
        CHECK (kind IN (
            'left',
            'front',
            'right',
            'rear',
            'open_trunk',
            'rear_cabin',
            'front_cabin'
        )),
    private_object_key TEXT NOT NULL UNIQUE
        CHECK (length(private_object_key) BETWEEN 1 AND 500),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN (
            'pending','verified','changes_required','rejected'
        )),
    created_at INTEGER NOT NULL CHECK (created_at > 0),
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
    FOREIGN KEY (vehicle_id)
        REFERENCES vehicles(id)
        ON UPDATE RESTRICT
        ON DELETE CASCADE
);

CREATE INDEX idx_vehicle_photos_vehicle_kind
ON vehicle_photos (
    vehicle_id,
    kind,
    status,
    created_at DESC
);
