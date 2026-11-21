-- ============================================================
-- Station sequence order per production line
-- Used for downstream NG checking: reject PCB if any upstream
-- station in the same line (or parent line) has an NG record.
-- parent_line_code models cross-line NG inheritance:
--   packaging line stations look up AUTO-LINE NG as upstream.
-- ============================================================

DROP TABLE IF EXISTS station_sequences CASCADE;

CREATE TABLE station_sequences (
  id               bigserial PRIMARY KEY,
  line_code        varchar(40)  NOT NULL,    -- SMT-LINE / AUTO-LINE / MANUAL-LINE / PACK-LINE
  station_code     varchar(40)  NOT NULL,    -- e.g. LASER-01, AOI-01, ICT-01
  sequence_order   smallint     NOT NULL,    -- 1 = first station in this line, higher = downstream
  station_name_zh  varchar(100),
  parent_line_code varchar(40),              -- upstream line to also check NG for (null = no parent)
  UNIQUE (line_code, station_code)
);

-- Index for fast upstream lookup
CREATE INDEX idx_seq_line      ON station_sequences(line_code, sequence_order ASC);
CREATE INDEX idx_seq_station   ON station_sequences(station_code);
CREATE INDEX idx_seq_parent    ON station_sequences(parent_line_code);

-- Insert SMT line stations (顺序: 镭雕机 → ai插件机 → 印刷机 → spi → 贴片机 → smt-aoi → pd扫码)
INSERT INTO station_sequences (line_code, station_code, sequence_order, station_name_zh, parent_line_code) VALUES
  ('SMT-LINE', 'LASER-01',     1, '镭雕机',     null),
  ('SMT-LINE', 'AI-VERT-01',   2, 'ai插件机',   null),
  ('SMT-LINE', 'PRINT-01',     3, '印刷机',     null),
  ('SMT-LINE', 'SPI-01',       4, 'spi',        null),
  ('SMT-LINE', 'NXT-01',       5, '贴片机',     null),
  ('SMT-LINE', 'SMT-AOI-01',   6, 'smt-aoi',    null),
  ('SMT-LINE', 'PDA-01',       7, 'pd扫码上料', null)
ON CONFLICT (line_code, station_code) DO NOTHING;

-- Insert 自动线 stations (顺序: pd扫码 → aoi → ict → fct → PCBA分板 → 外壳绑码 → 组装ATE → 超声 → 成品老化)
INSERT INTO station_sequences (line_code, station_code, sequence_order, station_name_zh, parent_line_code) VALUES
  ('AUTO-LINE', 'PDA-01',      1,  'pd扫码上料', null),
  ('AUTO-LINE', 'AOI-01',      2,  'aoi',        null),
  ('AUTO-LINE', 'ICT-01',      3,  'ICT',        null),
  ('AUTO-LINE', 'FCT-01',      4,  'FCT',        null),
  ('AUTO-LINE', 'DEPANEL-01',  5,  'PCBA分板',   null),
  ('AUTO-LINE', 'SHELL-BIND-01', 6, '外壳绑码',  null),
  ('AUTO-LINE', 'ASSY-ATE-01', 7,  '组装ATE',    null),
  ('AUTO-LINE', 'ULTRA-01',    8,  '超声',       null),
  ('AUTO-LINE', 'AGING-01',    9,  '成品老化',   null)
ON CONFLICT (line_code, station_code) DO NOTHING;

-- Insert 手动线 stations (顺序: pda扫码 → aoi → ict → fct → PCBA分板 → 外壳绑码 → 组装ATE → 超声 → 成品老化 → 高压ATE → 包装ATE → 外箱绑码 → 栈板绑码)
INSERT INTO station_sequences (line_code, station_code, sequence_order, station_name_zh, parent_line_code) VALUES
  ('MANUAL-LINE', 'PDA-01',     1,  'pda扫码上料', null),
  ('MANUAL-LINE', 'AOI-01',     2,  'aoi',        null),
  ('MANUAL-LINE', 'ICT-01',     3,  'ICT',        null),
  ('MANUAL-LINE', 'FCT-01',     4,  'FCT',        null),
  ('MANUAL-LINE', 'DEPANEL-01', 5,  'PCBA分板',   null),
  ('MANUAL-LINE', 'SHELL-BIND-01', 6, '外壳绑码', null),
  ('MANUAL-LINE', 'ASSY-ATE-01', 7,  '组装ATE',   null),
  ('MANUAL-LINE', 'ULTRA-01',   8,  '超声',       null),
  ('MANUAL-LINE', 'AGING-01',   9,  '成品老化',   null),
  ('MANUAL-LINE', 'HIPOT-01',   10, '高压ATE',    null),
  ('MANUAL-LINE', 'PACK-ATE-01',11, '包装ATE',    null),
  ('MANUAL-LINE', 'CARTON-BIND-01', 12, '外箱绑码', null),
  ('MANUAL-LINE', 'PALLET-BIND-01', 13, '栈板绑码', null)
ON CONFLICT (line_code, station_code) DO NOTHING;

-- Insert 包装线 stations (same physical flow as end of 自动线, continues from AGING-01)
-- parent_line_code = 'AUTO-LINE' means 高压ATE checks both PACK-LINE upstream + AUTO-LINE upstream
INSERT INTO station_sequences (line_code, station_code, sequence_order, station_name_zh, parent_line_code) VALUES
  ('PACK-LINE', 'HIPOT-PACK-01', 1, '高压ATE',    'AUTO-LINE'),
  ('PACK-LINE', 'PACK-ATE-01',   2, '包装ATE',    'AUTO-LINE'),
  ('PACK-LINE', 'CARTON-BIND-01',3, '外箱绑码',   'AUTO-LINE'),
  ('PACK-LINE', 'PALLET-BIND-01',4, '栈板绑码',   'AUTO-LINE')
ON CONFLICT (line_code, station_code) DO NOTHING;