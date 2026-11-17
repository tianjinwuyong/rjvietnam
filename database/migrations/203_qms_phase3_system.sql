-- Migration 203: QMS Phase 3 — ISO文件 + 审核 + 客诉 + 供应商评价 + 质量成本
-- Grill Q10: ISO体系文件管理 (ISO9001/14001/IATF16949)
-- Grill Q11: 供应商质量评价 (月度评分+8D投诉+CO/CQ)
-- Grill Q12: 客户投诉管理 (PPM+8D关联+赔偿)
-- Grill Q13: 质量成本分析 (预防/鉴定/内部失败/外部失败)
-- Grill Q14: 审核管理 (内审/外审/客户审+NC跟踪)

BEGIN;

-- ── 8D reports (referenced by qms_complaints below; no earlier migration
--    creates it, so define it here before the FK resolves) ────────────────────
CREATE TABLE IF NOT EXISTS qms_eight_d (
    id              BIGSERIAL PRIMARY KEY,
    report_no       VARCHAR(50) NOT NULL UNIQUE,
    complaint_id    BIGINT,
    problem_desc    TEXT,
    root_cause      TEXT,
    corrective_action TEXT,
    preventive_action TEXT,
    status          VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── ISO Document Control ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS qms_documents (
    id              BIGSERIAL PRIMARY KEY,
    doc_no          VARCHAR(50)  NOT NULL UNIQUE,
    doc_title       VARCHAR(300) NOT NULL,
    doc_type        VARCHAR(50)  NOT NULL,  -- MANUAL/PROCEDURE/SOP/FORM/RECORD
    iso_standard    VARCHAR(50),  -- ISO9001/ISO14001/IATF16949
    department      VARCHAR(100),
    revision        VARCHAR(20)  NOT NULL DEFAULT 'A',
    status          VARCHAR(20)  NOT NULL DEFAULT 'DRAFT',  -- DRAFT/REVIEW/APPROVED/OBSOLETE
    effective_date  DATE,
    expiry_date     DATE,
    author          VARCHAR(100),
    approved_by     VARCHAR(100),
    file_path       VARCHAR(500),
    description     TEXT,
    factory_id      VARCHAR(50)  NOT NULL DEFAULT 'VN_RUIJING',
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS qms_doc_revisions (
    id              BIGSERIAL PRIMARY KEY,
    doc_id          BIGINT       NOT NULL REFERENCES qms_documents(id) ON DELETE CASCADE,
    revision        VARCHAR(20)  NOT NULL,
    change_desc     TEXT,
    changed_by      VARCHAR(100),
    file_path       VARCHAR(500),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── Audit Management ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS qms_audits (
    id              BIGSERIAL PRIMARY KEY,
    audit_no        VARCHAR(50)  NOT NULL UNIQUE,
    audit_type      VARCHAR(30)  NOT NULL,  -- INTERNAL/EXTERNAL/CUSTOMER/SUPPLIER
    iso_standard    VARCHAR(50),
    title           VARCHAR(300) NOT NULL,
    scope           TEXT,
    status          VARCHAR(20)  NOT NULL DEFAULT 'PLANNED',  -- PLANNED/IN_PROGRESS/COMPLETED/CLOSED
    lead_auditor    VARCHAR(100),
    audit_team      JSONB DEFAULT '[]',
    planned_date    DATE,
    actual_date     DATE,
    department      VARCHAR(100),
    findings_count  INTEGER DEFAULT 0,
    nc_count        INTEGER DEFAULT 0,
    conclusion      TEXT,
    report_path     VARCHAR(500),
    factory_id      VARCHAR(50)  NOT NULL DEFAULT 'VN_RUIJING',
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS qms_audit_nc (
    id              BIGSERIAL PRIMARY KEY,
    audit_id        BIGINT       NOT NULL REFERENCES qms_audits(id) ON DELETE CASCADE,
    nc_no           VARCHAR(50),
    severity        VARCHAR(20)  NOT NULL DEFAULT 'MINOR',  -- MAJOR/MINOR/OBSERVATION
    clause          VARCHAR(50),  -- ISO clause reference
    finding         TEXT         NOT NULL,
    root_cause      TEXT,
    corrective_action TEXT,
    due_date        DATE,
    status          VARCHAR(20)  NOT NULL DEFAULT 'OPEN',  -- OPEN/IN_PROGRESS/CLOSED/OVERDUE
    verified_by     VARCHAR(100),
    verified_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── Customer Complaints ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS qms_complaints (
    id              BIGSERIAL PRIMARY KEY,
    complaint_no    VARCHAR(50)  NOT NULL UNIQUE,
    customer_code   VARCHAR(50),
    customer_name   VARCHAR(200),
    complaint_date  DATE         NOT NULL DEFAULT CURRENT_DATE,
    product_code    VARCHAR(50),
    product_name    VARCHAR(200),
    batch_no        VARCHAR(50),
    sn_list         JSONB DEFAULT '[]',
    defect_desc     TEXT         NOT NULL,
    defect_qty      INTEGER DEFAULT 0,
    severity        VARCHAR(20)  NOT NULL DEFAULT 'MAJOR',  -- CRITICAL/MAJOR/MINOR
    status          VARCHAR(20)  NOT NULL DEFAULT 'OPEN',  -- OPEN/INVESTIGATING/8D_LINKED/RESOLVED/CLOSED
    eight_d_id      BIGINT REFERENCES qms_eight_d(id),
    ppm_value       NUMERIC(10,2),
    compensation_type VARCHAR(30),  -- CREDIT/RETURN/REPLACE/NONE
    compensation_amount NUMERIC(14,2),
    customer_level  VARCHAR(20) DEFAULT 'NORMAL',  -- VIP/NORMAL
    handler         VARCHAR(100),
    resolved_at     TIMESTAMPTZ,
    satisfaction_score INTEGER,  -- 1-5
    factory_id      VARCHAR(50)  NOT NULL DEFAULT 'VN_RUIJING',
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── Supplier Quality Evaluation ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS qms_supplier_eval (
    id              BIGSERIAL PRIMARY KEY,
    supplier_code   VARCHAR(50)  NOT NULL,
    supplier_name   VARCHAR(200),
    eval_period     VARCHAR(20)  NOT NULL,  -- 2026-07
    iqc_pass_rate   NUMERIC(6,3),
    oqc_reject_rate NUMERIC(6,3),
    delivery_rate   NUMERIC(6,3),
    complaint_count INTEGER DEFAULT 0,
    eight_d_count   INTEGER DEFAULT 0,
    total_score     NUMERIC(6,2),
    grade           VARCHAR(5),  -- A/B/C/D
    co_cq_status    VARCHAR(20) DEFAULT 'COMPLETE',  -- COMPLETE/PARTIAL/MISSING
    action_required TEXT,
    status          VARCHAR(20)  NOT NULL DEFAULT 'ACTIVE',  -- ACTIVE/PROBATION/BLOCKED
    factory_id      VARCHAR(50)  NOT NULL DEFAULT 'VN_RUIJING',
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE(supplier_code, eval_period)
);

-- ── Quality Cost ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS qms_quality_costs (
    id              BIGSERIAL PRIMARY KEY,
    cost_period     VARCHAR(20)  NOT NULL,  -- 2026-07
    cost_category   VARCHAR(30)  NOT NULL,  -- PREVENTION/APPRAISAL/INTERNAL_FAILURE/EXTERNAL_FAILURE
    cost_type       VARCHAR(100),  -- training/inspection/scrap/rework/warranty/complaint
    wo_code         VARCHAR(50),
    line_code       VARCHAR(50),
    department      VARCHAR(100),
    amount          NUMERIC(14,2) NOT NULL,
    currency        VARCHAR(10) DEFAULT 'USD',
    description     TEXT,
    source_type     VARCHAR(50),  -- NG/SCRAP/REWORK/COMPLAINT/AUDIT/TRAINING/INSPECTION
    source_id       BIGINT,
    factory_id      VARCHAR(50)  NOT NULL DEFAULT 'VN_RUIJING',
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qcost_period ON qms_quality_costs(cost_period, cost_category);

-- ── Sequences ─────────────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS qms_doc_seq START 1;
CREATE SEQUENCE IF NOT EXISTS qms_audit_seq START 1;
CREATE SEQUENCE IF NOT EXISTS qms_complaint_seq START 1;

COMMIT;
