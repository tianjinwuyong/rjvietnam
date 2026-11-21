-- ============================================================
-- Migration 005: WMS Smart Shelf Field Extensions
-- Adds fields for smart shelf integration and multi-location picking
-- ============================================================

-- 1. material_lots: add label_id (smart shelf barcode), reserved_qty, shelf_cell_id
ALTER TABLE material_lots ADD COLUMN IF NOT EXISTS label_id VARCHAR(50);
ALTER TABLE material_lots ADD COLUMN IF NOT EXISTS reserved_qty NUMERIC DEFAULT 0;
ALTER TABLE material_lots ADD COLUMN IF NOT EXISTS shelf_cell_id BIGINT REFERENCES storage_locations(id);

COMMENT ON COLUMN material_lots.label_id IS 'Smart shelf label barcode (e.g. TSN00001)';
COMMENT ON COLUMN material_lots.reserved_qty IS 'Qty reserved for open pick orders';
COMMENT ON COLUMN material_lots.shelf_cell_id IS 'Direct FK to shelf cell location';

-- 2. storage_locations: add shelf_code and cell_number for smart shelf grouping
ALTER TABLE storage_locations ADD COLUMN IF NOT EXISTS shelf_code VARCHAR(10);
ALTER TABLE storage_locations ADD COLUMN IF NOT EXISTS cell_number VARCHAR(10);

COMMENT ON COLUMN storage_locations.shelf_code IS 'Shelf group code e.g. L001A (first 5 chars of smart shelf code)';
COMMENT ON COLUMN storage_locations.cell_number IS 'Cell number within shelf e.g. 01';

-- 3. shelf_cells: tracks real-time occupancy of smart shelf cells
--    This mirrors what the smart shelf hardware also tracks internally
CREATE TABLE IF NOT EXISTS shelf_cells (
    id              BIGSERIAL PRIMARY KEY,
    shelf_code      VARCHAR(10) NOT NULL,
    cell_number     VARCHAR(10) NOT NULL,
    storage_location_id BIGINT REFERENCES storage_locations(id),
    material_lot_id BIGINT REFERENCES material_lots(id),
    cell_status     VARCHAR(20) NOT NULL DEFAULT 'empty',
    last_light_cmd  INTEGER DEFAULT 0,
    last_light_at   TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(shelf_code, cell_number)
);
COMMENT ON TABLE shelf_cells IS 'Smart shelf cell status (mirrors hardware state)';

CREATE INDEX IF NOT EXISTS idx_shelf_cells_shelf_code ON shelf_cells(shelf_code);
CREATE INDEX IF NOT EXISTS idx_shelf_cells_status ON shelf_cells(cell_status);

-- 4. pick_order_lines: add source_location tracking for multi-location picking
ALTER TABLE pick_order_lines ADD COLUMN IF NOT EXISTS source_location_id BIGINT REFERENCES storage_locations(id);
ALTER TABLE pick_order_lines ADD COLUMN IF NOT EXISTS lot_no VARCHAR(50);

COMMENT ON COLUMN pick_order_lines.source_location_id IS 'Actual cell/location picked from';
COMMENT ON COLUMN pick_order_lines.lot_no IS 'Actual lot number picked (may differ from reserved)';

-- 5. pick_orders: add pick_type for batch picking support
ALTER TABLE pick_orders ADD COLUMN IF NOT EXISTS pick_type VARCHAR(20) DEFAULT 'SINGLE';
COMMENT ON COLUMN pick_orders.pick_type IS 'SINGLE=one material, BATCH=multi-material';

-- 6. iqc_decisions: formal IQC disposition records
CREATE TABLE IF NOT EXISTS iqc_decisions (
    id                  BIGSERIAL PRIMARY KEY,
    material_lot_id     BIGINT NOT NULL REFERENCES material_lots(id),
    iqc_inspection_id   BIGINT REFERENCES iqc_inspections(id),
    decision            VARCHAR(20) NOT NULL,
    reason_code         VARCHAR(50),
    reason_zh           VARCHAR(200),
    released_by         BIGINT REFERENCES users(id),
    released_at         TIMESTAMPTZ DEFAULT NOW(),
    expiry_date         DATE,
    notes               TEXT,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);
