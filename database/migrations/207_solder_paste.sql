-- Table: solder_paste_lots

CREATE TABLE IF NOT EXISTS solder_paste_lots (
    id bigserial PRIMARY KEY,
    lot_no VARCHAR(255) UNIQUE NOT NULL,
    material_code VARCHAR(10),
    material_name_zh VARCHAR(255),
    supplier VARCHAR(255),
    supplier_name VARCHAR(255),
    received_at timestamptz,
    shelf_life_days INT CHECK(shelf_life_days BETWEEN 90 AND 180),
    msd_level VARCHAR(10) CHECK(msd_level IN ('A', 'B', 'C')),
    qty_kg DECIMAL(10,3),
    qty_remaining_kg DECIMAL(10,3),
    status VARCHAR(50) CHECK(status IN ('frozen', 'opened', 'exhausted', 'expired', 'scrapped')),
    iqc_status VARCHAR(20) CHECK(iqc_status IN ('pending', 'passed', 'failed')),
    notes TEXT,
    created_by VARCHAR(100),
    created_at timestamptz DEFAULT NOW(),
    updated_at timestamptz
);

CREATE INDEX idx_lot_no ON solder_paste_lots (lot_no);

-- Table: solder_paste_openings

CREATE TABLE IF NOT EXISTS solder_paste_openings (
    id bigserial PRIMARY KEY,
    lot_id BIGINT REFERENCES solder_paste_lots(id) ON DELETE CASCADE,
    opened_at timestamptz DEFAULT NOW(),
    opened_by VARCHAR(100),
    opened_by_name VARCHAR(255),
    expires_at timestamptz CHECK(expires_at = opened_at + make_interval(hours => shelf_life_hours)),
    shelf_life_hours INT CHECK(shelf_life_hours BETWEEN 24 AND 48),
    status VARCHAR(50) CHECK(status IN ('active', 'closed', 'expired')),
    closed_at timestamptz,
    close_reason VARCHAR(100),
    consumption_kg DECIMAL(10,3),
    created_at timestamptz DEFAULT NOW(),
    updated_at timestamptz
);

CREATE INDEX idx_opening_lot_id ON solder_paste_openings (lot_id);

-- Table: solder_paste_consumption

CREATE TABLE IF NOT EXISTS solder_paste_consumption (
    id bigserial PRIMARY KEY,
    opening_id BIGINT REFERENCES solder_paste_openings(id) ON DELETE CASCADE,
    lot_id BIGINT REFERENCES solder_paste_lots(id) ON DELETE SET NULL,
    work_order_code VARCHAR(255),
    line_code VARCHAR(10),
    machine_code VARCHAR(10),
    consumed_at timestamptz DEFAULT NOW(),
    consumed_by VARCHAR(100),
    consumed_by_name VARCHAR(255),
    qty_kg DECIMAL(10,3),
    created_at timestamptz DEFAULT NOW()
);

CREATE INDEX idx_consumption_opening_id ON solder_paste_consumption (opening_id);