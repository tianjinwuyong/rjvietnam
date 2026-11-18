-- ============================================================================
-- 273 · MES-ruijing 移植 W2：源系统运行时建表（对应仓库约定 #9）
-- 来源：api/basic.py:42（cfg_process）、api/devsrc.py:18（cfg_machine_source）
-- 其余 45 张运行时表随 W5–W7 波次各自迁移补充
-- ============================================================================

-- 工序字典（排产/报表/班组/报工、MES 工站映射都用它；首次进入时 basic.py 会
-- 用 DEFAULT_PROCESS 播种，这里迁移期直接播种同一套默认值）
CREATE TABLE IF NOT EXISTS cfg_process (
    id               BIGSERIAL PRIMARY KEY,
    process_code     TEXT NOT NULL UNIQUE,
    process_name     TEXT NOT NULL DEFAULT '',
    sort_no          INTEGER NOT NULL DEFAULT 0,
    station_keywords TEXT NOT NULL DEFAULT '',
    enabled          INTEGER NOT NULL DEFAULT 1,
    remark           TEXT NOT NULL DEFAULT '',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO cfg_process (process_code, process_name, sort_no, station_keywords)
SELECT v.code, v.name, v.sort_no, v.kw
FROM (VALUES
    ('SMT',       'SMT 贴片',        10, 'SMT-'),
    ('SMT-PCB1',  'SMT 贴片 第 1 段', 11, 'SMT-'),
    ('SMT-PCB2',  'SMT 贴片 第 2 段', 12, 'SMT-'),
    ('测试',      '测试',            20, 'AI,ICT'),
    ('测试-PCB1', '测试 第 1 段',     21, 'AI,ICT'),
    ('测试-PCB2', '测试 第 2 段',     22, 'AI,ICT'),
    ('加工',      '加工',            30, 'AI,PRESS'),
    ('组装',      '组装',            40, 'ASSY'),
    ('老化',      '老化',            50, 'AGING'),
    ('包装',      '包装',            60, 'PACK')
) AS v(code, name, sort_no, kw)
WHERE NOT EXISTS (SELECT 1 FROM cfg_process c WHERE c.process_code = v.code);

-- 机台数据源（ICT/FCT"文件采集型"机台 → 线别/工位/轨道 绑定；机台侧同步 agent
-- 通过 /DeviceConfig/MachineSource?machine=X + X-Api-Key 拉取）
CREATE TABLE IF NOT EXISTS cfg_machine_source (
    id           BIGSERIAL PRIMARY KEY,
    machine_no   TEXT UNIQUE NOT NULL,
    line_code    TEXT NOT NULL DEFAULT '',
    station_code TEXT NOT NULL DEFAULT '',
    track        TEXT NOT NULL DEFAULT '1',
    mo_hint      TEXT NOT NULL DEFAULT '',
    enabled      INTEGER NOT NULL DEFAULT 1,
    remark       TEXT NOT NULL DEFAULT '',
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 源系统演进列（schema.sql 之后经运行时 ALTER / 修复脚本追加，api 代码直接引用）
-- 来源：fix_station_short.py:132、classify_station_type.py:38、
--       test_panel_layout.py:66、api/*.py 内联 ALTER
-- ============================================================================

ALTER TABLE md_station ADD COLUMN IF NOT EXISTS short_name       TEXT    NOT NULL DEFAULT '';
ALTER TABLE md_station ADD COLUMN IF NOT EXISTS type_code        TEXT    NOT NULL DEFAULT '';
ALTER TABLE md_station ADD COLUMN IF NOT EXISTS panel_work       INTEGER NOT NULL DEFAULT 0;
ALTER TABLE md_station ADD COLUMN IF NOT EXISTS is_sampling      INTEGER NOT NULL DEFAULT 0;
ALTER TABLE md_station ADD COLUMN IF NOT EXISTS deny_manual_pass INTEGER NOT NULL DEFAULT 0;

ALTER TABLE md_product ADD COLUMN IF NOT EXISTS product_type TEXT NOT NULL DEFAULT 'FG';

ALTER TABLE sys_user ADD COLUMN IF NOT EXISTS emp_no TEXT NOT NULL DEFAULT '';

