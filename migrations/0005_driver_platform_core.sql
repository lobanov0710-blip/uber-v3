-- =========================================
-- DRIVER PLATFORM CORE
-- Migration: 0005
--
-- Approved foundation:
-- Transfer Driver Technical Decisions D1-D3.
--
-- Additive only. Existing staff/orders tables
-- remain unchanged in this migration.
-- Timestamps are Unix milliseconds.
-- =========================================

CREATE TABLE driver_profiles (
    staff_account_id TEXT PRIMARY KEY NOT NULL,
    normalized_phone TEXT NOT NULL UNIQUE
        CHECK (length(normalized_phone) BETWEEN 8 AND 20),
    registration_status TEXT NOT NULL DEFAULT 'draft'
        CHECK (registration_status IN (
            'draft','submitted','under_review',
            'changes_required','approved','rejected'
        )),
    region TEXT DEFAULT NULL
        CHECK (region IS NULL OR length(region) BETWEEN 1 AND 120),
    identity_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (identity_status IN (
            'pending','verified','retry_required',
            'identity_mismatch','manual_review_required','rejected'
        )),
    created_at INTEGER NOT NULL CHECK (created_at > 0),
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
    FOREIGN KEY (staff_account_id)
        REFERENCES staff_accounts(id)
        ON UPDATE RESTRICT
        ON DELETE CASCADE
);

CREATE INDEX idx_driver_profiles_registration
ON driver_profiles (registration_status, updated_at DESC);

CREATE INDEX idx_driver_profiles_identity
ON driver_profiles (identity_status, updated_at DESC);


CREATE TABLE vehicles (
    id TEXT PRIMARY KEY NOT NULL,
    driver_id TEXT NOT NULL,
    vin TEXT NOT NULL UNIQUE
        CHECK (length(vin) = 17),
    plate TEXT NOT NULL
        CHECK (length(plate) BETWEEN 1 AND 32),
    make TEXT NOT NULL
        CHECK (length(make) BETWEEN 1 AND 80),
    model TEXT NOT NULL
        CHECK (length(model) BETWEEN 1 AND 80),
    color TEXT DEFAULT NULL
        CHECK (color IS NULL OR length(color) BETWEEN 1 AND 80),
    class TEXT NOT NULL
        CHECK (class IN ('comfort','business','minivan')),
    capacity INTEGER NOT NULL
        CHECK (capacity BETWEEN 1 AND 20),
    baggage_capacity TEXT NOT NULL DEFAULT 'standard'
        CHECK (baggage_capacity IN ('reduced','standard','large')),
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN (
            'draft','pending_review','approved',
            'photo_check_required','suspended','rejected'
        )),
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
    created_at INTEGER NOT NULL CHECK (created_at > 0),
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
    UNIQUE (id, driver_id),
    FOREIGN KEY (driver_id)
        REFERENCES driver_profiles(staff_account_id)
        ON UPDATE RESTRICT
        ON DELETE CASCADE
);

CREATE INDEX idx_vehicles_driver_status
ON vehicles (driver_id, status, updated_at DESC);

CREATE INDEX idx_vehicles_plate
ON vehicles (plate);


CREATE TABLE document_resources (
    id TEXT PRIMARY KEY NOT NULL,
    owner_driver_id TEXT NOT NULL,
    vehicle_id TEXT DEFAULT NULL,
    kind TEXT NOT NULL
        CHECK (kind IN (
            'passport_main',
            'passport_registration',
            'passport_selfie',
            'identity_reference_selfie',
            'driver_license_front',
            'driver_license_back',
            'sts_front',
            'sts_back',
            'rental_contract',
            'osago',
            'taxi_permit',
            'diagnostic_card',
            'other'
        )),
    private_object_key TEXT NOT NULL UNIQUE
        CHECK (length(private_object_key) BETWEEN 1 AND 500),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN (
            'pending','verified','changes_required','rejected'
        )),
    expires_at INTEGER DEFAULT NULL
        CHECK (expires_at IS NULL OR expires_at > 0),
    retention_until INTEGER DEFAULT NULL
        CHECK (retention_until IS NULL OR retention_until > 0),
    created_at INTEGER NOT NULL CHECK (created_at > 0),
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
    FOREIGN KEY (owner_driver_id)
        REFERENCES driver_profiles(staff_account_id)
        ON UPDATE RESTRICT
        ON DELETE CASCADE,
    FOREIGN KEY (vehicle_id)
        REFERENCES vehicles(id)
        ON UPDATE RESTRICT
        ON DELETE CASCADE
);