COMMENT ON TABLE iqc_decisions IS 'IQC disposition: hold/release/reject with authorization';

CREATE INDEX IF NOT EXISTS idx_iqc_decisions_lot ON iqc_decisions(material_lot_id);
CREATE INDEX IF NOT EXISTS idx_iqc_decisions_decision ON iqc_decisions(decision);

-- 7. material_lot_reservations: reserve qty for work orders before physical pick
CREATE TABLE IF NOT EXISTS material_lot_reservations (
    id                  BIGSERIAL PRIMARY KEY,
    material_lot_id      BIGINT NOT NULL REFERENCES material_lots(id),
    work_order_id       BIGINT REFERENCES work_orders(id),
    reserved_qty        NUMERIC NOT NULL,
    status               VARCHAR(20) NOT NULL DEFAULT 'active',
    reserved_by          BIGINT REFERENCES users(id),
    reserved_at          TIMESTAMPTZ DEFAULT NOW(),
    fulfilled_at         TIMESTAMPTZ,
    expires_at          TIMESTAMPTZ,
    created_at           TIMESTAMPTZ DEFAULT NOW()
);
COMMENT ON TABLE material_lot_reservations IS 'Soft reservation of material lot qty for work orders';

CREATE INDEX IF NOT EXISTS idx_mlr_lot ON material_lot_reservations(material_lot_id);
CREATE INDEX IF NOT EXISTS idx_mlr_wo ON material_lot_reservations(work_order_id);
CREATE INDEX IF NOT EXISTS idx_mlr_status ON material_lot_reservations(status);

-- 8. Sync existing storage_locations shelf_code and cell_number from code
UPDATE storage_locations
SET shelf_code = LEFT(code, 5),
    cell_number = RIGHT(code, 2)
WHERE code LIKE 'L___A-%' OR code LIKE 'L___B-%' OR code LIKE 'L___C-%' OR code LIKE 'L___D-%'
   OR code LIKE 'RAW-%' OR code LIKE 'IQC-%' OR code LIKE 'HOLD-%';

-- 9. Create shelf_cells for all shelf-type storage locations
INSERT INTO shelf_cells (shelf_code, cell_number, storage_location_id, cell_status)
SELECT LEFT(sl.code, 5), RIGHT(sl.code, 2), sl.id,
       CASE WHEN ml.id IS NOT NULL THEN 'occupied' ELSE 'empty' END
FROM storage_locations sl
LEFT JOIN material_lots ml ON ml.storage_location_id = sl.id
WHERE sl.location_type = 'shelf_cell'
ON CONFLICT (shelf_code, cell_number) DO NOTHING;

-- 10. Add check constraints if not exists
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'material_lots_reserved_qty_check') THEN
        ALTER TABLE material_lots ADD CONSTRAINT material_lots_reserved_qty_check CHECK (reserved_qty >= 0);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shelf_cells_status_check') THEN
        ALTER TABLE shelf_cells ADD CONSTRAINT shelf_cells_status_check CHECK (cell_status IN ('empty','occupied','reserved','fault'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'iqc_decisions_decision_check') THEN
        ALTER TABLE iqc_decisions ADD CONSTRAINT iqc_decisions_decision_check CHECK (decision IN ('released','hold','rejected','special_accept'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pick_orders_pick_type_check') THEN
        ALTER TABLE pick_orders ADD CONSTRAINT pick_orders_pick_type_check CHECK (pick_type IN ('SINGLE','BATCH'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'material_lot_reservations_status_check') THEN
        ALTER TABLE material_lot_reservations ADD CONSTRAINT material_lot_reservations_status_check CHECK (status IN ('active','fulfilled','cancelled','expired'));
    END IF;
END $$;