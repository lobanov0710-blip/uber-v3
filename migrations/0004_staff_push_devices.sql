-- =========================================
-- STAFF PUSH DEVICES
-- Migration: 0004
--
-- Project:
-- Transfer Servis / uber-v3
--
-- Stores FCM registration state for
-- authenticated staff application
-- installations.
--
-- Security:
--
-- - FCM tokens are never logged.
-- - FCM tokens are never returned by API.
-- - Device ownership comes from the
--   authenticated staff account.
-- - session_family_id binds registration
--   to the staff login/session lineage.
--
-- Timestamps:
-- Unix milliseconds.
-- =========================================


CREATE TABLE staff_push_devices (

    -- Stable identifier generated locally
    -- by one application installation.
    --
    -- This is NOT the FCM token.
    installation_id TEXT
        PRIMARY KEY
        NOT NULL
        CHECK (
            length(installation_id) = 36
        ),

    -- Authoritative staff account which
    -- registered this installation.
    account_id TEXT
        NOT NULL,

    -- Stable family identifier of the
    -- authenticated staff refresh-session
    -- lineage.
    --
    -- Refresh-token rotation creates a new
    -- session id but preserves family_id.
    session_family_id TEXT
        NOT NULL
        CHECK (
            length(session_family_id)
            BETWEEN 1 AND 100
        ),

    -- Currently only Android staff clients
    -- are supported.
    platform TEXT
        NOT NULL
        CHECK (
            platform = 'android'
        ),

    -- Firebase Cloud Messaging
    -- registration token.
    --
    -- This value must remain plaintext
    -- because FCM requires the actual token
    -- when sending a push message.
    --
    -- Never log or expose this value.
    fcm_token TEXT
        NOT NULL
        CHECK (
            length(fcm_token)
            BETWEEN 1 AND 4096
        ),

    created_at INTEGER
        NOT NULL
        CHECK (
            created_at > 0
        ),

    updated_at INTEGER
        NOT NULL
        CHECK (
            updated_at >= created_at
        ),

    FOREIGN KEY (
        account_id
    )
    REFERENCES staff_accounts(id)
    ON UPDATE RESTRICT
    ON DELETE CASCADE
);


-- =========================================
-- INDEXES
-- =========================================

CREATE INDEX idx_staff_push_devices_account
ON staff_push_devices (
    account_id,
    updated_at DESC
);


CREATE INDEX idx_staff_push_devices_family
ON staff_push_devices (
    session_family_id
);


-- Token is intentionally not UNIQUE.
--
-- FCM token rotation and stale rows must
-- not turn registration refresh into a
-- database constraint failure.
--
-- Send-side code must de-duplicate tokens.
CREATE INDEX idx_staff_push_devices_token
ON staff_push_devices (
    fcm_token
);
