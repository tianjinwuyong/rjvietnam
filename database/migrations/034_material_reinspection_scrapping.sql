-- 034_material_reinspection_scrapping.sql
-- Sheets 3 & 5 from 仓库电子元器件寿命管参考:
--   Sheet3: 超期物料复检测试报告
--   Sheet5: 过期物料隔离报废申请单

-- ── Sheet3: 物料复检测试报告 (material_reinspection) ──────────────────────────
CREATE TABLE IF NOT EXISTS material_reinspection (
  id                  BIGSERIAL PRIMARY KEY,
  report_no           VARCHAR(50)  NOT NULL UNIQUE,  -- 报告编号 REP-YYYYMMDDNNN
  material_lot_id     BIGINT      NOT NULL REFERENCES material_lots(id),
  inspected_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  overdue_days        INTEGER     NOT NULL,          -- 超期天数
  sample_qty          INTEGER     NOT NULL,          -- 抽检数量
  test_items          TEXT        NOT NULL,          -- 复检项目
  test_standards      TEXT        NOT NULL,          -- 检验标准
  test_results        TEXT        NOT NULL,         -- 检验结果
  pass                BOOLEAN     NOT NULL,          -- 合格判定
  disposal_advice     TEXT        NOT NULL,          -- 处置意见
  inspector_id        BIGINT      REFERENCES hr_employees(id),
  quality_approved_by BIGINT      REFERENCES hr_employees(id),
  equipment_approved_by BIGINT    REFERENCES hr_employees(id),
  remarks             TEXT,
  created_by          BIGINT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE material_reinspection IS '超期物料复检测试报告 — Sheet3 from lifecycle Excel';
COMMENT ON COLUMN material_reinspection.report_no IS '报告编号 — e.g. REP-202510001';
COMMENT ON COLUMN material_reinspection.overdue_days IS '超期天数 — days past expiry';
COMMENT ON COLUMN material_reinspection.sample_qty IS '抽检数量 — quantity sampled for testing';
COMMENT ON COLUMN material_reinspection.test_items IS '复检项目 — test items (阻值/外观/可焊性 etc.)';
COMMENT ON COLUMN material_reinspection.test_standards IS '检验标准 — pass/fail criteria';
COMMENT ON COLUMN material_reinspection.test_results IS '检验结果 — actual results observed';
COMMENT ON COLUMN material_reinspection.pass IS '合格判定 — TRUE=合格, FALSE=不合格';
COMMENT ON COLUMN material_reinspection.disposal_advice IS '处置意见 — e.g. 继续使用/隔离报废';

CREATE INDEX IF NOT EXISTS idx_reinspection_lot ON material_reinspection(material_lot_id);
CREATE INDEX IF NOT EXISTS idx_reinspection_report_no ON material_reinspection(report_no);

-- ── Sheet5: 物料报废申请 (material_scrapping) ────────────────────────────────
CREATE TABLE IF NOT EXISTS material_scrapping (
  id              BIGSERIAL PRIMARY KEY,
  request_no      VARCHAR(50)  NOT NULL UNIQUE,  -- 申请单号 REQ-YYYYMMDDNNN
  department      VARCHAR(100) NOT NULL,         -- 申请部门
  material_lot_id BIGINT      NOT NULL REFERENCES material_lots(id),
  scrap_qty       NUMERIC(15,3) NOT NULL,       -- 报废数量
  unit            VARCHAR(20)  NOT NULL,        -- 单位
  overdue_days    INTEGER,                      -- 超期天数
  scrap_reason    TEXT        NOT NULL,         -- 报废原因
  isolation_status VARCHAR(50) NOT NULL,         -- 隔离状态 (已隔离/待隔离)
  disposal_method VARCHAR(50) NOT NULL,          -- 处置方式 (销毁/回收变卖/退供应商)
  applicant_id    BIGINT      REFERENCES hr_employees(id),
  warehouse_approved_by  BIGINT REFERENCES hr_employees(id),
  quality_approved_by     BIGINT REFERENCES hr_employees(id),
  status          VARCHAR(20) NOT NULL DEFAULT 'PENDING',  -- PENDING/APPROVED/REJECTED
  created_by      BIGINT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE material_scrapping IS '过期物料隔离报废申请单 — Sheet5 from lifecycle Excel';
COMMENT ON COLUMN material_scrapping.request_no IS '申请单号 — e.g. REQ-202510001';
COMMENT ON COLUMN material_scrapping.isolation_status IS '隔离状态 — 已隔离/待隔离';
COMMENT ON COLUMN material_scrapping.disposal_method IS '处置方式 — 销毁/回收变卖/退供应商';
COMMENT ON COLUMN material_scrapping.status IS '审批状态 — PENDING/APPROVED/REJECTED';

CREATE INDEX IF NOT EXISTS idx_scrapping_lot ON material_scrapping(material_lot_id);
CREATE INDEX IF NOT EXISTS idx_scrapping_request_no ON material_scrapping(request_no);
CREATE INDEX IF NOT EXISTS idx_scrapping_status ON material_scrapping(status);

-- ── Sheet4 helper: record opening event (updates material_lots.opened_at) ──
-- This is handled by PATCH /api/lifecycle/openings — no new table needed.
-- The existing material_lots.opened_at + opened_shelf_life_days columns are sufficient.
