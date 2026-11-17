-- Migration 058: Material Financial Events
-- All material-related financial events are reported here for finance manager review.
-- Types: COMPENSATION_REQUEST | COMPENSATION_APPROVED | COMPENSATION_DISPUTED |
--        DISPOSAL_RETURN_SUPPLIER | DISPOSAL_GARBAGE | DISPOSAL_SOLD |
--        MATERIAL_RETURN_PASS | MATERIAL_RETURN_NG | MATERIAL_RETURN_DAMAGED
-- Finance manager can query this table to see all financial impacts.

CREATE TABLE IF NOT EXISTS material_financial_events (
    id                   bigserial PRIMARY KEY,
    event_type           varchar(30)  NOT NULL,
    -- Context
    work_order_code      varchar(50),
    line_code            varchar(20),
    material_code        varchar(50),
    material_name_zh     varchar(100),
    lot_no               varchar(80),
    -- Quantities and money
    qty                  int,
    unit_cost_usd        numeric(12,4),
    total_cost_usd       numeric(12,2),
    sale_proceeds_usd    numeric(12,2),
    -- Loss / gain
    loss_amount_usd      numeric(12,2),
    -- Party involved
    supplier_code        varchar(50),
    supplier_name        varchar(100),
    buyer_code           varchar(50),
    buyer_name           varchar(100),
    -- Reason / description
    reason_code          varchar(30),
    reason_note          varchar(200),
    -- Reference IDs
    ref_id               bigint,         -- references compensation/disposal/return record
    ref_type             varchar(30),    -- COMPENSATION | DISPOSAL | RETURN
    -- Status
    status               varchar(20)     DEFAULT 'OPEN',  -- OPEN | ACKNOWLEDGED | RESOLVED
    -- Operator who triggered
    operator_name        varchar(100),
    occurred_at          timestamptz     NOT NULL DEFAULT now(),
    created_at           timestamptz     NOT NULL DEFAULT now()
);

COMMENT ON TABLE material_financial_events IS '物料财务事件汇总 — 所有物料相关财务事件上报给财务';
COMMENT ON COLUMN material_financial_events.event_type IS 'COMPENSATION_REQUEST | COMPENSATION_APPROVED | COMPENSATION_DISPUTED | DISPOSAL_RETURN_SUPPLIER | DISPOSAL_GARBAGE | DISPOSAL_SOLD | MATERIAL_RETURN_NG | MATERIAL_RETURN_DAMAGED';

CREATE INDEX IF NOT EXISTS idx_mfe_wo       ON material_financial_events(work_order_code);
CREATE INDEX IF NOT EXISTS idx_mfe_type     ON material_financial_events(event_type);
CREATE INDEX IF NOT EXISTS idx_mfe_status   ON material_financial_events(status);
CREATE INDEX IF NOT EXISTS idx_mfe_date     ON material_financial_events(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_mfe_supplier ON material_financial_events(supplier_code);

-- Record: admin (id=10) applied this migration
INSERT INTO _migrations (filename, hash) VALUES ('058_material_financial_events.sql', 'material-financial-events')
ON CONFLICT (filename) DO NOTHING;