CREATE INDEX idx_document_resources_owner
ON document_resources (owner_driver_id, kind, status);

CREATE INDEX idx_document_resources_vehicle
ON document_resources (vehicle_id, kind, status);


CREATE TABLE driver_availability (
    driver_id TEXT PRIMARY KEY NOT NULL,
    active_vehicle_id TEXT DEFAULT NULL,
    state TEXT NOT NULL DEFAULT 'off_line'
        CHECK (state IN ('off_line','on_line')),
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
    updated_at INTEGER NOT NULL CHECK (updated_at > 0),
    FOREIGN KEY (driver_id)
        REFERENCES driver_profiles(staff_account_id)
        ON UPDATE RESTRICT
        ON DELETE CASCADE,
    FOREIGN KEY (active_vehicle_id, driver_id)
        REFERENCES vehicles(id, driver_id)
        ON UPDATE RESTRICT
        ON DELETE RESTRICT,
    CHECK (
        (state = 'off_line')
        OR
        (state = 'on_line' AND active_vehicle_id IS NOT NULL)
    )
);

CREATE INDEX idx_driver_availability_state
ON driver_availability (state, updated_at DESC);


CREATE TABLE staff_owner_binding (
    singleton INTEGER PRIMARY KEY NOT NULL
        CHECK (singleton = 1),
    account_id TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL CHECK (created_at > 0),
    FOREIGN KEY (account_id)
        REFERENCES staff_accounts(id)
        ON UPDATE RESTRICT
        ON DELETE RESTRICT
);


CREATE TABLE staff_permissions (
    account_id TEXT NOT NULL,
    permission TEXT NOT NULL
        CHECK (length(permission) BETWEEN 3 AND 100),
    granted_by TEXT NOT NULL,
    created_at INTEGER NOT NULL CHECK (created_at > 0),
    PRIMARY KEY (account_id, permission),
    FOREIGN KEY (account_id)
        REFERENCES staff_accounts(id)
        ON UPDATE RESTRICT
        ON DELETE CASCADE,
    FOREIGN KEY (granted_by)
        REFERENCES staff_accounts(id)
        ON UPDATE RESTRICT
        ON DELETE RESTRICT
);

CREATE INDEX idx_staff_permissions_permission
ON staff_permissions (permission, account_id);


CREATE TABLE order_assignments (
    id TEXT PRIMARY KEY NOT NULL,
    order_id TEXT NOT NULL,
    driver_id TEXT NOT NULL,
    vehicle_id TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'active'
        CHECK (state IN ('active','revoked','completed')),
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
    assigned_by TEXT NOT NULL,
    reason TEXT NOT NULL
        CHECK (length(reason) BETWEEN 1 AND 500),
    created_at INTEGER NOT NULL CHECK (created_at > 0),
    revoked_at INTEGER DEFAULT NULL
        CHECK (revoked_at IS NULL OR revoked_at >= created_at),
    UNIQUE (id, order_id, driver_id, vehicle_id),
    FOREIGN KEY (order_id)
        REFERENCES orders(id)
        ON UPDATE RESTRICT
        ON DELETE RESTRICT,
    FOREIGN KEY (driver_id)
        REFERENCES driver_profiles(staff_account_id)
        ON UPDATE RESTRICT
        ON DELETE RESTRICT,
    FOREIGN KEY (vehicle_id, driver_id)
        REFERENCES vehicles(id, driver_id)
        ON UPDATE RESTRICT
        ON DELETE RESTRICT,
    FOREIGN KEY (assigned_by)
        REFERENCES staff_accounts(id)
        ON UPDATE RESTRICT
        ON DELETE RESTRICT,
    CHECK (
        (state = 'active' AND revoked_at IS NULL)
        OR
        (state = 'completed' AND revoked_at IS NULL)
        OR
        (state = 'revoked' AND revoked_at IS NOT NULL)
    )
);

CREATE UNIQUE INDEX idx_order_assignments_current
ON order_assignments (order_id)
WHERE revoked_at IS NULL;

CREATE INDEX idx_order_assignments_driver_state
ON order_assignments (driver_id, state, created_at DESC);

