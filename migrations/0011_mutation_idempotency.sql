-- =========================================
-- MUTATION IDEMPOTENCY
-- Migration: 0011
--
-- Raw Idempotency-Key values are never
-- persisted. Only SHA-256 base64url digests
-- are stored.
-- =========================================

CREATE TABLE mutation_idempotency (
    actor_account_id TEXT NOT NULL,
    operation TEXT NOT NULL
        CHECK (length(operation) BETWEEN 3 AND 120),
    key_digest TEXT NOT NULL
        CHECK (length(key_digest) = 43),
    request_digest TEXT NOT NULL
        CHECK (length(request_digest) = 43),
    state TEXT NOT NULL
        CHECK (state IN ('in_progress','completed')),
    http_status INTEGER DEFAULT NULL
        CHECK (
            http_status IS NULL
            OR http_status BETWEEN 200 AND 599
        ),
    result_code TEXT DEFAULT NULL
        CHECK (
            result_code IS NULL
            OR length(result_code) BETWEEN 1 AND 120
        ),
    result_json TEXT DEFAULT NULL
        CHECK (
            result_json IS NULL
            OR length(result_json) BETWEEN 2 AND 4000
        ),
    created_at INTEGER NOT NULL
        CHECK (created_at > 0),
    completed_at INTEGER DEFAULT NULL
        CHECK (
            completed_at IS NULL
            OR completed_at >= created_at
        ),
    PRIMARY KEY (
        actor_account_id,
        operation,
        key_digest
    ),
    FOREIGN KEY (actor_account_id)
        REFERENCES staff_accounts(id)
        ON UPDATE RESTRICT
        ON DELETE CASCADE,
    CHECK (
        (
            state = 'in_progress'
            AND http_status IS NULL
            AND result_code IS NULL
            AND result_json IS NULL
            AND completed_at IS NULL
        )
        OR
        (
            state = 'completed'
            AND http_status IS NOT NULL
            AND result_json IS NOT NULL
            AND completed_at IS NOT NULL
        )
    )
);

CREATE INDEX idx_mutation_idempotency_created
ON mutation_idempotency (
    created_at DESC
);
