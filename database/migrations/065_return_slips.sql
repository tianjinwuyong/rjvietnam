-- Migration 065: Return Slips
-- 退库单：产线退料 → 仓库确认 → 库存回冲

CREATE SEQUENCE IF NOT EXISTS return_slips_seq;
CREATE SEQUENCE IF NOT EXISTS return_slip_lines_seq;

CREATE TABLE IF NOT EXISTS return_slips (
    id                        bigserial PRIMARY KEY,
    doc_no                    varchar(25)  UNIQUE,
    doc_type                  varchar(30)  NOT NULL DEFAULT 'RETURN_SLIP',
    status                    varchar(20)  NOT NULL DEFAULT 'DRAFT',
    work_order_code           varchar(50),
    work_order_id             bigint,
    line_code                 varchar(20),
    requestor_id              bigint,
    requestor_name            varchar(100),
    warehouse_operator_id      bigint,
    warehouse_operator_name   varchar(100),
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

CREATE TABLE IF NOT EXISTS return_slip_lines (
    id                        bigserial PRIMARY KEY,
    return_slip_id            bigint       NOT NULL REFERENCES return_slips(id) ON DELETE CASCADE,
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

COMMENT ON TABLE return_slips IS '退库单 — 产线退料，仓库确认后回冲库存';
COMMENT ON COLUMN return_slips.status IS 'DRAFT | SUBMITTED | EXECUTING | COMPLETED | REJECTED | CANCELLED';
COMMENT ON TABLE return_slip_lines IS '退库单明细行';

CREATE INDEX idx_rs_doc_no      ON return_slips(doc_no);
CREATE INDEX idx_rs_status     ON return_slips(status);
CREATE INDEX idx_rs_wo         ON return_slips(work_order_code);
CREATE INDEX idx_rs_created    ON return_slips(created_at DESC);
CREATE INDEX idx_rsl_parent     ON return_slip_lines(return_slip_id);
CREATE INDEX idx_rsl_material  ON return_slip_lines(material_id);

ALTER TABLE return_slips      ADD CONSTRAINT chk_rs_status
    CHECK (status IN ('DRAFT','SUBMITTED','EXECUTING','COMPLETED','REJECTED','CANCELLED')) NOT DEFERRABLE;
ALTER TABLE return_slip_lines ADD CONSTRAINT chk_rsl_status
    CHECK (line_status IN ('DRAFT','APPROVED','REJECTED')) NOT DEFERRABLE;

INSERT INTO return_slips (doc_no, work_order_code, line_code, status, requestor_name, created_by)
VALUES ('RS-' || to_char(now(),'YYYYMMDD') || '-000001', 'WO-2026-001', 'LINE-01', 'DRAFT', 'Line Operator', 1)
ON CONFLICT (doc_no) DO NOTHING;

INSERT INTO _migrations (filename, hash) VALUES ('065_return_slips.sql', 'return-slips-v2')
ON CONFLICT (filename) DO NOTHING;
