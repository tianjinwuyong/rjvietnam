-- Migration: 003_factory_sim_schema
-- MES simulation tables: mes_runs, stagnation_log, scrap_records, downtime_records
-- These tables support the MES AI Manager query scripts (mes-query.js)

BEGIN;

-- ── MES Runs (work order execution on a line) ──────────────────────────
CREATE TABLE IF NOT EXISTS mes_runs (
  id              BIGSERIAL PRIMARY KEY,
  work_order_code CHAR(11) NOT NULL REFERENCES work_orders(code),
  line_id         BIGINT NOT NULL REFERENCES production_lines(id),
  status          VARCHAR(20) NOT NULL DEFAULT 'idle'
                   CHECK (status IN ('idle','running','paused','completed','closed')),
  planned_qty     INTEGER NOT NULL DEFAULT 0,
  completed_qty   INTEGER NOT NULL DEFAULT 0,
  started_at      TIMESTAMPTZ,
  finished_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mes_runs_wo   ON mes_runs(work_order_code);
CREATE INDEX IF NOT EXISTS idx_mes_runs_line  ON mes_runs(line_id);
CREATE INDEX IF NOT EXISTS idx_mes_runs_status ON mes_runs(status);

-- ── Stagnation Log (PCBs stuck at a station) ─────────────────────────────
CREATE TABLE IF NOT EXISTS stagnation_log (
  id                  BIGSERIAL PRIMARY KEY,
  sn                  VARCHAR(80),
  pcb_no              VARCHAR(80),
  station_code        VARCHAR(50) NOT NULL,
  line_code           VARCHAR(40) NOT NULL,
  stagnation_minutes  INTEGER NOT NULL DEFAULT 0,
  stagnation_level    VARCHAR(20) DEFAULT 'normal'
                       CHECK (stagnation_level IN ('normal','yellow','orange','red','critical')),
  status              VARCHAR(20) DEFAULT 'open'
                       CHECK (status IN ('open','investigating','resolved')),
  work_order_code     CHAR(11),
  product_model       VARCHAR(120),
  po_number           VARCHAR(80),
  customer_code       VARCHAR(60),
  wh_location         VARCHAR(50),
  overdue_months      NUMERIC(5,1),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at         TIMESTAMPTZ,
  notes              TEXT
);

CREATE INDEX IF NOT EXISTS idx_stagnation_status ON stagnation_log(status);
CREATE INDEX IF NOT EXISTS idx_stagnation_line   ON stagnation_log(line_code);
CREATE INDEX IF NOT EXISTS idx_stagnation_created ON stagnation_log(created_at);

-- ── Scrap Records ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scrap_records (
  id                BIGSERIAL PRIMARY KEY,
  sn                VARCHAR(80),
  pcb_no            VARCHAR(80),
  product_model     VARCHAR(120),
  scrap_station     VARCHAR(50) NOT NULL,
  line_code         VARCHAR(40) NOT NULL,
  scrap_reason_code VARCHAR(80),
  scrap_reason_detail TEXT,
  responsible_person VARCHAR(120),
  quantity          INTEGER NOT NULL DEFAULT 1,
  status            VARCHAR(20) DEFAULT 'pending'
                     CHECK (status IN ('pending','approved','rejected','scrapped')),
  po_number         VARCHAR(80),
  work_order_code   CHAR(11),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at       TIMESTAMPTZ,
  notes             TEXT
);

CREATE INDEX IF NOT EXISTS idx_scrap_status    ON scrap_records(status);
CREATE INDEX IF NOT EXISTS idx_scrap_line      ON scrap_records(line_code);
CREATE INDEX IF NOT EXISTS idx_scrap_wo       ON scrap_records(work_order_code);

-- ── Downtime Records ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS downtime_records (
  id              BIGSERIAL PRIMARY KEY,
  downtime_no    VARCHAR(80) NOT NULL UNIQUE,
  line_code       VARCHAR(40) NOT NULL,
  station_code    VARCHAR(50),
  reason_code     VARCHAR(80),
  reason_detail   TEXT,
  start_at       TIMESTAMPTZ NOT NULL,
  end_at         TIMESTAMPTZ,
  duration_min    INTEGER,
  status         VARCHAR(20) DEFAULT 'open'
                  CHECK (status IN ('open','flagged','escalated','closed')),
  operator       VARCHAR(120),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_downtime_status   ON downtime_records(status);
CREATE INDEX IF NOT EXISTS idx_downtime_line     ON downtime_records(line_code);
CREATE INDEX IF NOT EXISTS idx_downtime_start   ON downtime_records(start_at);

-- ── Sample Views (convenience for agents) ─────────────────────────────────

CREATE OR REPLACE VIEW v_mes_runs_summary AS
SELECT
  mr.line_id,
  pl.internal_code AS line_code,
  COUNT(*) FILTER (WHERE mr.status = 'running') AS running,
  COUNT(*) FILTER (WHERE mr.status = 'idle')    AS idle,
  COUNT(*) FILTER (WHERE mr.status = 'completed') AS completed,
  SUM(mr.completed_qty) AS total_output
FROM mes_runs mr
JOIN production_lines pl ON pl.id = mr.line_id
GROUP BY mr.line_id, pl.internal_code;

-- ── Seed: create sample stagnation reason codes ────────────────────────────
INSERT INTO defect_codes (code, name_zh, name_en, name_vi, severity) VALUES
  ('STAG-001', '物料短缺停机',    'Material shortage',       'Hết nguyên liệu',       'major'),
  ('STAG-002', '设备故障',        'Equipment failure',       'Hỏng thiết bị',         'critical'),
  ('STAG-003', '操作员缺勤',      'Operator absent',          'Nhân viên nghỉ',         'major'),
  ('SCRAP-001', '焊锡不良',       'Solder defect',            'Hàn kém',              'major'),
  ('SCRAP-002', '元件偏移',       'Component shift',          'Linhh kiện lệch',      'minor'),
  ('SCRAP-003', '元件缺失',       'Missing component',       'Thiếu linh kiện',      'critical'),
  ('SCRAP-004', 'PCB损坏',        'PCB damage',              'PCB hỏng',             'critical'),
  ('DT-001',   '换线调试',        'Changeover setup',        'Đổi mặt hàng',        'minor'),
  ('DT-002',   '预防性维护',      'Preventive maintenance',  'Bảo trì dự phòng',     'minor'),
  ('DT-003',   '物料短缺',        'Material shortage',       'Hết nguyên liệu',      'major'),
  ('DT-004',   '设备故障',        'Equipment failure',       'Hỏng thiết bị',        'critical')
ON CONFLICT (code) DO NOTHING;

COMMIT;
