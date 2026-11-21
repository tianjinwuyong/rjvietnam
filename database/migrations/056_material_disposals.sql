-- Migration 056: Material Disposal Tracking
-- Tracks final disposal of NG/DAMAGED returned materials:
--   RETURN_TO_SUPPLIER | GARBAGE | SOLD
-- Links to feeder_loading_events record + material_lots

CREATE TABLE IF NOT EXISTS material_disposals (
    id                      bigserial PRIMARY KEY,
    -- Reference to the feeder loading event that triggered the return
    feeder_loading_event_id bigint REFERENCES feeder_loading_events(id),
    -- Reference to the material lot being disposed
    material_lot_id         bigint REFERENCES material_lots(id),
    work_order_code         varchar(50),
    lot_no                  varchar(80)  NOT NULL,
    material_code           varchar(50),
    -- Disposal channel
    disposal_channel        varchar(20)  NOT NULL,
    -- Channel-specific details
    supplier_code           varchar(50),           -- for RETURN_TO_SUPPLIER
    supplier_name           varchar(100),          -- for RETURN_TO_SUPPLIER
    scrap_weight_kg         numeric(10,3),         -- for GARBAGE (waste weight)
    buyer_code              varchar(50),           -- for SOLD
    buyer_name              varchar(100),          -- for SOLD
    sale_proceeds_usd       numeric(12,2),         -- for SOLD (revenue received)
    -- Disposal qty and cost
    disposal_qty            int          NOT NULL,
    unit_cost_usd           numeric(12,4),         -- original unit cost (for loss calc)
    loss_amount_usd         numeric(12,2),         -- computed: unit_cost * qty - sale_proceeds
    -- Disposal reason / notes
    reason                  varchar(200),
    operator_id             bigint,
    operator_name           varchar(100),
    disposed_at             timestamptz NOT NULL DEFAULT now(),
    created_at              timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE material_disposals IS 'NG/DAMAGED物料处置记录 — tracks RETURN_TO_SUPPLIER / GARBAGE / SOLD';
COMMENT ON COLUMN material_disposals.disposal_channel IS 'RETURN_TO_SUPPLIER | GARBAGE | SOLD';

CREATE INDEX IF NOT EXISTS idx_disposals_lot    ON material_disposals(lot_no);
CREATE INDEX IF NOT EXISTS idx_disposals_wo     ON material_disposals(work_order_code);
CREATE INDEX IF NOT EXISTS idx_disposals_evt    ON material_disposals(feeder_loading_event_id);
CREATE INDEX IF NOT EXISTS idx_disposals_ch     ON material_disposals(disposal_channel);

-- Record: admin (id=10) applied this migration
INSERT INTO _migrations (filename, hash) VALUES ('056_material_disposals.sql', 'material-disposals')
ON CONFLICT (filename) DO NOTHING;