CREATE INDEX idx_order_assignments_vehicle_state
ON order_assignments (vehicle_id, state, created_at DESC);


CREATE TABLE identity_verifications (
    id TEXT PRIMARY KEY NOT NULL,
    assignment_id TEXT NOT NULL,
    order_id TEXT NOT NULL,
    driver_id TEXT NOT NULL,
    vehicle_id TEXT NOT NULL,
    challenge_digest TEXT NOT NULL UNIQUE
        CHECK (length(challenge_digest) BETWEEN 32 AND 256),
    state TEXT NOT NULL DEFAULT 'pending'
        CHECK (state IN (
            'pending','verified','retry_required',
            'identity_mismatch','manual_review_required','expired'
        )),
    expires_at INTEGER NOT NULL CHECK (expires_at > 0),
    verified_at INTEGER DEFAULT NULL
        CHECK (verified_at IS NULL OR verified_at > 0),
    created_at INTEGER NOT NULL CHECK (created_at > 0),
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
    FOREIGN KEY (assignment_id, order_id, driver_id, vehicle_id)
        REFERENCES order_assignments(id, order_id, driver_id, vehicle_id)
        ON UPDATE RESTRICT
        ON DELETE CASCADE,
    CHECK (
        (state = 'verified' AND verified_at IS NOT NULL)
        OR
        (state != 'verified')
    )
);

CREATE INDEX idx_identity_verifications_assignment
ON identity_verifications (assignment_id, created_at DESC);

CREATE INDEX idx_identity_verifications_driver_state
ON identity_verifications (driver_id, state, created_at DESC);


