-- ============================================================
-- Migration 036: MES Process Flow & Station Time Rules
-- Source: MES流程(1).xlsx 6 sheets analysis
-- Sheet 1: 自动线工艺流程  → station_sequences SMT-LINE (32 stations)
-- Sheet 5: 时效管控        → station_time_rules (PCB开封168H, 白胶固化4H)
-- ============================================================

-- Drop existing SMT-LINE stations (will repopulate with full 32-step flow)
DELETE FROM station_sequences WHERE line_code = 'SMT-LINE';

-- ============================================================
-- SMT-LINE full station sequence (Sheet 1: 自动线工艺流程)
-- 顺序: 来料→仓储→IQC→备料→镭雕→AI立式插件→红胶印刷→贴装→回流焊→SMT-AOI→VI→PCBA上料
-- →异形件插入→点胶→C1A/T1插件→HS1/HS2插件→VI→波峰焊→PCBA测高→WS-AOI→ICT→FCT
-- →点胶2→固化柜→分板→MOS成型→散热螺钉→暂存→AC/DC线缆→镭雕→ATE1→超声→老化→PSU下载→Hi-pot→ATE2→加载测试→外壳标签→AC标签→VI→包装扫码→PE袋→封箱→自动包装→OQC
-- ============================================================
INSERT INTO station_sequences (line_code, station_code, sequence_order, station_name_zh, parent_line_code) VALUES
  ('SMT-LINE', 'VENDOR-01',      1,  '来料',         null),
  ('SMT-LINE', 'RECV-01',        2,  '收货',         null),
  ('SMT-LINE', 'STORE-01',       3,  '仓储',         null),
  ('SMT-LINE', 'IQC-01',         4,  'IQC',          null),
  ('SMT-LINE', 'MAT-PREP-01',    5,  '备料',         null),
  ('SMT-LINE', 'LASER-01',       6,  '镭雕/2D码',    null),
  ('SMT-LINE', 'AI-VERT-01',    7,  'AI立式插件',   null),
  ('SMT-LINE', 'PRINT-RED-01',  8,  '红胶印刷',     null),
  ('SMT-LINE', 'PLACE-01',       9,  '贴装',         null),
  ('SMT-LINE', 'REFLOW-01',     10, '回流焊',        null),
  ('SMT-LINE', 'SMT-AOI-01',    11, 'SMT-AOI',      null),
  ('SMT-LINE', 'VI-SMT-01',     12, 'SMT目检VI',    null),
  ('SMT-LINE', 'PCBA-LOAD-01',  13, 'PCBA上料',     null),
  ('SMT-LINE', 'ODD-FORM-01',   14, '异形件插入',   null),
  ('SMT-LINE', 'DISP-01',       15, '点胶',         null),
  ('SMT-LINE', 'INSERT-C1A-01', 16, 'C1A/T1插件',   null),
  ('SMT-LINE', 'INSERT-HS-01',  17, 'HS1/HS2插件',  null),
  ('SMT-LINE', 'VI-WAVE-01',     18, '波峰焊VI',     null),
  ('SMT-LINE', 'WAVE-01',       19, '波峰焊',       null),
  ('SMT-LINE', 'HEIGHT-01',     20, 'PCBA测高',     null),
  ('SMT-LINE', 'WS-AOI-01',     21, 'WS-AOI',       null),
  ('SMT-LINE', 'ICT-01',        22, 'ICT自动测试',   null),
  ('SMT-LINE', 'FCT-01',        23, 'FCT自动测试',   null),
  ('SMT-LINE', 'DISP-02-01',    24, '点胶2',        null),
  ('SMT-LINE', 'CURE-01',       25, '固化柜',       null),
  ('SMT-LINE', 'DEPANEL-01',    26, 'PCBA分板',     null),
  ('SMT-LINE', 'MOS-01',        27, 'MOS成型',       null),
  ('SMT-LINE', 'HEATSINK-01',   28, '散热螺钉',      null),
  ('SMT-LINE', 'TEMP-STORE-01', 29, '暂存',         null),
  ('SMT-LINE', 'AC-ASM-01',    30, 'AC线缆组装',    null),
  ('SMT-LINE', 'AC-SOLD-01',    31, 'AC线缆焊接',   null),
  ('SMT-LINE', 'DC-ASM-01',    32, 'DC线缆组装',   null),
  ('SMT-LINE', 'DC-SOLD-01',    33, 'DC线缆焊接',   null),
  ('SMT-LINE', 'VI-CABLE-01',   34, '线缆VI/CCD',   null),
  ('SMT-LINE', 'LASER-ENG-01',  35, '镭雕',         null),
  ('SMT-LINE', 'ATE1-01',       36, 'ATE1',         null),
  ('SMT-LINE', 'ULTRA-01',      37, '超声',         null),
  ('SMT-LINE', 'BURNIN-01',     38, '老化',         null),
  ('SMT-LINE', 'PSU-DL-01',    39, 'PSU下载',       null),
  ('SMT-LINE', 'STETH-01',      40, '听诊器Hi-pot', null),
  ('SMT-LINE', 'HIPOT-01',      41, 'Hi-pot',       null),
  ('SMT-LINE', 'ATE2-01',       42, 'ATE2',         null),
  ('SMT-LINE', 'LOAD-TEST-01',  43, '加载测试',     null),
  ('SMT-LINE', 'ENC-LABEL-01',  44, '外壳标签',     null),
  ('SMT-LINE', 'AC-LABEL-01',   45, 'AC标签',       null),
  ('SMT-LINE', 'VI-PACK-01',    46, '包装VI',       null),
  ('SMT-LINE', 'PACK-SCAN-01',  47, '包装扫码',     null),
  ('SMT-LINE', 'PE-BAG-01',     48, 'PE袋装',       null),
  ('SMT-LINE', 'SEAL-01',       49, '封箱',         null),
  ('SMT-LINE', 'AUTO-PACK-01',  50, '自动包装',     null),
  ('SMT-LINE', 'OQC-01',       51, 'OQC检测',      null),
  ('SMT-LINE', 'OQC-STORE-01',  52, 'OQC暂存',     null),
  ('SMT-LINE', 'REPAIR-01',    100, '维修站',       null)
