-- Migration: 072_aoi_station.sql
-- AOI Inspection Station tables for quality management
-- PostgreSQL

-- ── Drop existing objects if they exist (clean slate) ────────────────────────

DROP TABLE IF EXISTS aoi_inspection_records CASCADE;
DROP TABLE IF EXISTS aoi_defect_codes CASCADE;
DROP TABLE IF EXISTS aoi_stations CASCADE;

-- ── AOI Station Configuration ──────────────────────────────────────────────

CREATE TABLE aoi_stations (
  id BIGSERIAL PRIMARY KEY,
  station_code VARCHAR(50) NOT NULL,
  station_name VARCHAR(100) NOT NULL,
  name_zh VARCHAR(100) DEFAULT '',
  name_en VARCHAR(100) DEFAULT '',
  name_vi VARCHAR(100) DEFAULT '',
  line_code VARCHAR(50) NOT NULL,
  machine_code VARCHAR(50) NOT NULL,
  program_name VARCHAR(100) DEFAULT '',
  status VARCHAR(20) DEFAULT 'idle',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by VARCHAR(50) DEFAULT NULL
);

ALTER TABLE aoi_stations ADD CONSTRAINT aoi_stations_station_code_unique UNIQUE (station_code);

CREATE INDEX idx_aoi_stations_line_code ON aoi_stations(line_code);
CREATE INDEX idx_aoi_stations_status ON aoi_stations(status);

-- ── AOI Defect Codes Reference ───────────────────────────────────────────

CREATE TABLE aoi_defect_codes (
  id BIGSERIAL PRIMARY KEY,
  code VARCHAR(50) NOT NULL,
  name_zh VARCHAR(100) NOT NULL,
  name_en VARCHAR(100) NOT NULL,
  name_vi VARCHAR(100) NOT NULL,
  category VARCHAR(30) NOT NULL,
  description TEXT DEFAULT NULL,
  status VARCHAR(20) DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE aoi_defect_codes ADD CONSTRAINT aoi_defect_codes_code_unique UNIQUE (code);

CREATE INDEX idx_aoi_defect_codes_category ON aoi_defect_codes(category);
CREATE INDEX idx_aoi_defect_codes_status ON aoi_defect_codes(status);

-- ── AOI Inspection Records ───────────────────────────────────────────────────

CREATE TABLE aoi_inspection_records (
  id BIGSERIAL PRIMARY KEY,
  record_no VARCHAR(50) NOT NULL,
  pcb_serial VARCHAR(100) NOT NULL,
  work_order_code VARCHAR(50) NOT NULL,
  machine_code VARCHAR(50) NOT NULL,
  program_name VARCHAR(100) DEFAULT '',
  board_id VARCHAR(100) DEFAULT NULL,
  result VARCHAR(10) NOT NULL,
  defect_count INT DEFAULT 0,
  defect_codes TEXT DEFAULT NULL,
  defect_locations TEXT DEFAULT NULL,
  station_code VARCHAR(50) NOT NULL,
  line_code VARCHAR(50) NOT NULL,
  operator VARCHAR(50) DEFAULT NULL,
  inspected_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE aoi_inspection_records ADD CONSTRAINT aoi_inspection_records_record_no_unique UNIQUE (record_no);

CREATE INDEX idx_aoi_insp_pcb_serial ON aoi_inspection_records(pcb_serial);
CREATE INDEX idx_aoi_insp_work_order ON aoi_inspection_records(work_order_code);
CREATE INDEX idx_aoi_insp_result ON aoi_inspection_records(result);
CREATE INDEX idx_aoi_insp_station_code ON aoi_inspection_records(station_code);
CREATE INDEX idx_aoi_insp_inspected_at ON aoi_inspection_records(inspected_at);
CREATE INDEX idx_aoi_insp_line_code ON aoi_inspection_records(line_code);

-- ── Seed Default AOI Defect Codes ─────────────────────────────────────────

INSERT INTO aoi_defect_codes (code, name_zh, name_en, name_vi, category, description) VALUES
  ('AOI-OPEN',    '开路',     'Open Circuit',         'Mạch hở',        'solder',    'Open circuit defect detected by AOI'),
  ('AOI-SHORT',   '短路',     'Short Circuit',        'Chập mạch',      'solder',    'Short circuit defect detected by AOI'),
  ('SMT-MISSING', '缺件',     'Missing Component',     'Thiếu linh kiện','placement', 'Component missing from expected position'),
  ('SMT-OFFSET',  '偏移',     'Component Offset',      'Lệch vị trí',    'placement', 'Component placed at incorrect position'),
  ('SMT-REVERSE', '反向',     'Component Reversed',    'Lắp ngược',      'placement', 'Component placed in reverse orientation'),
  ('SMT-TOMBSTONE','立碑',    'Tombstone',            'Đứng mộ',        'placement', 'Component standing on end (tombstoning)'),
  ('COPPER-EXPOSE','铜箔露出', 'Copper Exposed',       'Lộ đồng',        'solder',    'Copper pad exposed due to insufficient solder'),
  ('SOLDER-BRIDGE','桥连',    'Solder Bridge',         'Cầu thiếc',      'solder',    'Solder bridge between adjacent pads'),
  ('SOLDER-INSUFF','少锡',    'Insufficient Solder',   'Thiếu thiếc',    'solder',    'Insufficient solder volume'),
  ('SOLDER-EXCESS','多锡',    'Excess Solder',          'Thừa thiếc',     'solder',    'Excess solder volume'),
  ('MARKING-DEFECT','标识不良','Marking Defect',        'Lỗi đánh dấu',  'visual',    'Component marking/label defect'),
  ('CRACK',       '裂纹',     'Crack',                  'Vết nứt',        'component', 'Cracked component body')
ON CONFLICT (code) DO UPDATE SET
  name_zh = EXCLUDED.name_zh,
  name_en = EXCLUDED.name_en,
  name_vi = EXCLUDED.name_vi,
  category = EXCLUDED.category;

-- ── Seed Default AOI Stations ─────────────────────────────────────────────────

INSERT INTO aoi_stations (station_code, station_name, name_zh, name_en, name_vi, line_code, machine_code, program_name, status) VALUES
  ('AOI-01', 'AOI自动光学检测站1', 'AOI自动光学检测站1', 'AOI Station 1', 'Trạm AOI 1', 'LINE-01', 'AOI-MACHINE-01', 'AURORA-V2', 'active'),
  ('AOI-02', 'AOI自动光学检测站2', 'AOI自动光学检测站2', 'AOI Station 2', 'Trạm AOI 2', 'LINE-02', 'AOI-MACHINE-02', 'AURORA-V2', 'active')
ON CONFLICT (station_code) DO UPDATE SET
  station_name = EXCLUDED.station_name,
  name_zh = EXCLUDED.name_zh,
  name_en = EXCLUDED.name_en,
  name_vi = EXCLUDED.name_vi,
  line_code = EXCLUDED.line_code,
  machine_code = EXCLUDED.machine_code,
  program_name = EXCLUDED.program_name;
