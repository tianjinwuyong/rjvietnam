-- MES-ruijing W4：bom/ord/pln 域运行期演化列与派生表
-- 来源：源系统通过散落的 ALTER TABLE / CREATE TABLE IF NOT EXISTS（order.py、seg.py、
--       moroute.py、wms_issue.py、bom.py、panel.py）在运行时补的列；这里一次性固化。
-- DDL 推断说明：cfg_panel_layout 在源码中只有使用无建表，列集取自 panel.py/devsrc.py/
--       exec.py/order.py/aoi_model.py 的全部读取点。

-- ── bom_item.item_type：RM=原料 / SFG=半成品（bom.py 装饰与 sfg-apply 依赖）──
ALTER TABLE bom_item ADD COLUMN IF NOT EXISTS item_type TEXT NOT NULL DEFAULT 'RM';

-- ── ord_mo：一 PO 一单模型的演化列 ──
ALTER TABLE ord_mo ADD COLUMN IF NOT EXISTS fg_code      TEXT NOT NULL DEFAULT '';
ALTER TABLE ord_mo ADD COLUMN IF NOT EXISTS output_codes TEXT NOT NULL DEFAULT '';
ALTER TABLE ord_mo ADD COLUMN IF NOT EXISTS is_pool      INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ord_mo ADD COLUMN IF NOT EXISTS variant      TEXT NOT NULL DEFAULT '';
ALTER TABLE ord_mo ADD COLUMN IF NOT EXISTS actual_start TEXT NOT NULL DEFAULT '';

-- ── ord_issue / ord_issue_item：分段与替代料 ──
ALTER TABLE ord_issue ADD COLUMN IF NOT EXISTS segment TEXT NOT NULL DEFAULT '';
ALTER TABLE ord_issue_item ADD COLUMN IF NOT EXISTS segment       TEXT NOT NULL DEFAULT '';
ALTER TABLE ord_issue_item ADD COLUMN IF NOT EXISTS issued_qty    DOUBLE PRECISION;
ALTER TABLE ord_issue_item ADD COLUMN IF NOT EXISTS main_code     TEXT NOT NULL DEFAULT '';
ALTER TABLE ord_issue_item ADD COLUMN IF NOT EXISTS is_substitute INTEGER NOT NULL DEFAULT 0;

-- ── ord_mo_seg：分段计划/产出/进度（core/seg.py ensure_tables）──
CREATE TABLE IF NOT EXISTS ord_mo_seg (
    id           BIGSERIAL PRIMARY KEY,
    mo_no        TEXT NOT NULL,
    segment      TEXT NOT NULL DEFAULT '',
    seg_no       INTEGER NOT NULL DEFAULT 0,
    line_code    TEXT NOT NULL DEFAULT '',
    plan_qty     INTEGER NOT NULL DEFAULT 0,
    out_qty      INTEGER NOT NULL DEFAULT 0,
    ng_qty       INTEGER NOT NULL DEFAULT 0,
    status       TEXT NOT NULL DEFAULT '待排产',
    plan_start   TEXT NOT NULL DEFAULT '',
    plan_end     TEXT NOT NULL DEFAULT '',
    actual_start TEXT NOT NULL DEFAULT '',
    actual_end   TEXT NOT NULL DEFAULT '',
    remark       TEXT NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (mo_no, segment)
);
CREATE INDEX IF NOT EXISTS mesrj_idx_moseg_mo ON ord_mo_seg(mo_no);

-- ── prd_mo_group_route：总工单（组）路线快照（core/moroute.py ensure）──
CREATE TABLE IF NOT EXISTS prd_mo_group_route (
    id         BIGSERIAL PRIMARY KEY,
    group_key  TEXT NOT NULL UNIQUE,
    model      TEXT NOT NULL DEFAULT '',
    route_code TEXT NOT NULL DEFAULT '',
    route_name TEXT NOT NULL DEFAULT '',
    version    TEXT NOT NULL DEFAULT 'V1.0',
    snapshot   TEXT NOT NULL DEFAULT '',
    step_count INTEGER NOT NULL DEFAULT 0,
    locked_by  TEXT NOT NULL DEFAULT '',
    locked_at  TEXT NOT NULL DEFAULT '',
    remark     TEXT NOT NULL DEFAULT ''
);

-- ── cfg_panel_layout：拼板布局（DDL 源码缺失，按使用点推断）──
CREATE TABLE IF NOT EXISTS cfg_panel_layout (
    id           BIGSERIAL PRIMARY KEY,
    model        TEXT NOT NULL DEFAULT '',
    product_code TEXT NOT NULL DEFAULT '',
    cols         INTEGER NOT NULL DEFAULT 1,
    rows         INTEGER NOT NULL DEFAULT 1,
    serpentine   INTEGER NOT NULL DEFAULT 1,
    seq_offset   INTEGER,
    total        INTEGER NOT NULL DEFAULT 0,
    enabled      INTEGER NOT NULL DEFAULT 1,
    remark       TEXT NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
