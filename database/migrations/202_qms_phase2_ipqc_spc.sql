-- Migration 202: QMS Phase 2 — IPQC + SPC
-- Grill Q6: IPQC完整过程质量控制 (SPI/AOI/FCT + 首件 + 巡检)
-- Grill Q7: SPC全SMT核心参数覆盖 (CPK/控制图/趋势预测)

BEGIN;

-- ── IPQC Inspections ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS qms_ipqc_inspections (
    id              BIGSERIAL PRIMARY KEY,
    inspection_no   VARCHAR(50)  NOT NULL UNIQUE,
    wo_code         VARCHAR(50),
    line_code       VARCHAR(50),
    station_code    VARCHAR(50),
    inspection_type VARCHAR(30)  NOT NULL,  -- FIRST_ARTICLE/PATROL/SPI/AOI/FCT/REFLOW
    status          VARCHAR(20)  NOT NULL DEFAULT 'PENDING',  -- PENDING/INSPECTING/PASSED/FAILED
    inspector_id    BIGINT,
    inspector_name  VARCHAR(100),
    scheduled_at    TIMESTAMPTZ,
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    result_summary  TEXT,
    factory_id      VARCHAR(50)  NOT NULL DEFAULT 'VN_RUIJING',
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── IPQC Inspection Items ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS qms_ipqc_items (
    id              BIGSERIAL PRIMARY KEY,
    inspection_id   BIGINT       NOT NULL REFERENCES qms_ipqc_inspections(id) ON DELETE CASCADE,
    item_code       VARCHAR(50),
    item_name       VARCHAR(200),
    category        VARCHAR(50),   -- APPEARANCE/DIMENSION/FUNCTION/SOLDER/PASTE
    standard_value  VARCHAR(100),
    actual_value    VARCHAR(100),
    upper_limit     NUMERIC(12,4),
    lower_limit     NUMERIC(12,4),
    measured_value  NUMERIC(12,4),
    result          VARCHAR(20) NOT NULL DEFAULT 'PENDING',  -- PASS/FAIL/NA
    defect_code     VARCHAR(50),
    remarks         TEXT,
    inspected_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── First Article Confirmation ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS qms_first_article (
    id              BIGSERIAL PRIMARY KEY,
    fa_no           VARCHAR(50)  NOT NULL UNIQUE,
    wo_code         VARCHAR(50)  NOT NULL,
    line_code       VARCHAR(50),
    product_code    VARCHAR(50),
    product_name    VARCHAR(200),
    status          VARCHAR(20)  NOT NULL DEFAULT 'PENDING',  -- PENDING/APPROVED/REJECTED
    checked_by      VARCHAR(100),
    approved_by     VARCHAR(100),
    check_items     JSONB DEFAULT '[]',
    photos          JSONB DEFAULT '[]',
    remarks         TEXT,
    checked_at      TIMESTAMPTZ,
    approved_at     TIMESTAMPTZ,
    factory_id      VARCHAR(50)  NOT NULL DEFAULT 'VN_RUIJING',
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── SPC Parameter Config ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS qms_spc_params (
    id              BIGSERIAL PRIMARY KEY,
    param_code      VARCHAR(50)  NOT NULL UNIQUE,
    param_name      VARCHAR(200) NOT NULL,
    param_name_en   VARCHAR(200),
    param_name_vi   VARCHAR(200),
    category        VARCHAR(50)  NOT NULL,  -- SPI/AOI/PLACEMENT/REFLOW/WAVE/FAI
    unit            VARCHAR(30),
    usl             NUMERIC(12,4),  -- Upper Spec Limit
    lsl             NUMERIC(12,4),  -- Lower Spec Limit
    target_value    NUMERIC(12,4),
    ucl             NUMERIC(12,4),  -- Upper Control Limit
    lcl             NUMERIC(12,4),  -- Lower Control Limit
    sample_size     INTEGER DEFAULT 5,
    station_code    VARCHAR(50),
    is_active       BOOLEAN DEFAULT TRUE,
    factory_id      VARCHAR(50)  NOT NULL DEFAULT 'VN_RUIJING',
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── SPC Readings ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS qms_spc_readings (
    id              BIGSERIAL PRIMARY KEY,
    param_id        BIGINT       NOT NULL REFERENCES qms_spc_params(id),
    wo_code         VARCHAR(50),
    line_code       VARCHAR(50),
    station_code    VARCHAR(50),
    lot_no          VARCHAR(50),
    measured_value  NUMERIC(12,4) NOT NULL,
    sample_group    INTEGER,
    is_ooc          BOOLEAN DEFAULT FALSE,  -- out of control
    rule_violated   VARCHAR(50),  -- which Western Electric rule
    recorded_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    recorded_by     VARCHAR(100),
    factory_id      VARCHAR(50)  NOT NULL DEFAULT 'VN_RUIJING'
);

CREATE INDEX IF NOT EXISTS idx_spc_readings_param ON qms_spc_readings(param_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_spc_readings_wo ON qms_spc_readings(wo_code);

-- ── SPC Alerts ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS qms_spc_alerts (
    id              BIGSERIAL PRIMARY KEY,
    param_id        BIGINT       NOT NULL REFERENCES qms_spc_params(id),
    reading_id      BIGINT REFERENCES qms_spc_readings(id),
    alert_type      VARCHAR(50)  NOT NULL,  -- OOC/TREND_7/SHIFT/RUN_8/CAPABILITY
    severity        VARCHAR(20)  NOT NULL DEFAULT 'WARNING',  -- INFO/WARNING/CRITICAL
    message         TEXT,
    cpk_value       NUMERIC(8,4),
    status          VARCHAR(20)  NOT NULL DEFAULT 'OPEN',  -- OPEN/ACKNOWLEDGED/RESOLVED
    acknowledged_by VARCHAR(100),
    resolved_at     TIMESTAMPTZ,
    factory_id      VARCHAR(50)  NOT NULL DEFAULT 'VN_RUIJING',
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── Seed SPC Parameters (SMT core) ───────────────────────────────────────────
INSERT INTO qms_spc_params (param_code, param_name, param_name_en, param_name_vi, category, unit, usl, lsl, target_value, ucl, lcl, sample_size, station_code) VALUES
  ('SPI_THICKNESS', '锡膏厚度', 'Solder Paste Thickness', 'Độ dày kem hàn', 'SPI', 'μm', 150, 100, 125, 145, 105, 5, 'SPI-01'),
  ('SPI_AREA', '锡膏面积比', 'Solder Paste Area Ratio', 'Tỷ lệ diện tích kem hàn', 'SPI', '%', 85, 50, 70, 82, 55, 5, 'SPI-01'),
  ('SPI_VOLUME', '锡膏体积', 'Solder Paste Volume', 'Thể tích kem hàn', 'SPI', '%', 80, 50, 65, 77, 53, 5, 'SPI-01'),
  ('AOI_DEFECT', 'AOI焊点不良率', 'AOI Joint Defect Rate', 'Tỷ lệ lỗi mối hàn AOI', 'AOI', 'PPM', 500, 0, 100, 400, 0, 10, 'AOI-01'),
  ('AOI_OFFSET', 'AOI偏移量', 'AOI Placement Offset', 'Độ lệch AOI', 'AOI', 'mm', 0.15, 0, 0.05, 0.12, 0, 10, 'AOI-01'),
  ('PLACE_X', '贴片X偏移', 'Placement X Offset', 'Lệch X dán', 'PLACEMENT', 'mm', 0.1, -0.1, 0, 0.08, -0.08, 5, 'NPM-01'),
  ('PLACE_Y', '贴片Y偏移', 'Placement Y Offset', 'Lệch Y dán', 'PLACEMENT', 'mm', 0.1, -0.1, 0, 0.08, -0.08, 5, 'NPM-01'),
  ('PLACE_ANGLE', '贴片角度偏移', 'Placement Angle Offset', 'Lệch góc dán', 'PLACEMENT', '°', 2, -2, 0, 1.5, -1.5, 5, 'NPM-01'),
  ('REFLOW_PEAK', '回流焊峰值温度', 'Reflow Peak Temperature', 'Nhiệt độ đỉnh reflow', 'REFLOW', '°C', 250, 235, 243, 248, 237, 3, 'REFLOW-01'),
  ('REFLOW_TIME', '回流焊液相时间', 'Reflow TAL', 'Thời gian TAL', 'REFLOW', 's', 90, 45, 65, 85, 50, 3, 'REFLOW-01'),
  ('WAVE_TEMP', '波峰焊温度', 'Wave Solder Temperature', 'Nhiệt độ hàn sóng', 'WAVE', '°C', 265, 250, 258, 263, 252, 3, 'WAVE-01'),
  ('FAI_DIM', '首件尺寸', 'First Article Dimension', 'Kích thước FAI', 'FAI', 'mm', NULL, NULL, NULL, NULL, NULL, 5, NULL)
ON CONFLICT (param_code) DO NOTHING;

-- ── Sequence for IPQC/FA numbering ───────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS qms_ipqc_seq START 1;
CREATE SEQUENCE IF NOT EXISTS qms_fa_seq START 1;

COMMIT;
