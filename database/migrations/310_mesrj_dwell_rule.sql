-- 310: MES-ruijing 时效（Dwell Time）管控规则表
-- 源 core/dwell.py 运行时建表（跟踪代码无 DDL，列集取自该文件 _ensure()）。
-- 语义：from_key → to_key 停留超过 max_hours 触发 action（预警 / 拦截）。
-- 键的四种粒度：工位编码 / 工序:工位类型 / 工位类型 / 工序代码。

CREATE TABLE IF NOT EXISTS cfg_dwell_rule (
    id         BIGSERIAL PRIMARY KEY,
    rule_name  TEXT    NOT NULL DEFAULT '',
    from_key   TEXT    NOT NULL DEFAULT '',
    to_key     TEXT    NOT NULL DEFAULT '',
    max_hours  NUMERIC(10,2) NOT NULL DEFAULT 0,
    action     TEXT    NOT NULL DEFAULT '预警',
    enabled    INTEGER NOT NULL DEFAULT 1,
    remark     TEXT    NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mesrj_ix_dwell_from ON cfg_dwell_rule(from_key) WHERE enabled = 1;
CREATE INDEX IF NOT EXISTS mesrj_ix_dwell_to   ON cfg_dwell_rule(to_key)   WHERE enabled = 1;

-- 首次建表灌默认规则；之后用户改过的不再覆盖
INSERT INTO cfg_dwell_rule (rule_name, from_key, to_key, max_hours, action, enabled, remark)
SELECT v.rule_name, v.from_key, v.to_key, v.max_hours, v.action, 1, v.remark
  FROM (VALUES
    ('SMT → DIP',            '01',    '02',         168::numeric, '预警', 'SMT 下线到 DIP 投产，超过 7 天必须烘烤/复检（用户 2026-10-22 定）'),
    ('DIP → 组装',           '02',    '03',         12::numeric,  '预警', 'DIP 完成到组装投产，超过 12H 预警（可调）'),
    ('组装 → 包装',          '03',    '04',         12::numeric,  '预警', '组装完成到包装投产，超过 12H 预警（可调）'),
    ('ICT → FCT',            'ICT',   'FCT',        2::numeric,   '预警', 'ICT 下线 2H 内必须进 FCT'),
    ('分板 → PCBA Link',     '分板',  'PCBA Link',  2::numeric,   '预警', '分板完成 2H 内必须绑码'),
    ('绑码 → ATE1',          '转码1', 'ATE1',       2::numeric,   '预警', '绑码（转码）完成 2H 内必须进 ATE1')
  ) AS v(rule_name, from_key, to_key, max_hours, action, remark)
 WHERE NOT EXISTS (SELECT 1 FROM cfg_dwell_rule);
