-- =========================================
-- STAFF ADMIN AUDIT
-- Migration: 0003
--
-- Project:
-- Transfer Servis / uber-v3
--
-- Records security-relevant administrative
-- operations performed against staff
-- accounts.
--
-- This table must NEVER contain:
--
-- - plaintext passwords
-- - password hashes
-- - password salts
-- - access tokens
-- - refresh tokens
--
-- Timestamps:
-- Unix milliseconds.
-- =========================================


CREATE TABLE staff_admin_audit (

    id TEXT
        PRIMARY KEY
        NOT NULL
        CHECK (
            length(id)
            BETWEEN 1 AND 100
        ),

    -- Authenticated administrator who
    -- performed the operation.
    actor_account_id TEXT
        NOT NULL,

    -- Staff account affected by the
    -- administrative operation.
    target_account_id TEXT
        NOT NULL,

    action TEXT
        NOT NULL
        CHECK (
            action IN (
                'account_created',
                'status_changed',
                'password_reset'
            )
        ),

    -- Used only for status changes.
    previous_status TEXT
        DEFAULT NULL
        CHECK (
            previous_status IS NULL
            OR previous_status IN (
                'pending',
                'active',
                'suspended',
                'disabled'
            )
        ),

    -- Used only for status changes.
    new_status TEXT
        DEFAULT NULL
        CHECK (
            new_status IS NULL
            OR new_status IN (
                'pending',
                'active',
                'suspended',
                'disabled'
            )
        ),

    created_at INTEGER
        NOT NULL
        CHECK (
            created_at > 0
        ),

    -- Status-change audit rows must contain
    -- both previous and new status values.
    --
    -- Other actions must not populate these
    -- fields.
    CHECK (
        (
            action = 'status_changed'
            AND previous_status IS NOT NULL
            AND new_status IS NOT NULL
        )
        OR
        (
            action IN (
                'account_created',
                'password_reset'
            )
            AND previous_status IS NULL
            AND new_status IS NULL
        )
    ),

    FOREIGN KEY (
        actor_account_id
    )
    REFERENCES staff_accounts(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,

    FOREIGN KEY (
        target_account_id
    )
    REFERENCES staff_accounts(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
);


-- =========================================
-- INDEXES
-- =========================================

CREATE INDEX idx_staff_admin_audit_actor
ON staff_admin_audit (
    actor_account_id,
    created_at DESC
);


CREATE INDEX idx_staff_admin_audit_target
ON staff_admin_audit (
    target_account_id,
    created_at DESC
);


CREATE INDEX idx_staff_admin_audit_created
ON staff_admin_audit (
    created_at DESC
);