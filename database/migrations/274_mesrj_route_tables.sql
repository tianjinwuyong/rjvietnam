-- ============================================================================
-- 274 · MES-ruijing 移植 W2 补充：工艺路线域的运行时表
-- 来源：api/route.py:316（cfg_product_route）、api/route.py:495（cfg_model_process）
-- /md/options 的 route_n 子查询引用 cfg_model_process，故提前于 W4 落地
-- ============================================================================

-- 产品路由（产品 + 工序 → 默认产线/指定路线）
CREATE TABLE IF NOT EXISTS cfg_product_route (
    id           BIGSERIAL PRIMARY KEY,
    product_code TEXT NOT NULL DEFAULT '',
    process_code TEXT NOT NULL DEFAULT '',
    line_code    TEXT NOT NULL DEFAULT '',
    route_code   TEXT NOT NULL DEFAULT '',
    remark       TEXT NOT NULL DEFAULT '',
    updated_by   TEXT NOT NULL DEFAULT '',
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(product_code, process_code)
);

-- 机型工序（机型 → 工位序列；标准路线为"模板"，新建工单时复制一份）
CREATE TABLE IF NOT EXISTS cfg_model_process (
    id           BIGSERIAL PRIMARY KEY,
    model        TEXT    NOT NULL DEFAULT '',
    variant      TEXT    NOT NULL DEFAULT '',
    seq_no       INTEGER NOT NULL DEFAULT 0,
    station_code TEXT    NOT NULL DEFAULT '',
    station_name TEXT    NOT NULL DEFAULT '',
    process_code TEXT    NOT NULL DEFAULT '',
    is_must_pass INTEGER NOT NULL DEFAULT 0,
    enabled      INTEGER NOT NULL DEFAULT 1,
    remark       TEXT    NOT NULL DEFAULT '',
    updated_by   TEXT    NOT NULL DEFAULT '',
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mesrj_idx_modelproc_model ON cfg_model_process(model, variant, seq_no);
