-- =========================================
-- ASSIGNMENT OPERATIONAL PHASES
-- Migration: 0014
--
-- D3 foundation only.
-- Face/liveness provider remains unselected
-- until D4 is separately approved.
-- =========================================

ALTER TABLE order_assignments
ADD COLUMN phase TEXT NOT NULL DEFAULT 'assigned'
    CHECK (
        phase IN (
            'assigned',
            'en_route_to_pickup',
            'arrived',
            'in_trip'
        )
    );

ALTER TABLE order_assignments
ADD COLUMN phase_updated_at INTEGER DEFAULT NULL
    CHECK (
        phase_updated_at IS NULL
        OR phase_updated_at > 0
    );

ALTER TABLE order_assignments
ADD COLUMN verification_session_id TEXT DEFAULT NULL
    CHECK (
        verification_session_id IS NULL
        OR length(verification_session_id)
           BETWEEN 8 AND 120
    );

ALTER TABLE identity_verifications
ADD COLUMN assignment_revision INTEGER NOT NULL DEFAULT 1
    CHECK (assignment_revision >= 1);

CREATE INDEX idx_order_assignments_driver_phase
ON order_assignments (
    driver_id,
    state,
    phase,
    created_at DESC
);

CREATE INDEX idx_identity_verifications_assignment_revision
ON identity_verifications (
    assignment_id,
    assignment_revision,
    state,
    expires_at DESC
);