CREATE TABLE vehicle_photo_checks (
    id TEXT PRIMARY KEY NOT NULL,
    vehicle_id TEXT NOT NULL,
    kind TEXT NOT NULL
        CHECK (kind IN ('monthly','complaint','manual')),
    reason TEXT NOT NULL
        CHECK (length(reason) BETWEEN 1 AND 500),
    due_at INTEGER NOT NULL CHECK (due_at > 0),
    grace_until INTEGER NOT NULL CHECK (grace_until >= due_at),
    result TEXT NOT NULL DEFAULT 'pending'
        CHECK (result IN ('pending','passed','failed','manual_review')),
    reviewed_by TEXT DEFAULT NULL,
    reviewed_at INTEGER DEFAULT NULL
        CHECK (reviewed_at IS NULL OR reviewed_at > 0),
    created_at INTEGER NOT NULL CHECK (created_at > 0),
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
    FOREIGN KEY (vehicle_id)
        REFERENCES vehicles(id)
        ON UPDATE RESTRICT
        ON DELETE CASCADE,
    FOREIGN KEY (reviewed_by)
        REFERENCES staff_accounts(id)
        ON UPDATE RESTRICT
        ON DELETE RESTRICT,
    CHECK (
        (reviewed_by IS NULL AND reviewed_at IS NULL)
        OR
        (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
    )
);

CREATE INDEX idx_vehicle_photo_checks_due
ON vehicle_photo_checks (vehicle_id, due_at DESC);

CREATE INDEX idx_vehicle_photo_checks_result
ON vehicle_photo_checks (result, due_at);


CREATE TABLE support_cases (
    id TEXT PRIMARY KEY NOT NULL,
    driver_id TEXT NOT NULL,
    order_id TEXT DEFAULT NULL,
    category TEXT NOT NULL
        CHECK (category IN (
            'passenger_no_show','delay','vehicle',
            'route','unable_to_complete','reassignment',
            'conflict','other'
        )),
    status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open','in_progress','resolved','closed')),
    created_at INTEGER NOT NULL CHECK (created_at > 0),
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
    resolved_by TEXT DEFAULT NULL,
    FOREIGN KEY (driver_id)
        REFERENCES driver_profiles(staff_account_id)
        ON UPDATE RESTRICT
        ON DELETE RESTRICT,
    FOREIGN KEY (order_id)
        REFERENCES orders(id)
        ON UPDATE RESTRICT
        ON DELETE RESTRICT,
    FOREIGN KEY (resolved_by)
        REFERENCES staff_accounts(id)
        ON UPDATE RESTRICT
        ON DELETE RESTRICT
);

CREATE INDEX idx_support_cases_driver_status
ON support_cases (driver_id, status, updated_at DESC);

CREATE INDEX idx_support_cases_order
ON support_cases (order_id, updated_at DESC);


CREATE TABLE chat_messages (
    id TEXT PRIMARY KEY NOT NULL,
    order_id TEXT DEFAULT NULL,
    support_case_id TEXT DEFAULT NULL,
    sender_kind TEXT NOT NULL
        CHECK (sender_kind IN ('driver','passenger','owner','dispatcher','system')),
    sender_account_id TEXT DEFAULT NULL,
    body TEXT NOT NULL
        CHECK (length(body) BETWEEN 1 AND 4000),
    created_at INTEGER NOT NULL CHECK (created_at > 0),
    expires_at INTEGER NOT NULL CHECK (expires_at > created_at),
    FOREIGN KEY (order_id)
        REFERENCES orders(id)
        ON UPDATE RESTRICT
        ON DELETE RESTRICT,
    FOREIGN KEY (support_case_id)
        REFERENCES support_cases(id)
        ON UPDATE RESTRICT
        ON DELETE CASCADE,
    FOREIGN KEY (sender_account_id)
        REFERENCES staff_accounts(id)
        ON UPDATE RESTRICT
        ON DELETE RESTRICT,
    CHECK (order_id IS NOT NULL OR support_case_id IS NOT NULL)
);

CREATE INDEX idx_chat_messages_order
ON chat_messages (order_id, created_at);

CREATE INDEX idx_chat_messages_support
ON chat_messages (support_case_id, created_at);

CREATE INDEX idx_chat_messages_expiry
ON chat_messages (expires_at);


CREATE TABLE calls (
    id TEXT PRIMARY KEY NOT NULL,
    order_id TEXT DEFAULT NULL,
    support_case_id TEXT DEFAULT NULL,
    caller_kind TEXT NOT NULL
        CHECK (caller_kind IN ('driver','passenger','owner','dispatcher')),
    callee_kind TEXT NOT NULL
        CHECK (callee_kind IN ('driver','passenger','owner','dispatcher')),
    started_at INTEGER NOT NULL CHECK (started_at > 0),
    ended_at INTEGER DEFAULT NULL
        CHECK (ended_at IS NULL OR ended_at >= started_at),
    recording_object_key TEXT DEFAULT NULL UNIQUE
        CHECK (
            recording_object_key IS NULL
            OR length(recording_object_key) BETWEEN 1 AND 500
        ),
    retention_until INTEGER DEFAULT NULL
        CHECK (retention_until IS NULL OR retention_until > 0),
    FOREIGN KEY (order_id)
        REFERENCES orders(id)
        ON UPDATE RESTRICT
        ON DELETE RESTRICT,
    FOREIGN KEY (support_case_id)
        REFERENCES support_cases(id)
        ON UPDATE RESTRICT
        ON DELETE CASCADE,
    CHECK (order_id IS NOT NULL OR support_case_id IS NOT NULL)
);

CREATE INDEX idx_calls_order
ON calls (order_id, started_at DESC);

CREATE INDEX idx_calls_support
ON calls (support_case_id, started_at DESC);


CREATE TABLE audit_events (
    id TEXT PRIMARY KEY NOT NULL,
    actor_account_id TEXT DEFAULT NULL,
    action TEXT NOT NULL
        CHECK (length(action) BETWEEN 3 AND 120),
    target_type TEXT NOT NULL
        CHECK (length(target_type) BETWEEN 1 AND 80),
    target_id TEXT NOT NULL
        CHECK (length(target_id) BETWEEN 1 AND 120),
    outcome TEXT NOT NULL
        CHECK (outcome IN ('success','denied','failed')),
    request_id TEXT DEFAULT NULL
        CHECK (request_id IS NULL OR length(request_id) BETWEEN 1 AND 120),
    created_at INTEGER NOT NULL CHECK (created_at > 0),
    FOREIGN KEY (actor_account_id)
        REFERENCES staff_accounts(id)
        ON UPDATE RESTRICT
        ON DELETE RESTRICT
);

CREATE INDEX idx_audit_events_actor
ON audit_events (actor_account_id, created_at DESC);

CREATE INDEX idx_audit_events_target
ON audit_events (target_type, target_id, created_at DESC);

CREATE INDEX idx_audit_events_created
ON audit_events (created_at DESC);
