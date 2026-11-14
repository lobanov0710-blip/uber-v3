-- Additive OWNER MFA. No existing data is updated and no remote apply is implied.
CREATE TABLE admin_mfa_factors (
 account_id TEXT PRIMARY KEY REFERENCES staff_accounts(id) ON DELETE CASCADE,
 encrypted_seed TEXT NOT NULL CHECK(length(encrypted_seed) BETWEEN 32 AND 1024),
 revision TEXT NOT NULL CHECK(length(revision) BETWEEN 16 AND 100),
 last_counter INTEGER NOT NULL CHECK(last_counter >= -1),
 enabled_at INTEGER NOT NULL CHECK(enabled_at > 0)
);
CREATE TABLE admin_mfa_challenges (
 digest TEXT PRIMARY KEY CHECK(length(digest)=64),
 account_id TEXT NOT NULL REFERENCES staff_accounts(id) ON DELETE CASCADE,
 token_version INTEGER NOT NULL CHECK(token_version > 0),
 factor_revision TEXT,
 created_at INTEGER NOT NULL CHECK(created_at > 0),
 expires_at INTEGER NOT NULL CHECK(expires_at > created_at),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
 consumed_at INTEGER,
 claim_id TEXT
);
CREATE INDEX idx_admin_mfa_challenges_expiry ON admin_mfa_challenges(expires_at);
CREATE TABLE admin_mfa_bootstrap (
 account_id TEXT PRIMARY KEY REFERENCES staff_accounts(id) ON DELETE CASCADE,
 digest TEXT NOT NULL UNIQUE CHECK(length(digest)=64),
 expires_at INTEGER NOT NULL CHECK(expires_at > 0),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
 enrollment_digest TEXT,
 consumed_at INTEGER
);
CREATE TABLE admin_mfa_enrollments (
 digest TEXT PRIMARY KEY CHECK(length(digest)=64),
 account_id TEXT NOT NULL REFERENCES staff_accounts(id) ON DELETE CASCADE,
 challenge_digest TEXT NOT NULL REFERENCES admin_mfa_challenges(digest) ON DELETE CASCADE,
 encrypted_seed TEXT NOT NULL CHECK(length(encrypted_seed) BETWEEN 32 AND 1024),
 expires_at INTEGER NOT NULL CHECK(expires_at > 0),
 consumed_at INTEGER,
 claim_id TEXT
);
CREATE TABLE admin_mfa_recovery (
 digest TEXT PRIMARY KEY CHECK(length(digest)=64),
 account_id TEXT NOT NULL REFERENCES staff_accounts(id) ON DELETE CASCADE,
 factor_revision TEXT NOT NULL,
 used_at INTEGER,
 used_claim TEXT
);
CREATE TABLE admin_mfa_session_families (
 family_id TEXT PRIMARY KEY,
 account_id TEXT NOT NULL REFERENCES staff_accounts(id) ON DELETE CASCADE,
 factor_revision TEXT NOT NULL,
 token_version INTEGER NOT NULL CHECK(token_version > 0),
 verified_at INTEGER NOT NULL CHECK(verified_at > 0),
 expires_at INTEGER NOT NULL CHECK(expires_at > verified_at),
 method TEXT NOT NULL CHECK(method IN ('totp','recovery'))
);
CREATE TABLE admin_mfa_limits (
 kind TEXT NOT NULL CHECK(kind IN ('account','ip')),
 digest TEXT NOT NULL CHECK(length(digest)=64),
 window_start INTEGER NOT NULL CHECK(window_start >= 0),
 failures INTEGER NOT NULL DEFAULT 0 CHECK(failures >= 0),
 PRIMARY KEY(kind,digest,window_start)
);
