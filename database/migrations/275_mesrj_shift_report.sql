-- ============================================================================
-- 275 · MES-ruijing 移植 W2 补充：报工表（W6 波次表，但 /cfg/basic/process、
-- /cfg/basic/process/save|delete 的引用计数需要它，提前落地）
-- 来源：api/shift.py:36（运行时建表）
-- ============================================================================

CREATE TABLE IF NOT EXISTS prd_shift_report (
    id           BIGSERIAL PRIMARY KEY,
    report_date  TEXT NOT NULL,
    shift_code   TEXT NOT NULL DEFAULT 'DAY',
    line_code    TEXT NOT NULL DEFAULT '',
    mo_no        TEXT NOT NULL DEFAULT '',
    product_code TEXT NOT NULL DEFAULT '',
    process      TEXT NOT NULL DEFAULT '',
    plan_qty     DOUBLE PRECISION NOT NULL DEFAULT 0,
    done_qty     DOUBLE PRECISION NOT NULL DEFAULT 0,
    ng_qty       DOUBLE PRECISION NOT NULL DEFAULT 0,
    headcount    DOUBLE PRECISION NOT NULL DEFAULT 0,
    work_hours   DOUBLE PRECISION NOT NULL DEFAULT 0,
    uph          DOUBLE PRECISION NOT NULL DEFAULT 0,
    upph         DOUBLE PRECISION NOT NULL DEFAULT 0,
    total_hours  DOUBLE PRECISION NOT NULL DEFAULT 0,
    rate         DOUBLE PRECISION NOT NULL DEFAULT 0,
    eff          DOUBLE PRECISION NOT NULL DEFAULT 0,
    remark       TEXT NOT NULL DEFAULT '',
    plan_id      BIGINT,
    src          TEXT NOT NULL DEFAULT 'manual',
    created_by   TEXT NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(report_date, shift_code, mo_no, process)
);
CREATE INDEX IF NOT EXISTS mesrj_idx_shiftrep_date ON prd_shift_report(report_date, line_code);
