-- =========================================
-- ORDER ASSIGNMENT REVISION
-- Migration: 0013
--
-- Adds optimistic locking for admin
-- assignment/reassignment and an internal
-- marker binding an order state change to the
-- exact order_assignments row created for it.
-- =========================================

ALTER TABLE orders
ADD COLUMN revision INTEGER NOT NULL DEFAULT 1
    CHECK (revision >= 1);

ALTER TABLE orders
ADD COLUMN last_assignment_id TEXT DEFAULT NULL
    CHECK (
        last_assignment_id IS NULL
        OR length(last_assignment_id) BETWEEN 8 AND 100
    );

CREATE INDEX idx_orders_revision
ON orders (
    id,
    revision
);
