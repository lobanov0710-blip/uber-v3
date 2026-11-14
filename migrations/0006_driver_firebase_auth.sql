-- =========================================
-- DRIVER FIREBASE AUTH
-- Migration: 0006
--
-- Approved foundation:
-- Transfer Driver Technical Decision D2.
--
-- Firebase identity is mapped to the existing
-- D1 staff account/session model. Raw Firebase
-- ID tokens are never persisted.
-- =========================================

CREATE TABLE driver_firebase_identities (
    firebase_uid TEXT PRIMARY KEY NOT NULL
        CHECK (length(firebase_uid) BETWEEN 1 AND 128),
    firebase_project_id TEXT NOT NULL
        CHECK (length(firebase_project_id) BETWEEN 4 AND 100),
    staff_account_id TEXT NOT NULL UNIQUE,
    normalized_phone TEXT NOT NULL UNIQUE
        CHECK (
            normalized_phone GLOB '+[1-9]*'
            AND length(normalized_phone) BETWEEN 9 AND 16
        ),
    last_auth_time INTEGER NOT NULL CHECK (last_auth_time > 0),
    last_verified_at INTEGER NOT NULL CHECK (last_verified_at > 0),
    created_at INTEGER NOT NULL CHECK (created_at > 0),
    FOREIGN KEY (staff_account_id)
        REFERENCES driver_profiles(staff_account_id)
        ON UPDATE RESTRICT
        ON DELETE CASCADE
);

CREATE INDEX idx_driver_firebase_project
ON driver_firebase_identities (
    firebase_project_id,
    last_verified_at DESC
);


CREATE TABLE driver_firebase_exchange_replay (
    token_digest TEXT PRIMARY KEY NOT NULL
        CHECK (length(token_digest) = 43),
    firebase_uid TEXT NOT NULL,
    installation_id TEXT NOT NULL
        CHECK (length(installation_id) = 36),
    token_expires_at INTEGER NOT NULL
        CHECK (token_expires_at > 0),
    consumed_at INTEGER NOT NULL
        CHECK (consumed_at > 0),
    FOREIGN KEY (firebase_uid)
        REFERENCES driver_firebase_identities(firebase_uid)
        ON UPDATE RESTRICT
        ON DELETE CASCADE
);

CREATE INDEX idx_driver_firebase_replay_expiry
ON driver_firebase_exchange_replay (
    token_expires_at
);

CREATE INDEX idx_driver_firebase_replay_uid
ON driver_firebase_exchange_replay (
    firebase_uid,
    consumed_at DESC
);
