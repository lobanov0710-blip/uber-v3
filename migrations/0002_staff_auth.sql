-- =========================================
-- STAFF AUTHENTICATION
-- Migration: 0002
--
-- Project:
-- Transfer Servis / uber-v3
--
-- Security-critical staff authentication
-- state is stored in D1.
--
-- Passwords and refresh tokens are NEVER
-- stored in plaintext.
--
-- Timestamps:
-- Unix milliseconds.
-- =========================================


-- =========================================
-- STAFF ACCOUNTS
-- =========================================

CREATE TABLE staff_accounts (

    id TEXT
        PRIMARY KEY
        NOT NULL
        CHECK (
            length(id)
            BETWEEN 1 AND 100
        ),

    -- Login is normalized by the backend.
    --
    -- Application-level validation will
    -- restrict new logins to a safe ASCII
    -- identifier format.
    --
    -- NOCASE additionally prevents simple
    -- case-only duplicate accounts.
    login TEXT
        NOT NULL
        COLLATE NOCASE
        UNIQUE
        CHECK (
            length(login)
            BETWEEN 3 AND 64
        ),

    display_name TEXT
        NOT NULL
        CHECK (
            length(display_name)
            BETWEEN 1 AND 100
        ),

    role TEXT
        NOT NULL
        CHECK (
            role IN (
                'driver',
                'admin'
            )
        ),

    -- Authentication/account lifecycle.
    --
    -- pending:
    -- account exists but may not login.
    --
    -- active:
    -- login is permitted.
    --
    -- suspended:
    -- temporarily blocked administratively.
    --
    -- disabled:
    -- permanently disabled until explicitly
    -- re-enabled by an administrator.
    status TEXT
        NOT NULL
        DEFAULT 'pending'
        CHECK (
            status IN (
                'pending',
                'active',
                'suspended',
                'disabled'
            )
        ),

    -- Password verifier metadata.
    --
    -- Actual implementation:
    -- PBKDF2-HMAC-SHA256.
    password_algorithm TEXT
        NOT NULL
        CHECK (
            password_algorithm =
                'pbkdf2-sha256'
        ),

    password_iterations INTEGER
        NOT NULL
        CHECK (
            password_iterations
            BETWEEN 100000
            AND 5000000
        ),

    -- Base64url encoded random salt.
    password_salt TEXT
        NOT NULL
        CHECK (
            length(password_salt)
            BETWEEN 16 AND 128
        ),

    -- Base64url encoded derived key.
    password_hash TEXT
        NOT NULL
        CHECK (
            length(password_hash)
            BETWEEN 32 AND 256
        ),

    -- Incrementing this invalidates
    -- all previously issued access JWTs.
    token_version INTEGER
        NOT NULL
        DEFAULT 1
        CHECK (
            token_version >= 1
        ),

    -- Brute-force protection.
    failed_login_count INTEGER
        NOT NULL
        DEFAULT 0
        CHECK (
            failed_login_count >= 0
        ),

    locked_until INTEGER
        DEFAULT NULL
        CHECK (
            locked_until IS NULL
            OR locked_until > 0
        ),

    last_failed_login_at INTEGER
        DEFAULT NULL
        CHECK (
            last_failed_login_at IS NULL
            OR last_failed_login_at > 0
        ),

    last_login_at INTEGER
        DEFAULT NULL
        CHECK (
            last_login_at IS NULL
            OR last_login_at > 0
        ),

    password_changed_at INTEGER
        NOT NULL
        CHECK (
            password_changed_at > 0
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
        )
);


-- =========================================
-- STAFF SESSIONS
-- =========================================
--
-- Refresh tokens are opaque random secrets.
--
-- D1 stores ONLY:
--
-- SHA-256(refresh token)
--
-- The plaintext refresh token exists only:
--
-- server generation
--      ->
-- client secure storage
--
-- Rotation keeps the old session record
-- revoked so replay can be detected later.
-- =========================================

CREATE TABLE staff_sessions (

    id TEXT
        PRIMARY KEY
        NOT NULL
        CHECK (
            length(id)
            BETWEEN 1 AND 100
        ),

    account_id TEXT
        NOT NULL,

    -- All rotated sessions belonging to
    -- one login/session lineage share
    -- the same family id.
    family_id TEXT
        NOT NULL
        CHECK (
            length(family_id)
            BETWEEN 1 AND 100
        ),

    -- SHA-256 of the plaintext refresh
    -- token, Base64url encoded.
    refresh_token_hash TEXT
        NOT NULL
        UNIQUE
        CHECK (
            length(refresh_token_hash) = 43
        ),

    created_at INTEGER
        NOT NULL
        CHECK (
            created_at > 0
        ),

    expires_at INTEGER
        NOT NULL
        CHECK (
            expires_at > created_at
        ),

    last_used_at INTEGER
        DEFAULT NULL
        CHECK (
            last_used_at IS NULL
            OR last_used_at >= created_at
        ),

    revoked_at INTEGER
        DEFAULT NULL
        CHECK (
            revoked_at IS NULL
            OR revoked_at >= created_at
        ),

    -- Session which replaced this one
    -- during refresh-token rotation.
    replaced_by_session_id TEXT
        DEFAULT NULL
        CHECK (
            replaced_by_session_id IS NULL
            OR length(
                replaced_by_session_id
            ) BETWEEN 1 AND 100
        ),

    FOREIGN KEY (
        account_id
    )
    REFERENCES staff_accounts(id)
    ON UPDATE RESTRICT
    ON DELETE CASCADE
);


-- =========================================
-- STAFF ACCOUNT INDEXES
-- =========================================

CREATE INDEX idx_staff_accounts_role_status
ON staff_accounts (
    role,
    status
);

CREATE INDEX idx_staff_accounts_locked_until
ON staff_accounts (
    locked_until
);


-- =========================================
-- STAFF SESSION INDEXES
-- =========================================

CREATE INDEX idx_staff_sessions_account
ON staff_sessions (
    account_id,
    revoked_at,
    expires_at
);

CREATE INDEX idx_staff_sessions_family
ON staff_sessions (
    family_id
);

CREATE INDEX idx_staff_sessions_expires
ON staff_sessions (
    expires_at
);