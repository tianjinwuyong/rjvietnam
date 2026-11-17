-- Migration 201: QMS Phase 1 - Quality Management System Core Tables
-- QMS Grill: Q1-Q14 all C (Full-featured QMS)
-- Phase 1: IQC (done) + OQC + NG闭环 + 8D/CAPA + Quality Dashboard
-- Last migration: 200_station_event_idempotency.sql

BEGIN;

-- ── OQC Batch Inspections ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS qms_oqc_batches (
    id              BIGSERIAL PRIMARY KEY,
    batch_no        VARCHAR(50)  NOT NULL UNIQUE,
    shipment_no     VARCHAR(50),
    customer_code   VARCHAR(50),
    customer_name   VARCHAR(200),
    customer_po_no  VARCHAR(50),
    inspection_type VARCHAR(30)  NOT NULL,  -- FQC/FINAL/OUTGOING/SPI/AOI
    status          VARCHAR(20)  NOT NULL DEFAULT 'PENDING',  -- PENDING/INSPECTING/PASSED/FAILED/HOLD
    total_qty       INTEGER      NOT NULL DEFAULT 0,
    sample_size     INTEGER      NOT NULL DEFAULT 0,
    passed_qty      INTEGER      NOT NULL DEFAULT 0,
    failed_qty      INTEGER      NOT NULL DEFAULT 0,
    aql_level       VARCHAR(10),
    ac_reject       INTEGER      NOT NULL DEFAULT 0,
    re_pass         INTEGER      NOT NULL DEFAULT 0,
    inspector_id    BIGINT,
    inspector_name  VARCHAR(100),
    inspection_started_at TIMESTAMPTZ,
    inspection_completed_at TIMESTAMPTZ,
    remarks         TEXT,
    factory_id      VARCHAR(50)  NOT NULL DEFAULT 'VN_RUIJING',
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── OQC Inspection Items (per SN/unit) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS qms_oqc_items (
    id                  BIGSERIAL PRIMARY KEY,
    batch_id            BIGINT     NOT NULL REFERENCES qms_oqc_batches(id) ON DELETE CASCADE,
    sn                  VARCHAR(100),
    material_code       VARCHAR(50),
    material_name       VARCHAR(200),
    result              VARCHAR(20) NOT NULL,  -- PASS/FAIL/HOLD
    defect_code         VARCHAR(50),
    defect_desc         TEXT,
    severity            VARCHAR(20),  -- CRITICAL/MAJOR/MINOR
    location            VARCHAR(100),
    photo_url           TEXT,
    inspector_id        BIGINT,
    inspector_name      VARCHAR(100),
    inspection_time     TIMESTAMPTZ,
    measurements        JSONB,  -- {temp: 25.5, voltage: 3.3, ...}
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 8D / CAPA Reports ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS qms_8d_reports (
    id              BIGSERIAL PRIMARY KEY,
    capa_no         VARCHAR(50)  NOT NULL UNIQUE,
    related_ng_id   BIGINT,  -- FK to ng_defect_records or ng_reviews
    related_iqc_id  BIGINT,
    related_oqc_id  BIGINT,
    source_type     VARCHAR(30),  -- NG_REVIEW/IQC/OQC/COMPLAINT/AUDIT
    severity        VARCHAR(20)  NOT NULL,  -- CRITICAL/MAJOR/MINOR
    status          VARCHAR(20)  NOT NULL DEFAULT 'OPEN',  -- OPEN/IN_PROGRESS/CONTAINMENT/VERIFICATION/CLOSED
    problem_desc    TEXT        NOT NULL,
    d1_team         VARCHAR(200),
    d2_problem_desc TEXT,
    d3_containment  TEXT,
    d4_root_cause   TEXT,
    d5_corrective   TEXT,
    d6_implement    TEXT,
    d7_prevent      TEXT,
    d8_complete     TEXT,
    containment_by  VARCHAR(100),
    containment_at  TIMESTAMPTZ,
    root_cause_by   VARCHAR(100),
    root_cause_at   TIMESTAMPTZ,
    corrective_by   VARCHAR(100),
    corrective_at   TIMESTAMPTZ,
    verify_by       VARCHAR(100),
    verify_at       TIMESTAMPTZ,
    closed_by       VARCHAR(100),
    closed_at       TIMESTAMPTZ,
    effective_verification TEXT,  -- evidence that the corrective action worked
    factory_id      VARCHAR(50)  NOT NULL DEFAULT 'VN_RUIJING',
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── 8D D4 Root Cause Analysis Evidence ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS qms_8d_root_cause_evidence (
    id              BIGSERIAL PRIMARY KEY,
    capa_id         BIGINT     NOT NULL REFERENCES qms_8d_reports(id) ON DELETE CASCADE,
    evidence_type   VARCHAR(30),  -- FISHBONE/5WHY/DATA/EXPERIMENT/PHOTO
    title           VARCHAR(200),
    content         TEXT,
    file_url        TEXT,
    created_by      VARCHAR(100),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── NG Management Extended (links NG events to 8D) ─────────────────────────────
CREATE TABLE IF NOT EXISTS qms_ng_cases (
    id              BIGSERIAL PRIMARY KEY,
    case_no         VARCHAR(50)  NOT NULL UNIQUE,
    ng_defect_id    BIGINT,  -- FK to ng_defect_records
    line_code       VARCHAR(50),
    station_code    VARCHAR(50),
    sn              VARCHAR(100),
    work_order_code VARCHAR(50),
    error_code      VARCHAR(50),
    defect_code     VARCHAR(50),
    defect_desc     TEXT,
    qty             INTEGER      NOT NULL DEFAULT 1,
    status          VARCHAR(20)  NOT NULL DEFAULT 'OPEN',  -- OPEN/REPAIRING/REPAIRED/RETESTING/RETESTED/CLOSED/SCRAPPED
    repair_count    INTEGER      NOT NULL DEFAULT 0,
    max_repair      INTEGER      NOT NULL DEFAULT 2,
    repair_station  VARCHAR(50),
    repair_operator VARCHAR(100),
    repaired_at     TIMESTAMPTZ,
    retest_result   VARCHAR(20),  -- PASS/FAIL
    retested_at     TIMESTAMPTZ,
    scrap_reason    TEXT,
    scrap_approved_by VARCHAR(100),
    scrapped_at     TIMESTAMPTZ,
    capa_id         BIGINT,  -- FK to qms_8d_reports
    cost            DECIMAL(12,2) DEFAULT 0,
    factory_id      VARCHAR(50) NOT NULL DEFAULT 'VN_RUIJING',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Quality KPI Daily Snapshot ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS qms_quality_kpi_daily (
    id              BIGSERIAL PRIMARY KEY,
    snapshot_date   DATE        NOT NULL,
    factory_id      VARCHAR(50) NOT NULL DEFAULT 'VN_RUIJING',
    line_code       VARCHAR(50),
    product_code    VARCHAR(50),
    output_qty      INTEGER     NOT NULL DEFAULT 0,
    ng_qty          INTEGER     NOT NULL DEFAULT 0,
    rework_qty      INTEGER     NOT NULL DEFAULT 0,
    scrap_qty       INTEGER     NOT NULL DEFAULT 0,
    first_pass_rate DECIMAL(8,4),
    final_pass_rate DECIMAL(8,4),
    ng_rate         DECIMAL(8,4),
    iqc_lot_pass    INTEGER     NOT NULL DEFAULT 0,
    iqc_lot_fail    INTEGER     NOT NULL DEFAULT 0,
    oqc_batch_pass  INTEGER     NOT NULL DEFAULT 0,
    oqc_batch_fail  INTEGER     NOT NULL DEFAULT 0,
    customer_complaints INTEGER  NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(snapshot_date, factory_id, line_code, product_code)
);

-- ── Customer Quality Standards (per customer/product inspection rules) ───────────
CREATE TABLE IF NOT EXISTS qms_customer_standards (
    id              BIGSERIAL PRIMARY KEY,
    customer_code   VARCHAR(50) NOT NULL,
    customer_name   VARCHAR(200),
    product_code    VARCHAR(50),
    product_name    VARCHAR(200),
    inspection_type VARCHAR(30) NOT NULL,  -- VISUAL/FUNCTIONAL/DIMENSIONAL/PACKAGING
    standard_code   VARCHAR(50),
    aql_level       VARCHAR(10),
    sample_size     INTEGER,
    spec_doc_url    TEXT,
    checks_required JSONB,  -- [{check_item, method, acceptance_criteria, device}]
    status          VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    effective_from  DATE,
    effective_to    DATE,
    created_by      VARCHAR(100),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Seed: Default AQL levels ───────────────────────────────────────────────────
INSERT INTO qms_customer_standards (customer_code, customer_name, product_code, inspection_type, aql_level, sample_size, status, effective_from)
VALUES 
    ('DEFAULT', 'Default Standard', NULL, 'VISUAL', 'II', 50, 'ACTIVE', CURRENT_DATE),
    ('DEFAULT', 'Default Standard', NULL, 'FUNCTIONAL', 'I', 20, 'ACTIVE', CURRENT_DATE),
    ('DEFAULT', 'Default Standard', NULL, 'PACKAGING', 'III', 80, 'ACTIVE', CURRENT_DATE)
ON CONFLICT DO NOTHING;

-- ── Sequences ─────────────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS qms_8d_seq START 1;
CREATE SEQUENCE IF NOT EXISTS qms_ng_case_seq START 1;
CREATE SEQUENCE IF NOT EXISTS qms_oqc_batch_seq START 1;

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_qms_oqc_batches_status ON qms_oqc_batches(status);
CREATE INDEX IF NOT EXISTS idx_qms_oqc_batches_customer ON qms_oqc_batches(customer_code);
CREATE INDEX IF NOT EXISTS idx_qms_oqc_batches_created ON qms_oqc_batches(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_qms_oqc_items_batch ON qms_oqc_items(batch_id);
CREATE INDEX IF NOT EXISTS idx_qms_oqc_items_sn ON qms_oqc_items(sn);
CREATE INDEX IF NOT EXISTS idx_qms_8d_status ON qms_8d_reports(status);
CREATE INDEX IF NOT EXISTS idx_qms_8d_capa_no ON qms_8d_reports(capa_no);
CREATE INDEX IF NOT EXISTS idx_qms_ng_status ON qms_ng_cases(status);
CREATE INDEX IF NOT EXISTS idx_qms_ng_sn ON qms_ng_cases(sn);
CREATE INDEX IF NOT EXISTS idx_qms_quality_kpi_date ON qms_quality_kpi_daily(snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_qms_customer_standards_customer ON qms_customer_standards(customer_code);

COMMIT;

-- Migration record
INSERT INTO _migrations (filename, hash)
VALUES ('201_qms_phase1.sql', 'qms-phase1-v1')
ON CONFLICT (filename) DO NOTHING;
