-- ============================================================
-- Simplified NG & SN Duplicate Audit (10-year retention)
-- Fields: occurred_at, line_name, station_code, sn, result,
--         defect_code, defect_desc, operator
-- No JSONB, no FK to large tables — lightweight audit log
-- ============================================================

-- 1. ng_defect_records — replace old partitioned table
DROP TABLE IF EXISTS ng_defect_records CASCADE;

CREATE TABLE ng_defect_records (
  id              bigserial,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  line_name       varchar(80)  NOT NULL,   -- 自动线 / 手动线
  station_code    varchar(40)  NOT NULL,   -- AOI-01, ICT-01, FCT-01 ...
  sn              varchar(120) NOT NULL,   -- PCB序列号
  result          varchar(20)  NOT NULL,   -- pass | fail | hold | rework | skip
  channel         varchar(40),             -- 测试通道/子板 (local station)
  error_code      varchar(40),             -- 故障代码 (local station)
  defect_code     varchar(40),             -- fail时填写，如 OPEN, SHORT, MISSING_COMP
  defect_desc     varchar(200),            -- fail时填写，简短描述
  file            varchar(200),            -- 来源Excel文件名 (local station)
  row             integer,                 -- Excel行号 (local station)
  time            varchar(40),             -- 本地时间 (local station)
  source          varchar(40),             -- 来源：scanner/excel/manual (local station)
  operator        varchar(80),             -- 操作员
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

-- 10-year partitions 2026-2035
DO $$
DECLARE
  p TEXT;
  yr TEXT;
BEGIN
  FOREACH yr IN ARRAY ARRAY['2026','2027','2028','2029','2030',
                             '2031','2032','2033','2034','2035']
  LOOP
    p := 'ng_defect_records_' || yr;
    IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = p) THEN
      EXECUTE format(
        'CREATE TABLE %I PARTITION OF ng_defect_records
         FOR VALUES FROM (%L) TO (%L)',
        p, yr || '-01-01', (yr::int + 1) || '-01-01'
      );
    END IF;
  END LOOP;
END $$;

CREATE INDEX idx_ng_sn         ON ng_defect_records(sn, occurred_at DESC);
CREATE INDEX idx_ng_line       ON ng_defect_records(line_name, occurred_at DESC);
CREATE INDEX idx_ng_station    ON ng_defect_records(station_code, occurred_at DESC);
CREATE INDEX idx_ng_result     ON ng_defect_records(result, occurred_at DESC);
CREATE INDEX idx_ng_error_code ON ng_defect_records(error_code, occurred_at DESC);
CREATE INDEX idx_ng_file       ON ng_defect_records(file, occurred_at DESC);
CREATE INDEX idx_ng_sn_result  ON ng_defect_records(sn, result, occurred_at DESC);

-- 2. sn_duplicate_attempts — replace old partitioned table
DROP TABLE IF EXISTS sn_duplicate_attempts CASCADE;

CREATE TABLE sn_duplicate_attempts (
  id              bigserial,
  attempted_at    timestamptz NOT NULL DEFAULT now(),
  line_name       varchar(80) NOT NULL,   -- 自动线 / 手动线
  station_code    varchar(40) NOT NULL,   -- PDA-01, AOI-01 ...
  sn              varchar(120) NOT NULL,  -- 重复扫描的SN
  action          varchar(40) NOT NULL,   -- scan_only | bind | issue_to_line | ship
  decision        varchar(20) NOT NULL,   -- blocked | allowed | overridden
  operator        varchar(80),            -- 操作员
  PRIMARY KEY (id, attempted_at)
) PARTITION BY RANGE (attempted_at);

DO $$
DECLARE
  p TEXT;
  yr TEXT;
BEGIN
  FOREACH yr IN ARRAY ARRAY['2026','2027','2028','2029','2030',
                             '2031','2032','2033','2034','2035']
  LOOP
    p := 'sn_dup_attempts_' || yr;
    IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = p) THEN
      EXECUTE format(
        'CREATE TABLE %I PARTITION OF sn_duplicate_attempts
         FOR VALUES FROM (%L) TO (%L)',
        p, yr || '-01-01', (yr::int + 1) || '-01-01'
      );
    END IF;
  END LOOP;
END $$;

CREATE INDEX idx_dup_sn       ON sn_duplicate_attempts(sn, attempted_at DESC);
CREATE INDEX idx_dup_line     ON sn_duplicate_attempts(line_name, attempted_at DESC);
CREATE INDEX idx_dup_station  ON sn_duplicate_attempts(station_code, attempted_at DESC);
CREATE INDEX idx_dup_decision ON sn_duplicate_attempts(decision, attempted_at DESC);