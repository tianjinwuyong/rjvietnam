-- Migration 063: Outbound Orders
-- 出库单/领料单：工单/需求 → 仓库备料 → 出库到产线

CREATE SEQUENCE IF NOT EXISTS outbound_orders_seq;
CREATE SEQUENCE IF NOT EXISTS outbound_order_lines_seq;

CREATE TABLE IF NOT EXISTS outbound_orders (
    id                        bigserial PRIMARY KEY,
    doc_no                    varchar(25)  UNIQUE,
    doc_type                  varchar(30)  NOT NULL DEFAULT 'OUTBOUND_ORDER',
    status                    varchar(20)  NOT NULL DEFAULT 'DRAFT',
    -- Reference
    work_order_code           varchar(50),
    work_order_id             bigint,
    -- Requester
    requestor_id              bigint,
    requestor_name            varchar(100),
    -- Warehouse operator
    warehouse_operator_id      bigint,
    warehouse_operator_name  varchar(100),
    -- Workflow timestamps
    submitted_at              timestamptz,
    approved_at               timestamptz,
    approved_by               bigint,
    rejected_at               timestamptz,
    rejected_by               bigint,
    rejection_reason          varchar(200),
    executed_at               timestamptz,
    completed_at             timestamptz,
    cancelled_at              timestamptz,
    cancelled_by              bigint,
    notes                     varchar(500),
    created_by                bigint       NOT NULL,
    created_at                timestamptz  NOT NULL DEFAULT now(),
    updated_at                timestamptz
);

CREATE TABLE IF NOT EXISTS outbound_order_lines (
    id                        bigserial PRIMARY KEY,
    outbound_order_id         bigint       NOT NULL REFERENCES outbound_orders(id) ON DELETE CASCADE,
    material_id               bigint,
    material_code             varchar(50),
    material_name_zh          varchar(100),
    unit                      varchar(20),
    requested_qty             numeric(38,6),
    approved_qty              numeric(38,6),
    executed_qty              numeric(38,6),
    lot_no                    varchar(80),
    location_code             varchar(30),
    location_name             varchar(100),
    line_status               varchar(20)  NOT NULL DEFAULT 'DRAFT',
    remarks                   varchar(200),
    created_at                timestamptz  NOT NULL DEFAULT now()
);

COMMENT ON TABLE outbound_orders IS '出库单/领料单 — 根据工单或需求创建，仓库执行出库';
COMMENT ON COLUMN outbound_orders.status IS 'DRAFT | SUBMITTED | APPROVED | EXECUTING | COMPLETED | REJECTED | CANCELLED';
COMMENT ON TABLE outbound_order_lines IS '出库单明细行';

CREATE INDEX idx_oo_doc_no       ON outbound_orders(doc_no);
CREATE INDEX idx_oo_status      ON outbound_orders(status);
CREATE INDEX idx_oo_wo          ON outbound_orders(work_order_code);
CREATE INDEX idx_oo_created     ON outbound_orders(created_at DESC);
CREATE INDEX idx_ool_parent     ON outbound_order_lines(outbound_order_id);
CREATE INDEX idx_ool_material   ON outbound_order_lines(material_id);

ALTER TABLE outbound_orders     ADD CONSTRAINT chk_oo_status
    CHECK (status IN ('DRAFT','SUBMITTED','APPROVED','EXECUTING','COMPLETED','REJECTED','CANCELLED')) NOT DEFERRABLE;
ALTER TABLE outbound_order_lines ADD CONSTRAINT chk_ool_status
    CHECK (line_status IN ('DRAFT','APPROVED','REJECTED')) NOT DEFERRABLE;

-- Sample
INSERT INTO outbound_orders (doc_no, work_order_code, status, requestor_name, warehouse_operator_id, warehouse_operator_name, created_by)
VALUES ('OUT-' || to_char(now(),'YYYYMMDD') || '-000001', 'WO-2026-001', 'DRAFT', 'Production Requestor', 1, 'Warehouse Op', 1)
ON CONFLICT (doc_no) DO NOTHING;

INSERT INTO _migrations (filename, hash) VALUES ('063_outbound_orders.sql', 'outbound-orders')
ON CONFLICT (filename) DO NOTHING;
