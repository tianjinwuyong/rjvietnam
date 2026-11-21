-- Migration 064: Requisitions
-- 领料单：产线操作员发起物料申请 → PMC审批 → 仓库执行

CREATE SEQUENCE IF NOT EXISTS requisitions_seq;
CREATE SEQUENCE IF NOT EXISTS requisition_lines_seq;

CREATE TABLE IF NOT EXISTS requisitions (
    id                        bigserial PRIMARY KEY,
    doc_no                    varchar(25)  UNIQUE,
    doc_type                  varchar(30)  NOT NULL DEFAULT 'REQUISITION',
    status                    varchar(20)  NOT NULL DEFAULT 'DRAFT',
    work_order_code           varchar(50),
    work_order_id             bigint,
    line_code                 varchar(20),
    requestor_id              bigint,
    requestor_name            varchar(100),
    approver_id               bigint,
    approver_name             varchar(100),
    warehouse_operator_id      bigint,
    warehouse_operator_name    varchar(100),
    submitted_at              timestamptz,
    approved_at               timestamptz,
    approved_by               bigint,
    rejected_at               timestamptz,
    rejected_by              bigint,
    rejection_reason          varchar(200),
    executed_at               timestamptz,
    completed_at             timestamptz,
    cancelled_at              timestamptz,
    cancelled_by              bigint,
    notes                    varchar(500),
    created_by                bigint       NOT NULL,
    created_at                timestamptz  NOT NULL DEFAULT now(),
    updated_at                timestamptz
);

CREATE TABLE IF NOT EXISTS requisition_lines (
    id                        bigserial PRIMARY KEY,
    requisition_id            bigint       NOT NULL REFERENCES requisitions(id) ON DELETE CASCADE,
    material_id               bigint,
    material_code             varchar(50),
    material_name_zh          varchar(100),
    unit                      varchar(20),
    requested_qty             numeric(38,6),
    approved_qty              numeric(38,6),
    executed_qty             numeric(38,6),
    lot_no                    varchar(80),
    location_code             varchar(30),
    location_name             varchar(100),
    line_status               varchar(20)  NOT NULL DEFAULT 'DRAFT',
    remarks                   varchar(200),
    created_at                timestamptz  NOT NULL DEFAULT now()
);

COMMENT ON TABLE requisitions IS '领料单 — 产线操作员申请物料，PMC审批后仓库执行';
COMMENT ON COLUMN requisitions.status IS 'DRAFT | SUBMITTED | APPROVED | EXECUTING | COMPLETED | REJECTED | CANCELLED';
COMMENT ON TABLE requisition_lines IS '领料单明细行';

CREATE INDEX idx_req_doc_no      ON requisitions(doc_no);
CREATE INDEX idx_req_status     ON requisitions(status);
CREATE INDEX idx_req_wo         ON requisitions(work_order_code);
CREATE INDEX idx_req_created    ON requisitions(created_at DESC);
CREATE INDEX idx_rql_parent     ON requisition_lines(requisition_id);
CREATE INDEX idx_rql_material   ON requisition_lines(material_id);

ALTER TABLE requisitions      ADD CONSTRAINT chk_req_status
    CHECK (status IN ('DRAFT','SUBMITTED','APPROVED','EXECUTING','COMPLETED','REJECTED','CANCELLED')) NOT DEFERRABLE;
ALTER TABLE requisition_lines ADD CONSTRAINT chk_rql_status
    CHECK (line_status IN ('DRAFT','APPROVED','REJECTED')) NOT DEFERRABLE;

INSERT INTO requisitions (doc_no, work_order_code, line_code, status, requestor_name, created_by)
VALUES ('REQ-' || to_char(now(),'YYYYMMDD') || '-000001', 'WO-2026-001', 'LINE-01', 'DRAFT', 'Line Operator', 1)
ON CONFLICT (doc_no) DO NOTHING;

INSERT INTO _migrations (filename, hash) VALUES ('064_requisitions.sql', 'requisitions-v2')
ON CONFLICT (filename) DO NOTHING;