ON CONFLICT (line_code, station_code) DO NOTHING;

-- ============================================================
-- Sheet 5: 时效管控 rules
-- Table: station_time_rules
-- ============================================================
CREATE TABLE IF NOT EXISTS station_time_rules (
  id               bigserial PRIMARY KEY,
  rule_code        varchar(40)  NOT NULL UNIQUE,
  rule_name_zh     varchar(200) NOT NULL,
  rule_name_en     varchar(200),
  description      text,
  from_station_code varchar(40) NOT NULL,   -- station that starts the timer
  to_station_code   varchar(40) NOT NULL,   -- station that must complete before timer expires
  line_code        varchar(40),             -- null = all lines
  max_minutes      integer     NOT NULL,    -- 0 = no limit; PCB开封→插件 = 10080 (168H)
  warn_minutes     integer,                 -- warning threshold
  critical_minutes integer,                 -- critical threshold
  action_on_exceed varchar(40),             -- HOLD | ALERT | BLOCK
  notes            text,
  created_at       timestamptz DEFAULT NOW(),
  updated_at       timestamptz DEFAULT NOW()
);

COMMENT ON TABLE station_time_rules IS 'Station time-based rules from MES流程 Excel Sheet5: 时效管控';

-- Sheet 5: PCB开封到插件 ≤168H (10080 min), else must bake 2H before proceeding
INSERT INTO station_time_rules (rule_code, rule_name_zh, rule_name_en, description,
  from_station_code, to_station_code, line_code, max_minutes, warn_minutes, critical_minutes, action_on_exceed, notes) VALUES
  ('PCB-OPEN-TO-PLUG', 'PCB开封→插件时效', 'PCB Open to Plugin Time',
   '从PCB开封（PCB镭码）到插件，时间不允许超过168H。如果超期，则必须经过烘烤2H之后才能投入插件。',
   'LASER-01', 'AI-VERT-01', 'SMT-LINE', 10080, 9000, 10500, 'HOLD',
   'PCB开封后168H内必须完成贴片/AI插件段。超时需走烘烤流程。')
ON CONFLICT (rule_code) DO NOTHING;

-- 白胶固化≥4H (240 min)
INSERT INTO station_time_rules (rule_code, rule_name_zh, rule_name_en, description,
  from_station_code, to_station_code, line_code, max_minutes, warn_minutes, critical_minutes, action_on_exceed, notes) VALUES
  ('GLAZE-CURE-MIN', '白胶固化最短时间', 'White Glaze Cure Min Time',
   '白胶固化≥4H后才能进行分板/后续工序。',
   'DISP-01', 'DEPANEL-01', 'SMT-LINE', 14400, NULL, NULL, 'HOLD',
   '白胶固化4H内禁止分板。固化柜到分板工位记录dwell_time。')
ON CONFLICT (rule_code) DO NOTHING;

-- ICT/FCT 复测规则: FAIL → 1st retest → FAIL → 2nd retest → FAIL → Repair
INSERT INTO station_time_rules (rule_code, rule_name_zh, rule_name_en, description,
  from_station_code, to_station_code, line_code, max_minutes, warn_minutes, critical_minutes, action_on_exceed, notes) VALUES
  ('ICT-RETEST', 'ICT自动测试复测规则', 'ICT Retest Rule',
   'ICT FAIL → 1st retest → FAIL → 2nd retest → FAIL → 维修。PASS则过站。',
   'ICT-01', 'ICT-01', NULL, 30, NULL, NULL, 'ALERT',
   '同一工位连续2次FAIL触发维修流程。')
ON CONFLICT (rule_code) DO NOTHING;

INSERT INTO station_time_rules (rule_code, rule_name_zh, rule_name_en, description,
  from_station_code, to_station_code, line_code, max_minutes, warn_minutes, critical_minutes, action_on_exceed, notes) VALUES
  ('FCT-RETEST', 'FCT自动测试复测规则', 'FCT Retest Rule',
   'FCT FAIL → 1st retest → FAIL → 2nd retest → FAIL → 维修。PASS则过站。',
   'FCT-01', 'FCT-01', NULL, 30, NULL, NULL, 'ALERT',
   '同一工位连续2次FAIL触发维修流程。')
ON CONFLICT (rule_code) DO NOTHING;

-- OQC暂存时间限制
INSERT INTO station_time_rules (rule_code, rule_name_zh, rule_name_en, description,
  from_station_code, to_station_code, line_code, max_minutes, warn_minutes, critical_minutes, action_on_exceed, notes) VALUES
  ('OQC-STORE-MAX', 'OQC暂存最大时间', 'OQC Temp Store Max Time',
   'OQC检测后成品暂存时间限制，超时触发库存预警。',
   'OQC-01', 'OQC-STORE-01', 'SMT-LINE', 43200, 28800, 39600, 'ALERT',
   'OQC暂存默认不超过30天(43200分钟)。')
ON CONFLICT (rule_code) DO NOTHING;

-- ============================================================
-- Sheet 3: 追溯要求 — add index for SN traceability query
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_station_flow_sn ON station_flow_records(sn);
CREATE INDEX IF NOT EXISTS idx_station_flow_wo ON station_flow_records(work_order_id);
CREATE INDEX IF NOT EXISTS idx_station_flow_arrival ON station_flow_records(arrival_time);
