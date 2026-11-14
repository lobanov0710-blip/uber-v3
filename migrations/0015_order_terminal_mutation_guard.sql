-- =========================================
-- ORDER TERMINAL MUTATION GUARD
-- Migration: 0015
--
-- Binds a terminal order state change to the
-- exact winning idempotency claim. The value
-- is an opaque internal claim id, never the
-- raw Idempotency-Key.
-- =========================================

ALTER TABLE orders
ADD COLUMN last_terminal_claim_id TEXT DEFAULT NULL
    CHECK (
        last_terminal_claim_id IS NULL
        OR length(last_terminal_claim_id)
           BETWEEN 8 AND 100
    );

CREATE INDEX idx_orders_terminal_claim
ON orders (
    id,
    last_terminal_claim_id
);
