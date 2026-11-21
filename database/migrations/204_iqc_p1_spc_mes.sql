-- Migration 204: IQC P1 — SPC测量数据 + MES/WMS联动增强
BEGIN;

-- 1. 检验项目明细（定量测量 → SPC数据源）
CREATE TABLE IF NOT EXISTS iqc_inspection_items (
  id                        BIGSERIAL PRIMARY KEY,
  inspection_id             BIGINT REFERENCES iqc_inspections(id) ON DELETE CASCADE,
  control_lot_id            BIGINT REFERENCES iqc_control_lots(id) ON DELETE SET NULL,
  item_sequence             INTEGER NOT NULL DEFAULT 1,
  inspection_item_code      VARCHAR(40) NOT NULL,
  inspection_item_name      VARCHAR(120) NOT NULL,
  inspection_category       VARCHAR(24) NOT NULL CHECK(inspection_category IN('appearance','dimension','functional','msd','package','weight','other')),
  standard_version          VARCHAR(40) NOT NULL DEFAULT 'v1.0',
  lower_spec_limit          NUMERIC(18,6),
  upper_spec_limit          NUMERIC(18,6),
  target_value              NUMERIC(18,6),
  measurement_unit          VARCHAR(20),
  measurement_device_code   VARCHAR(80),
  measurement_device_name   VARCHAR(120),
  device_calibration_valid  BOOLEAN NOT NULL DEFAULT TRUE,
  calibration_due_date      DATE,
  sample_size               INTEGER NOT NULL DEFAULT 1,
  sample_no                 VARCHAR(40),
  measured_value            NUMERIC(18,6),
  text_result               VARCHAR(24) CHECK(text_result IN('PASS','FAIL','N/A')),
  result                    VARCHAR(12) NOT NULL CHECK(result IN('PASS','FAIL')),
  inspector_id              VARCHAR(80) NOT NULL,
  inspector_name            VARCHAR(120),
  environment_temp          NUMERIC(5,2),
  environment_humidity      NUMERIC(5,2),
  remarks                   TEXT,
  measured_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. SPC数据点（每个测量项的连续读数 → 控制图）
CREATE TABLE IF NOT EXISTS iqc_spc_data (
  id                        BIGSERIAL PRIMARY KEY,
  control_lot_id            BIGINT REFERENCES iqc_control_lots(id) ON DELETE CASCADE,
  inspection_item_id        BIGINT REFERENCES iqc_inspection_items(id) ON DELETE SET NULL,
  material_code             VARCHAR(120) NOT NULL,
  supplier_code             VARCHAR(80),
  parameter_code            VARCHAR(40) NOT NULL,
  parameter_name            VARCHAR(120) NOT NULL,
  sample_subgroup_id        VARCHAR(40) NOT NULL,
  sample_subgroup_size      INTEGER NOT NULL DEFAULT 5,
  measurement_index         INTEGER NOT NULL,
  x_bar                     NUMERIC(18,6) NOT NULL,
  range_value               NUMERIC(18,6),
  std_dev                   NUMERIC(18,6),
  usl                       NUMERIC(18,6),
  ucl                       NUMERIC(18,6),
  lcl                       NUMERIC(18,6),
  center_line               NUMERIC(18,6),
  lsl                       NUMERIC(18,6),
  result                    VARCHAR(12) CHECK(result IN('IN_CONTROL','OUT_OF_CONTROL','WARNING')),
  control_chart_type        VARCHAR(16) NOT NULL CHECK(control_chart_type IN('XBAR_R','XBAR_S','I_MR','P','NP','C','U')),
  production_date           DATE NOT NULL,
  production_shift          VARCHAR(16),
  machine_code              VARCHAR(80),
  operator_id               VARCHAR(80),
  inspector_id              VARCHAR(80),
  recorded_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. SPC告警事件
CREATE TABLE IF NOT EXISTS iqc_spc_alerts (
  id                        BIGSERIAL PRIMARY KEY,
  spc_data_id              BIGINT REFERENCES iqc_spc_data(id) ON DELETE SET NULL,
  control_lot_id            BIGINT REFERENCES iqc_control_lots(id) ON DELETE SET NULL,
  material_code             VARCHAR(120),
  parameter_code            VARCHAR(40),
  alert_type                VARCHAR(24) NOT NULL CHECK(alert_type IN('OOC','OOS','TREND','RUN','PERIODICITY','STRATIFICATION')),
  severity                  VARCHAR(12) NOT NULL CHECK(severity IN('warning','critical')),
  rule_violated             VARCHAR(80),
  description               TEXT,
  notified_roles            VARCHAR(120)[] DEFAULT '{}',
  acknowledged              BOOLEAN NOT NULL DEFAULT FALSE,
  acknowledged_by          VARCHAR(80),
  acknowledged_at           TIMESTAMPTZ,
  resolved                  BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_by              VARCHAR(80),
  resolved_at              TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. MES工单锁定记录（IQC不合格时锁定MES工单）
CREATE TABLE IF NOT EXISTS iqc_mes_work_order_locks (
  id                        BIGSERIAL PRIMARY KEY,
  control_lot_id            BIGINT REFERENCES iqc_control_lots(id) ON DELETE SET NULL,
  incoming_record_id         BIGINT REFERENCES wms_incoming_records(id) ON DELETE SET NULL,
  work_order_code           VARCHAR(64) NOT NULL,
  material_code             VARCHAR(120) NOT NULL,
  material_lot_no           VARCHAR(120),
  lock_reason               VARCHAR(48) NOT NULL CHECK(lock_reason IN('iqc_hold','iqc_reject','msd_fail','expiry_fail','concession_pending','retest_pending')),
  lock_status               VARCHAR(16) NOT NULL DEFAULT 'locked' CHECK(lock_status IN('locked','partial_release','released','cancelled')),
  locked_by                 VARCHAR(80) NOT NULL,
  locked_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  released_by              VARCHAR(80),
  released_at              TIMESTAMPTZ,
  mes_notified              BOOLEAN NOT NULL DEFAULT FALSE,
  mes_notification_at       TIMESTAMPTZ,
  remarks                   TEXT
);

-- 5. 计量设备校准提醒
CREATE TABLE IF NOT EXISTS iqc_calibration_equipment (
  id                        BIGSERIAL PRIMARY KEY,
  equipment_code            VARCHAR(80) NOT NULL UNIQUE,
  equipment_name            VARCHAR(120) NOT NULL,
  equipment_type            VARCHAR(40) NOT NULL,
  calibration_cycle_days    INTEGER NOT NULL DEFAULT 365,
  last_calibration_date     DATE NOT NULL,
  next_calibration_date     DATE NOT NULL,
  calibration_cert_no       VARCHAR(80),
  calibration_status        VARCHAR(16) NOT NULL DEFAULT 'valid' CHECK(calibration_status IN('valid','due_soon','expired','calibrating')),
  calibration_lab           VARCHAR(120),
  accuracy_class            VARCHAR(20),
  measurement_range         VARCHAR(40),
  factory_id                BIGINT DEFAULT 1,
  active                    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. IQC批次-工单追溯（成品用到哪张IQC批次）
CREATE TABLE IF NOT EXISTS iqc_lot_work_order_trace (
  id                        BIGSERIAL PRIMARY KEY,
  control_lot_id            BIGINT REFERENCES iqc_control_lots(id) ON DELETE SET NULL,
  work_order_code           VARCHAR(64) NOT NULL,
  production_line           VARCHAR(40),
  material_code             VARCHAR(120) NOT NULL,
  material_lot_no           VARCHAR(120),
  quantity_used             NUMERIC(18,4) NOT NULL DEFAULT 0,
  usage_date                DATE NOT NULL,
  operator_id               VARCHAR(80),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(control_lot_id, work_order_code, material_lot_no)
);

-- 增强 iqc_inspections 表
ALTER TABLE iqc_inspections ADD COLUMN IF NOT EXISTS inspection_mode VARCHAR(16) DEFAULT 'NORMAL' CHECK(inspection_mode IN('EXEMPT','REDUCED','NORMAL','TIGHTENED','FULL'));
ALTER TABLE iqc_inspections ADD COLUMN IF NOT EXISTS inspection_types VARCHAR(40)[] DEFAULT '{}';
ALTER TABLE iqc_inspections ADD COLUMN IF NOT EXISTS measurement_summary JSONB DEFAULT '{}';
ALTER TABLE iqc_inspections ADD COLUMN IF NOT EXISTS spc_data_linked BOOLEAN DEFAULT FALSE;
ALTER TABLE iqc_inspections ADD COLUMN IF NOT EXISTS factory_id BIGINT DEFAULT 1;

-- 增强 iqc_control_lots 表（已有部分字段，补全缺失的）
ALTER TABLE iqc_control_lots ADD COLUMN IF NOT EXISTS work_order_code VARCHAR(64);
ALTER TABLE iqc_control_lots ADD COLUMN IF NOT EXISTS mes_notified BOOLEAN DEFAULT FALSE;
ALTER TABLE iqc_control_lots ADD COLUMN IF NOT EXISTS supplier_grade VARCHAR(8);
ALTER TABLE iqc_control_lots ADD COLUMN IF NOT EXISTS supplier_name VARCHAR(240);
ALTER TABLE iqc_control_lots ADD COLUMN IF NOT EXISTS material_name VARCHAR(240);

-- 索引
CREATE INDEX IF NOT EXISTS idx_insp_items_inspection ON iqc_inspection_items(inspection_id);
CREATE INDEX IF NOT EXISTS idx_insp_items_control_lot ON iqc_inspection_items(control_lot_id);
CREATE INDEX IF NOT EXISTS idx_spc_data_control_lot ON iqc_spc_data(control_lot_id);
CREATE INDEX IF NOT EXISTS idx_spc_data_material ON iqc_spc_data(material_code, production_date);
CREATE INDEX IF NOT EXISTS idx_spc_data_param ON iqc_spc_data(parameter_code);
CREATE INDEX IF NOT EXISTS idx_spc_alerts_lot ON iqc_spc_alerts(control_lot_id);
CREATE INDEX IF NOT EXISTS idx_spc_alerts_unack ON iqc_spc_alerts(acknowledged, created_at) WHERE acknowledged = FALSE;
CREATE INDEX IF NOT EXISTS idx_mes_locks_work_order ON iqc_mes_work_order_locks(work_order_code);
CREATE INDEX IF NOT EXISTS idx_mes_locks_status ON iqc_mes_work_order_locks(lock_status);
CREATE INDEX IF NOT EXISTS idx_cal_equipment_due ON iqc_calibration_equipment(next_calibration_date);
CREATE INDEX IF NOT EXISTS idx_cal_equipment_status ON iqc_calibration_equipment(calibration_status);
CREATE INDEX IF NOT EXISTS idx_lot_trace_work_order ON iqc_lot_work_order_trace(work_order_code);
CREATE INDEX IF NOT EXISTS idx_lot_trace_lot ON iqc_lot_work_order_trace(control_lot_id);

-- 触发器：自动更新 updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_iqc_inspection_items_updated
  BEFORE UPDATE ON iqc_inspection_items FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE OR REPLACE TRIGGER trg_iqc_spc_data_updated
  BEFORE UPDATE ON iqc_spc_data FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE OR REPLACE TRIGGER trg_iqc_spc_alerts_updated
  BEFORE UPDATE ON iqc_spc_alerts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE OR REPLACE TRIGGER trg_iqc_mes_locks_updated
  BEFORE UPDATE ON iqc_mes_work_order_locks FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE OR REPLACE TRIGGER trg_iqc_cal_equipment_updated
  BEFORE UPDATE ON iqc_calibration_equipment FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- IQC统计视图（Dashboard用）
CREATE OR REPLACE VIEW iqc_dashboard_stats AS
SELECT
  COUNT(DISTINCT ic.id) FILTER (WHERE ic.inspection_result = 'PASS') AS pass_count,
  COUNT(DISTINCT ic.id) FILTER (WHERE ic.inspection_result = 'FAIL') AS fail_count,
  COUNT(DISTINCT ic.id) FILTER (WHERE ic.inspection_result IS NULL) AS pending_count,
  COUNT(DISTINCT ic.id) AS total_count,
  COUNT(DISTINCT cl.id) FILTER (WHERE cl.status = 'HOLD' OR cl.status = 'REJECT') AS hold_count,
  ROUND(
    COUNT(DISTINCT ic.id) FILTER (WHERE ic.inspection_result = 'PASS')::NUMERIC /
    NULLIF(COUNT(DISTINCT ic.id) FILTER (WHERE ic.inspection_result IS NOT NULL), 0) * 100, 1
  ) AS pass_rate,
  ic.factory_id
FROM iqc_inspections ic
LEFT JOIN iqc_control_lots cl ON ic.lot_no = cl.inspection_lot_no
WHERE ic.factory_id = 1
GROUP BY ic.factory_id;

-- 供应商质量表现视图
CREATE OR REPLACE VIEW iqc_supplier_performance AS
SELECT
  ic.supplier_code,
  ic.supplier_name,
  COUNT(DISTINCT ic.id) AS total_inspections,
  COUNT(DISTINCT ic.id) FILTER (WHERE ic.inspection_result = 'PASS') AS pass_count,
  COUNT(DISTINCT ic.id) FILTER (WHERE ic.inspection_result = 'FAIL') AS fail_count,
  ROUND(
    COUNT(DISTINCT ic.id) FILTER (WHERE ic.inspection_result = 'PASS')::NUMERIC /
    NULLIF(COUNT(DISTINCT ic.id) FILTER (WHERE ic.inspection_result IS NOT NULL), 0) * 100, 1
  ) AS pass_rate,
  SUM(ic.major_defects) AS total_major_defects,
  SUM(ic.minor_defects) AS total_minor_defects,
  SUM(ic.critical_defects) AS total_critical_defects
FROM iqc_inspections ic
GROUP BY ic.supplier_code, ic.supplier_name
ORDER BY pass_rate ASC;

INSERT INTO _migrations(filename, hash)
VALUES('204_iqc_p1_spc_mes.sql','iqc-p1-spc-mes-v1')
ON CONFLICT(filename) DO NOTHING;
COMMIT;
