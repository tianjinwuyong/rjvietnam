-- ============================================================================
-- 276 · MES-ruijing 移植 W2 补充：产能标准表
-- 源系统引用（api/basic.py、api/plan.py）但从未建表（源缺陷，SQLite 下首次
-- 查询即报错）；列集按 plan.py capmaster_save 的 INSERT/ON CONFLICT 推断。
-- ============================================================================

CREATE TABLE IF NOT EXISTS cfg_capacity (
    id           BIGSERIAL PRIMARY KEY,
    line_code    TEXT NOT NULL DEFAULT '',
    product_code TEXT NOT NULL DEFAULT '',
    process      TEXT NOT NULL DEFAULT '',
    uph          DOUBLE PRECISION NOT NULL DEFAULT 0,
    std_headcount INTEGER NOT NULL DEFAULT 0,
    enabled      INTEGER NOT NULL DEFAULT 1,
    remark       TEXT NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(line_code, product_code, process)
);
CREATE INDEX IF NOT EXISTS mesrj_idx_capacity_line ON cfg_capacity(line_code);
