-- ============================================================
-- Migration 068: Smart Rack Inventory Sync
-- Syncs smart rack operations to PostgreSQL inventory state
-- ============================================================

-- 1. Smart rack transaction log (audit trail for all rack movements)
CREATE TABLE IF NOT EXISTS smart_rack_transactions (
    id              BIGSERIAL PRIMARY KEY,
    label_id        VARCHAR(50) NOT NULL,
    shelf_code      VARCHAR(10) NOT NULL,
    cell_number     VARCHAR(10) NOT NULL,
    action          VARCHAR(20) NOT NULL,  -- SHELF_IN | SHELF_OUT | LIGHT_ON | REMOVE_LABEL
    material_code   VARCHAR(50),
    lot_no          VARCHAR(50),
    qty             NUMERIC,
    operator_id    BIGINT REFERENCES users(id),
    operator_name   VARCHAR(100),
    notes          TEXT,
    created_at     TIMESTAMPTZ DEFAULT NOW()
);
COMMENT ON TABLE smart_rack_transactions IS 'Audit trail for smart rack shelf-in/out/light operations';
CREATE INDEX IF NOT EXISTS idx_srt_label ON smart_rack_transactions(label_id);
CREATE INDEX IF NOT EXISTS idx_srt_shelf ON smart_rack_transactions(shelf_code);
CREATE INDEX IF NOT EXISTS idx_srt_action ON smart_rack_transactions(action);
CREATE INDEX IF NOT EXISTS idx_srt_created ON smart_rack_transactions(created_at DESC);

-- 2. material_lots: add index on label_id for fast lookup
CREATE INDEX IF NOT EXISTS idx_material_lots_label ON material_lots(label_id);

-- 3. Sync shelf_cells.material_lot_id from material_lots.label_id
-- For cells marked occupied in migration 005, find the matching material_lot by label
UPDATE shelf_cells sc
SET material_lot_id = (
    SELECT ml.id FROM material_lots ml
    WHERE ml.label_id = (sc.shelf_code || '-' || sc.cell_number)
    LIMIT 1
)
WHERE sc.cell_status = 'occupied';

-- 4. Also update shelf_cells cell_status based on whether material_lot_id is set
UPDATE shelf_cells
SET cell_status = CASE WHEN material_lot_id IS NOT NULL THEN 'occupied' ELSE 'empty' END;

-- 5. Add shelf_rack_id to shelf_cells (for multi-rack systems, rack = shelf_code)
-- This is informational; shelf_code already identifies the rack
COMMENT ON COLUMN shelf_cells.shelf_code IS 'Rack identifier e.g. L001A — maps to smart shelf controller';
