-- MES-ruijing W5：AOI 配置表（源运行时由 core/aoi_model.ensure_table / aoi.py 建表，
-- 跟踪代码无 DDL；列集取自 cfg.py RES 与 aoi.py 读取点）

CREATE TABLE IF NOT EXISTS cfg_aoi_points (
    id           BIGSERIAL PRIMARY KEY,
    model        TEXT    NOT NULL DEFAULT '',
    station_name TEXT    NOT NULL DEFAULT '',
    point_qty    INTEGER NOT NULL DEFAULT 0,
    remark       TEXT    NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS cfg_aoi_program_map (
    id           BIGSERIAL PRIMARY KEY,
    program_name TEXT NOT NULL DEFAULT '',
    model        TEXT NOT NULL DEFAULT '',
    source       TEXT NOT NULL DEFAULT 'manual',
    remark       TEXT NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS mesrj_ux_aoi_program_map ON cfg_aoi_program_map(program_name);

-- cfg_model_process 索引（源 _ensure_model_process 补建）
CREATE INDEX IF NOT EXISTS mesrj_ix_model_process ON cfg_model_process(model, seq_no);
CREATE INDEX IF NOT EXISTS mesrj_ix_model_variant ON cfg_model_process(model, variant, seq_no);
