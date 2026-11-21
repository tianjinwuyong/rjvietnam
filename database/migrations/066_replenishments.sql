-- Migration 066: Replenishments
-- 补料单：物料短缺 → 操作员申请 → PMC审批 → 仓库执行出库

CREATE SEQUENCE IF NOT EXISTS replenishments_seq;
CREATE SEQUENCE IF NOT EXISTS replenishment_lines_seq;

CREATE TABLE IF NOT EXISTS replenishments (
    id                        bigserial PRIMARY KEY,
    doc_no                    varchar(25)  UNIQUE,
    doc_type                  varchar(30)  NOT NULL DEFAULT 'REPLENISHMENT',
    status                    varchar(20)  NOT NULL DEFAULT 'DRAFT',
    work_order_code           varchar(50),
    work_order_id             bigint,
    line_code                 varchar(20),
    requestor_id              bigint,
    requestor_name            varchar(100),
    -- PMC approver
    approver_id               bigint,
    approver_name             varchar(100),
    -- Warehouse operator who executes
    warehouse_operator_id      bigint,
    warehouse_operator_name    varchar(100),
    -- Timestamps
    submitted_at              timestamptz,
    approved_at               timestamptz,
    approved_by               bigint,
    rejected_at               timestamptz,
    rejected_by               bigint,
    rejection_reason          varchar(200),
    executed_at               timestamptz,
    completed_at              timestamptz,
    cancelled_at              timestamptz,
    cancelled_by              bigint,
    notes                     varchar(500),
    created_by                bigint       NOT NULL,
    created_at                timestamptz  NOT NULL DEFAULT now(),
    updated_at                timestamptz
);

CREATE TABLE IF NOT EXISTS replenishment_lines (
    id                        bigserial PRIMARY KEY,
    replenishment_id          bigint       NOT NULL REFERENCES replenishments(id) ON DELETE CASCADE,
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

COMMENT ON TABLE replenishments IS '补料单 — 物料短缺时申请，PMC审批后仓库执行出库';
COMMENT ON COLUMN replenishments.status IS 'DRAFT | SUBMITTED | APPROVED | EXECUTING | COMPLETED | REJECTED | CANCELLED';
COMMENT ON TABLE replenishment_lines IS '补料单明细行';

CREATE INDEX idx_rpl_doc_no      ON replenishments(doc_no);
CREATE INDEX idx_rpl_status     ON replenishments(status);
CREATE INDEX idx_rpl_wo         ON replenishments(work_order_code);
CREATE INDEX idx_rpl_created    ON replenishments(created_at DESC);
CREATE INDEX idx_rpll_parent    ON replenishment_lines(replenishment_id);
CREATE INDEX idx_rpll_material  ON replenishment_lines(material_id);

ALTER TABLE replenishments     ADD CONSTRAINT chk_rpl_status
    CHECK (status IN ('DRAFT','SUBMITTED','APPROVED','EXECUTING','COMPLETED','REJECTED','CANCELLED')) NOT DEFERRABLE;
ALTER TABLE replenishment_lines ADD CONSTRAINT chk_rpll_status
    CHECK (line_status IN ('DRAFT','APPROVED','REJECTED')) NOT DEFERRABLE;

INSERT INTO replenishments (doc_no, work_order_code, line_code, status, requestor_name, created_by)
VALUES ('RPL-' || to_char(now(),'YYYYMMDD') || '-000001', 'WO-2026-001', 'LINE-01', 'DRAFT', 'Line Operator', 1)
ON CONFLICT (doc_no) DO NOTHING;

INSERT INTO _migrations (filename, hash) VALUES ('066_replenishments.sql', 'replenishments-v2')
ON CONFLICT (filename) DO NOTHING;
