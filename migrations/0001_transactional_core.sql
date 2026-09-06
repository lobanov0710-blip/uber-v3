-- =========================================
-- TRANSACTIONAL CORE
-- Migration: 0001
--
-- Project:
-- transfer-servis52.ru / uber-v3
--
-- Timestamps are stored as Unix
-- milliseconds to match JavaScript Date.now().
-- =========================================


-- =========================================
-- QUOTES
-- =========================================

CREATE TABLE quotes (

    id TEXT
        PRIMARY KEY
        NOT NULL,

    from_place TEXT
        NOT NULL
        CHECK (
            length(from_place)
            BETWEEN 1 AND 200
        ),

    to_place TEXT
        NOT NULL
        CHECK (
            length(to_place)
            BETWEEN 1 AND 200
        ),

    tariff TEXT
        NOT NULL
        CHECK (
            tariff IN (
                'comfort',
                'business',
                'minivan'
            )
        ),

    tariff_name TEXT
        NOT NULL
        CHECK (
            length(tariff_name)
            BETWEEN 1 AND 80
        ),

    distance_km REAL
        NOT NULL
        CHECK (
            distance_km > 0
        ),

    duration_minutes REAL
        NOT NULL
        CHECK (
            duration_minutes > 0
        ),

    price_rub INTEGER
        NOT NULL
        CHECK (
            price_rub > 0
        ),

    price_per_km REAL
        NOT NULL
        CHECK (
            price_per_km > 0
        ),

    coefficient REAL
        NOT NULL
        CHECK (
            coefficient > 0
        ),

    minimum_price_rub INTEGER
        NOT NULL
        CHECK (
            minimum_price_rub > 0
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

    consumed_at INTEGER
        DEFAULT NULL
        CHECK (
            consumed_at IS NULL
            OR consumed_at >= created_at
        )
);


-- =========================================
-- ORDERS
-- =========================================

CREATE TABLE orders (

    id TEXT
        PRIMARY KEY
        NOT NULL,

    -- NULL:
    -- manual order without calculator.
    --
    -- UNIQUE:
    -- one quote can produce at most
    -- one order.
    quote_id TEXT
        UNIQUE,

    name TEXT
        NOT NULL
        CHECK (
            length(name)
            BETWEEN 1 AND 100
        ),

    phone TEXT
        NOT NULL
        CHECK (
            length(phone)
            BETWEEN 10 AND 40
        ),

    route TEXT
        NOT NULL
        CHECK (
            length(route)
            BETWEEN 1 AND 300
        ),

    from_place TEXT
        CHECK (
            from_place IS NULL
            OR length(from_place)
               BETWEEN 1 AND 200
        ),

    to_place TEXT
        CHECK (
            to_place IS NULL
            OR length(to_place)
               BETWEEN 1 AND 200
        ),

    trip_date TEXT
        NOT NULL
        CHECK (
            trip_date GLOB
            '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
        ),

    comment TEXT
        NOT NULL
        DEFAULT ''
        CHECK (
            length(comment) <= 2000
        ),

    tariff TEXT
        DEFAULT NULL
        CHECK (
            tariff IS NULL
            OR tariff IN (
                'comfort',
                'business',
                'minivan'
            )
        ),

    distance_km REAL
        DEFAULT NULL
        CHECK (
            distance_km IS NULL
            OR distance_km > 0
        ),

    duration_minutes REAL
        DEFAULT NULL
        CHECK (
            duration_minutes IS NULL
            OR duration_minutes > 0
        ),

    price_rub INTEGER
        DEFAULT NULL
        CHECK (
            price_rub IS NULL
            OR price_rub > 0
        ),

    status TEXT
        NOT NULL
        DEFAULT 'new'
        CHECK (
            status IN (
                'new',
                'taken',
                'in_progress',
                'done',
                'canceled'
            )
        ),

    driver_id TEXT
        DEFAULT NULL,

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
        quote_id
    )
    REFERENCES quotes(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
);


-- =========================================
-- QUOTE INDEXES
-- =========================================

CREATE INDEX idx_quotes_expires_at
ON quotes (
    expires_at
);

CREATE INDEX idx_quotes_consumed_at
ON quotes (
    consumed_at
);


-- =========================================
-- ORDER INDEXES
-- =========================================

CREATE INDEX idx_orders_created_at
ON orders (
    created_at DESC
);

CREATE INDEX idx_orders_status_created_at
ON orders (
    status,
    created_at DESC
);

CREATE INDEX idx_orders_trip_date
ON orders (
    trip_date
);

CREATE INDEX idx_orders_driver_status
ON orders (
    driver_id,
    status,
    created_at DESC
);