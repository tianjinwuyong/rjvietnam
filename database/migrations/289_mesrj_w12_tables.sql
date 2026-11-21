-- W12: mesrj 面板/栈板/维修交接/分析/大屏/追溯导出 新增表
--
-- 源：api/panel.py, api/pallet.py, api/repair.py, api/analyze.py, api/trace_export.py
-- 所有表名与源一致，与 public 现有 992 张表无冲突（mesrj 前缀 sys_/md_/bom_/ord_/pln_/proc_/prd_/cfg_/itf_/eng_change/）
-- PG 方言：bigserial PK，timestamptz，now() 默认，索引前缀 mesrj_/ix_

-- ── 拼版：分板会话（一版一条）────────────────────────────────────
CREATE TABLE IF NOT EXISTS prd_panel_split (
    id           bigserial PRIMARY KEY,
    panel_sn     text NOT NULL DEFAULT '',
    mo_no        text NOT NULL DEFAULT '',
    product_code text NOT NULL DEFAULT '',
    line_code    text NOT NULL DEFAULT '',
    station_code text NOT NULL DEFAULT '',
    layout_id    bigint NOT NULL DEFAULT 0,
    cols         integer NOT NULL DEFAULT 0,
    rows         integer NOT NULL DEFAULT 0,
    total        integer NOT NULL DEFAULT 0,
    serpentine   integer NOT NULL DEFAULT 1,
    seq_offset   integer NOT NULL DEFAULT 0,
    status       text NOT NULL DEFAULT '进行中',
    scanned_cnt  integer NOT NULL DEFAULT 0,
    created_by   text NOT NULL DEFAULT '',
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_prd_panel_split_mo ON prd_panel_split(mo_no);
CREATE INDEX IF NOT EXISTS ix_prd_panel_split_sn ON prd_panel_split(panel_sn);

-- ── 拼版：每格明细 ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS prd_panel_slot (
    id            bigserial PRIMARY KEY,
    split_id      bigint NOT NULL DEFAULT 0,
    panel_sn      text NOT NULL DEFAULT '',
    slot_no       integer NOT NULL DEFAULT 0,
    child_sn      text NOT NULL DEFAULT '',
    seq_no_val    integer NOT NULL DEFAULT 0,
    ict_result    text NOT NULL DEFAULT '',
    fct_result    text NOT NULL DEFAULT '',
    judge         text NOT NULL DEFAULT 'WAIT',
    scanned       integer NOT NULL DEFAULT 0,
    scanned_at    timestamptz,
    smt_at        timestamptz,
    age_h         numeric,
    left_h        numeric,
    expired       integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_prd_panel_slot_split ON prd_panel_slot(split_id);
CREATE INDEX IF NOT EXISTS ix_prd_panel_slot_child_sn ON prd_panel_slot(child_sn);

-- ── 维修交接单 ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS prd_repair_handover (
    id            bigserial PRIMARY KEY,
    handover_no   text NOT NULL UNIQUE,
    handover_date text NOT NULL DEFAULT '',
    line_code     text NOT NULL DEFAULT '',
    station_code  text NOT NULL DEFAULT '',
    mo_no         text NOT NULL DEFAULT '',
    from_by       text NOT NULL DEFAULT '',
    to_by         text NOT NULL DEFAULT '',
    qty           integer NOT NULL DEFAULT 0,
    repaired_qty  integer NOT NULL DEFAULT 0,
    scrap_qty     integer NOT NULL DEFAULT 0,
    pending_qty   integer NOT NULL DEFAULT 0,
    status        text NOT NULL DEFAULT '待接收',
    remark        text NOT NULL DEFAULT '',
    created_by    text NOT NULL DEFAULT '',
    created_at    timestamptz NOT NULL DEFAULT now(),
    accepted_at   timestamptz,
    closed_at     timestamptz,
    auto_gen      integer NOT NULL DEFAULT 0,
    slot_label    text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_prd_repair_handover_no ON prd_repair_handover(handover_no);
CREATE INDEX IF NOT EXISTS ix_prd_repair_handover_status ON prd_repair_handover(status);

-- ── 维修交接单明细 ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS prd_repair_handover_item (
    id             bigserial PRIMARY KEY,
    handover_no    text NOT NULL DEFAULT '',
    sn             text NOT NULL DEFAULT '',
    defect_id      integer NOT NULL DEFAULT 0,
    station_code   text NOT NULL DEFAULT '',
    defect_code    text NOT NULL DEFAULT '',
    defect_desc    text NOT NULL DEFAULT '',
    result         text NOT NULL DEFAULT '待修',
    root_cause     text NOT NULL DEFAULT '',
    action         text NOT NULL DEFAULT '',
    repair_by      text NOT NULL DEFAULT '',
    repair_time    timestamptz,
    remark         text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_prd_repair_handover_item_no ON prd_repair_handover_item(handover_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_prd_repair_handover_item_sn ON prd_repair_handover_item(handover_no, sn);

-- ── 质量维修明细 ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS qlt_repair_detail (
    id            bigserial PRIMARY KEY,
    sn            text NOT NULL DEFAULT '',
    station_code  text NOT NULL DEFAULT '',
    defect_code   text NOT NULL DEFAULT '',
    defect_desc   text NOT NULL DEFAULT '',
    result        text NOT NULL DEFAULT '',
    root_cause    text NOT NULL DEFAULT '',
    action        text NOT NULL DEFAULT '',
    repair_by     text NOT NULL DEFAULT '',
    repair_time   timestamptz,
    remark        text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_qlt_repair_detail_sn ON qlt_repair_detail(sn);

-- ── 质量解报废台账 ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS qlt_scrap_release (
    id            bigserial PRIMARY KEY,
    sn            text NOT NULL DEFAULT '',
    station_code  text NOT NULL DEFAULT '',
    defect_code   text NOT NULL DEFAULT '',
    reason        text NOT NULL DEFAULT '',
    status        text NOT NULL DEFAULT '待批准',
    approved_by   text NOT NULL DEFAULT '',
    approved_at   timestamptz,
    created_by    text NOT NULL DEFAULT '',
    created_at    timestamptz NOT NULL DEFAULT now(),
    consumed      integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_qlt_scrap_release_sn ON qlt_scrap_release(sn);
CREATE INDEX IF NOT EXISTS ix_qlt_scrap_release_status ON qlt_scrap_release(status);

-- ── 栈板改挂 PO 台账 ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS prd_pallet_po_log (
    id          bigserial PRIMARY KEY,
    pallet_no   text NOT NULL DEFAULT '',
    mo_no       text NOT NULL DEFAULT '',
    from_po     text NOT NULL DEFAULT '',
    to_po       text NOT NULL DEFAULT '',
    qty         integer NOT NULL DEFAULT 0,
    box_count   integer NOT NULL DEFAULT 0,
    reason      text NOT NULL DEFAULT '',
    operator    text NOT NULL DEFAULT '',
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_prd_pallet_po_log_pallet ON prd_pallet_po_log(pallet_no);

-- ── 预警规则 ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cfg_alert_rule (
    id          bigserial PRIMARY KEY,
    rule_key    text NOT NULL DEFAULT '',
    rule_name   text NOT NULL DEFAULT '',
    source      text NOT NULL DEFAULT '',
    cond        text NOT NULL DEFAULT '',
    value       real NOT NULL DEFAULT 0,
    unit        text NOT NULL DEFAULT '',
    level       text NOT NULL DEFAULT '',
    action      text NOT NULL DEFAULT '',
    enabled     integer NOT NULL DEFAULT 1,
    remark      text NOT NULL DEFAULT '',
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- ── 预警记录 ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS prd_alert (
    id           bigserial PRIMARY KEY,
    rule_key     text NOT NULL DEFAULT '',
    rule_name    text NOT NULL DEFAULT '',
    level        text NOT NULL DEFAULT '',
    title        text NOT NULL DEFAULT '',
    detail       text NOT NULL DEFAULT '',
    ref_sn       text NOT NULL DEFAULT '',
    station_code text NOT NULL DEFAULT '',
    status       text NOT NULL DEFAULT '待处理',
    handled_by   text NOT NULL DEFAULT '',
    handled_at   timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_prd_alert_status ON prd_alert(status);
CREATE INDEX IF NOT EXISTS ix_prd_alert_rule_key ON prd_alert(rule_key);

-- ── W12 新增权限码（287 只播种了 36 项，此处补齐）───────────────
INSERT INTO sys_perm (perm_code, perm_name, module, remark) VALUES
  ('prod.pallet',   '栈板绑码',       '生产',   '装箱/栈板码垛'),
  ('alert.handle',  '告警处置',       '系统',   '预警中心告警确认/关闭')
ON CONFLICT (perm_code) DO NOTHING;

COMMENT ON TABLE prd_panel_split IS '拼版分板会话（一版一条）';
COMMENT ON TABLE prd_panel_slot IS '拼版每格明细';
COMMENT ON TABLE prd_repair_handover IS '维修交接单';
COMMENT ON TABLE prd_repair_handover_item IS '维修交接单明细';
COMMENT ON TABLE qlt_repair_detail IS '质量维修明细';
COMMENT ON TABLE qlt_scrap_release IS '质量解报废台账';
COMMENT ON TABLE prd_pallet_po_log IS '栈板改挂 PO 台账';
COMMENT ON TABLE cfg_alert_rule IS '预警规则';
COMMENT ON TABLE prd_alert IS '预警记录';
