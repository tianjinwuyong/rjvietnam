-- ============================================================================
-- 272 · MES-ruijing 移植：全量表结构（SQLite → PostgreSQL 转换）
-- 来源：D:\rj\repos\MES-ruijing\sql\schema.sql（66 表 / 9 域）
-- 约定：
--   · 表名保持原名（已验证与 public 现有表零冲突）
--   · INTEGER AUTOINCREMENT → bigserial；datetime('now','localtime') → timestamptz now()
--   · 其余日期类 TEXT 列保持 TEXT（原语义：空串或 YYYY-MM-DD / HH:MM）
--   · 索引名加 mesrj_ 前缀避免与既有索引冲突
-- 详见 docs/MES-GRAFT-PLAN.md
-- ============================================================================

-- ── 域 1 · 系统管理 ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sys_user (
    id            BIGSERIAL PRIMARY KEY,
    login_name    TEXT    NOT NULL UNIQUE,
    emp_name      TEXT    NOT NULL DEFAULT '',
    password_hash TEXT    NOT NULL DEFAULT '',
    salt          TEXT    NOT NULL DEFAULT '',
    dept          TEXT    NOT NULL DEFAULT '',
    phone         TEXT    NOT NULL DEFAULT '',
    status        INTEGER NOT NULL DEFAULT 1,
    remark        TEXT    NOT NULL DEFAULT '',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sys_role (
    id         BIGSERIAL PRIMARY KEY,
    role_code  TEXT    NOT NULL UNIQUE,
    role_name  TEXT    NOT NULL DEFAULT '',
    is_builtin INTEGER NOT NULL DEFAULT 0,
    remark     TEXT    NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sys_user_role (
    id      BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES sys_user(id) ON DELETE CASCADE,
    role_id BIGINT NOT NULL REFERENCES sys_role(id) ON DELETE CASCADE,
    UNIQUE (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS sys_perm (
    id        BIGSERIAL PRIMARY KEY,
    perm_code TEXT    NOT NULL UNIQUE,
    perm_name TEXT    NOT NULL DEFAULT '',
    module    TEXT    NOT NULL DEFAULT '',
    remark    TEXT    NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS sys_role_perm (
    id      BIGSERIAL PRIMARY KEY,
    role_id BIGINT NOT NULL REFERENCES sys_role(id) ON DELETE CASCADE,
    perm_id BIGINT NOT NULL REFERENCES sys_perm(id) ON DELETE CASCADE,
    UNIQUE (role_id, perm_id)
);

CREATE TABLE IF NOT EXISTS sys_user_line (
    id        BIGSERIAL PRIMARY KEY,
    user_id   BIGINT NOT NULL REFERENCES sys_user(id) ON DELETE CASCADE,
    line_code TEXT    NOT NULL,
    UNIQUE (user_id, line_code)
);

CREATE TABLE IF NOT EXISTS sys_audit_log (
    id         BIGSERIAL PRIMARY KEY,
    user_name  TEXT    NOT NULL DEFAULT '',
    module     TEXT    NOT NULL DEFAULT '',
    action     TEXT    NOT NULL DEFAULT '',
    target     TEXT    NOT NULL DEFAULT '',
    detail     TEXT    NOT NULL DEFAULT '',
    ip         TEXT    NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mesrj_idx_audit_created ON sys_audit_log(created_at);

CREATE TABLE IF NOT EXISTS sys_param (
    id         BIGSERIAL PRIMARY KEY,
    param_key  TEXT    NOT NULL UNIQUE,
    param_val  TEXT    NOT NULL DEFAULT '',
    param_name TEXT    NOT NULL DEFAULT '',
    group_name TEXT    NOT NULL DEFAULT '',
    remark     TEXT    NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 域 2 · 主数据 ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS md_customer (
    id         BIGSERIAL PRIMARY KEY,
    cust_code  TEXT    NOT NULL UNIQUE,
    cust_name  TEXT    NOT NULL DEFAULT '',
    short_name TEXT    NOT NULL DEFAULT '',
    country    TEXT    NOT NULL DEFAULT '',
    status     INTEGER NOT NULL DEFAULT 1,
    remark     TEXT    NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS md_product (
    id            BIGSERIAL PRIMARY KEY,
    product_code  TEXT    NOT NULL UNIQUE,
    product_name  TEXT    NOT NULL DEFAULT '',
    product_model TEXT    NOT NULL DEFAULT '',
    cust_code     TEXT    NOT NULL DEFAULT '',
    spec          TEXT    NOT NULL DEFAULT '',
    color         TEXT    NOT NULL DEFAULT '',
    sku           TEXT    NOT NULL DEFAULT '',
    unit          TEXT    NOT NULL DEFAULT 'PCS',
    status        INTEGER NOT NULL DEFAULT 1,
    remark        TEXT    NOT NULL DEFAULT '',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS md_material (
    id            BIGSERIAL PRIMARY KEY,
    material_code TEXT    NOT NULL UNIQUE,
    vn_code       TEXT    NOT NULL DEFAULT '',
    material_name TEXT    NOT NULL DEFAULT '',
    spec          TEXT    NOT NULL DEFAULT '',
    unit          TEXT    NOT NULL DEFAULT 'PCS',
    mpq           INTEGER NOT NULL DEFAULT 1,
    loss_rate     DOUBLE PRECISION NOT NULL DEFAULT 0,
    origin_code   TEXT    NOT NULL DEFAULT '',
    maker         TEXT    NOT NULL DEFAULT '',
    category      TEXT    NOT NULL DEFAULT '',
    is_aux        INTEGER NOT NULL DEFAULT 0,
    status        INTEGER NOT NULL DEFAULT 1,
    remark        TEXT    NOT NULL DEFAULT '',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS md_line (
    id           BIGSERIAL PRIMARY KEY,
    line_code    TEXT    NOT NULL UNIQUE,
    line_name    TEXT    NOT NULL DEFAULT '',
    line_type    TEXT    NOT NULL DEFAULT '',
    process_code TEXT    NOT NULL DEFAULT '',
    tact_time    DOUBLE PRECISION NOT NULL DEFAULT 0,
    plan_hours   DOUBLE PRECISION NOT NULL DEFAULT 8,
    status       INTEGER NOT NULL DEFAULT 1,
    remark       TEXT    NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS md_track (
    id         BIGSERIAL PRIMARY KEY,
    track_code TEXT    NOT NULL UNIQUE,
    track_name TEXT    NOT NULL DEFAULT '',
    remark     TEXT    NOT NULL DEFAULT '',
    status     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS md_station (
    id                  BIGSERIAL PRIMARY KEY,
    station_code        TEXT    NOT NULL UNIQUE,
    station_name        TEXT    NOT NULL DEFAULT '',
    station_name_en     TEXT    NOT NULL DEFAULT '',
    line_code           TEXT    NOT NULL DEFAULT '',
    track_code          TEXT    NOT NULL DEFAULT '',
    process_code        TEXT    NOT NULL DEFAULT '',
    seq_no              INTEGER NOT NULL DEFAULT 0,
    station_type        TEXT    NOT NULL DEFAULT '产线',
    is_seq_station      INTEGER NOT NULL DEFAULT 1,
    allow_retest        INTEGER NOT NULL DEFAULT 1,
    max_retest          INTEGER NOT NULL DEFAULT 2,
    need_material_check INTEGER NOT NULL DEFAULT 0,
    need_hardware       INTEGER NOT NULL DEFAULT 0,
    status              INTEGER NOT NULL DEFAULT 1,
    remark              TEXT    NOT NULL DEFAULT '',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mesrj_idx_station_line ON md_station(line_code);

CREATE TABLE IF NOT EXISTS md_equipment (
    id            BIGSERIAL PRIMARY KEY,
    equip_code    TEXT    NOT NULL UNIQUE,
    equip_name    TEXT    NOT NULL DEFAULT '',
    equip_type    TEXT    NOT NULL DEFAULT '',
    model         TEXT    NOT NULL DEFAULT '',
    brand         TEXT    NOT NULL DEFAULT '',
    line_code     TEXT    NOT NULL DEFAULT '',
    station_code  TEXT    NOT NULL DEFAULT '',
    connect_mode  TEXT    NOT NULL DEFAULT '待定',
    is_reversible INTEGER NOT NULL DEFAULT 1,
    api_key       TEXT    NOT NULL DEFAULT '',
    status        INTEGER NOT NULL DEFAULT 1,
    remark        TEXT    NOT NULL DEFAULT '',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS md_defect (
    id           BIGSERIAL PRIMARY KEY,
    defect_code  TEXT    NOT NULL UNIQUE,
    name_cn      TEXT    NOT NULL DEFAULT '',
    name_en      TEXT    NOT NULL DEFAULT '',
    name_vi      TEXT    NOT NULL DEFAULT '',
    process_code TEXT    NOT NULL DEFAULT '',
    category     TEXT    NOT NULL DEFAULT 'Minor',
    can_retest   INTEGER NOT NULL DEFAULT 1,
    is_scrap     INTEGER NOT NULL DEFAULT 0,
    is_terminal  INTEGER NOT NULL DEFAULT 0,
    description  TEXT    NOT NULL DEFAULT '',
    status       INTEGER NOT NULL DEFAULT 1,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS md_rootcause (
    id          BIGSERIAL PRIMARY KEY,
    rc_code     TEXT    NOT NULL UNIQUE,
    name_cn     TEXT    NOT NULL DEFAULT '',
    name_en     TEXT    NOT NULL DEFAULT '',
    name_vi     TEXT    NOT NULL DEFAULT '',
    description TEXT    NOT NULL DEFAULT '',
    status      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS md_shift (
    id         BIGSERIAL PRIMARY KEY,
    shift_code TEXT    NOT NULL UNIQUE,
    shift_name TEXT    NOT NULL DEFAULT '',
    begin_time TEXT    NOT NULL DEFAULT '',
    end_time   TEXT    NOT NULL DEFAULT '',
    cross_day  INTEGER NOT NULL DEFAULT 0,
    status     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS md_calendar (
    id         BIGSERIAL PRIMARY KEY,
    cal_date   TEXT    NOT NULL,
    line_code  TEXT    NOT NULL DEFAULT '',
    is_workday INTEGER NOT NULL DEFAULT 1,
    remark     TEXT    NOT NULL DEFAULT '',
    UNIQUE (cal_date, line_code)
);

-- ── 域 3 · BOM ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS bom_header (
    id           BIGSERIAL PRIMARY KEY,
    product_code TEXT    NOT NULL,
    version      TEXT    NOT NULL DEFAULT 'V1.0',
    cust_code    TEXT    NOT NULL DEFAULT '',
    eff_date     TEXT    NOT NULL DEFAULT '',
    status       TEXT    NOT NULL DEFAULT '生效',
    src_file     TEXT    NOT NULL DEFAULT '',
    remark       TEXT    NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (product_code, version)
);

CREATE TABLE IF NOT EXISTS bom_item (
    id            BIGSERIAL PRIMARY KEY,
    product_code  TEXT    NOT NULL,
    version       TEXT    NOT NULL DEFAULT 'V1.0',
    seq_no        INTEGER NOT NULL DEFAULT 0,
    material_code TEXT    NOT NULL,
    material_name TEXT    NOT NULL DEFAULT '',
    spec          TEXT    NOT NULL DEFAULT '',
    unit          TEXT    NOT NULL DEFAULT 'PCS',
    qty_per       DOUBLE PRECISION NOT NULL DEFAULT 0,
    segment       TEXT    NOT NULL DEFAULT '',
    wo_type       TEXT    NOT NULL DEFAULT '',
    pos_ref       TEXT    NOT NULL DEFAULT '',
    is_alt        INTEGER NOT NULL DEFAULT 0,
    alt_group     TEXT    NOT NULL DEFAULT '',
    mpq           INTEGER NOT NULL DEFAULT 1,
    loss_rate     DOUBLE PRECISION NOT NULL DEFAULT 0,
    remark        TEXT    NOT NULL DEFAULT '',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mesrj_idx_bomitem_key ON bom_item(product_code, version);
CREATE INDEX IF NOT EXISTS mesrj_idx_bomitem_seg ON bom_item(segment);

-- ── 域 4 · 订单与工单 ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ord_po (
    id            BIGSERIAL PRIMARY KEY,
    po_no         TEXT    NOT NULL,
    po_line       TEXT    NOT NULL DEFAULT '1',
    cust_code     TEXT    NOT NULL DEFAULT '',
    product_code  TEXT    NOT NULL DEFAULT '',
    order_qty     INTEGER NOT NULL DEFAULT 0,
    delivery_date TEXT    NOT NULL DEFAULT '',
    status        TEXT    NOT NULL DEFAULT '待排产',
    remark        TEXT    NOT NULL DEFAULT '',
    created_by    TEXT    NOT NULL DEFAULT '',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (po_no, po_line)
);
CREATE INDEX IF NOT EXISTS mesrj_idx_po_status ON ord_po(status);

-- 工单流水号池（同一 PO 同一产品整套工序工单共用同一流水号）
CREATE TABLE IF NOT EXISTS ord_mo_seq (
    id           BIGSERIAL PRIMARY KEY,
    yy           TEXT    NOT NULL,
    mm           TEXT    NOT NULL,
    type_code    TEXT    NOT NULL,
    seq_no       TEXT    NOT NULL,
    po_no        TEXT    NOT NULL DEFAULT '',
    product_code TEXT    NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (yy, mm, type_code, seq_no)
);

CREATE TABLE IF NOT EXISTS ord_mo (
    id           BIGSERIAL PRIMARY KEY,
    mo_no        TEXT    NOT NULL UNIQUE,
    yy           TEXT    NOT NULL DEFAULT '',
    mm           TEXT    NOT NULL DEFAULT '',
    type_code    TEXT    NOT NULL DEFAULT '1',
    seq_no       TEXT    NOT NULL DEFAULT '',
    process_code TEXT    NOT NULL DEFAULT '',
    wo_type      TEXT    NOT NULL DEFAULT '',
    po_no        TEXT    NOT NULL DEFAULT '',
    po_line      TEXT    NOT NULL DEFAULT '1',
    cust_code    TEXT    NOT NULL DEFAULT '',
    product_code TEXT    NOT NULL DEFAULT '',
    plan_qty     INTEGER NOT NULL DEFAULT 0,
    out_qty      INTEGER NOT NULL DEFAULT 0,
    ng_qty       INTEGER NOT NULL DEFAULT 0,
    line_code    TEXT    NOT NULL DEFAULT '',
    plan_start   TEXT    NOT NULL DEFAULT '',
    plan_end     TEXT    NOT NULL DEFAULT '',
    status       TEXT    NOT NULL DEFAULT '待排产',
    src_mo_no    TEXT    NOT NULL DEFAULT '',
    remark       TEXT    NOT NULL DEFAULT '',
    created_by   TEXT    NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mesrj_idx_mo_po ON ord_mo(po_no);
CREATE INDEX IF NOT EXISTS mesrj_idx_mo_status ON ord_mo(status);

CREATE TABLE IF NOT EXISTS ord_issue (
    id         BIGSERIAL PRIMARY KEY,
    issue_no   TEXT    NOT NULL UNIQUE,
    mo_no      TEXT    NOT NULL,
    wo_type    TEXT    NOT NULL DEFAULT '',
    line_code  TEXT    NOT NULL DEFAULT '',
    issue_type TEXT    NOT NULL DEFAULT '工序领料',
    apply_qty  INTEGER NOT NULL DEFAULT 0,
    status     TEXT    NOT NULL DEFAULT '待领',
    issue_by   TEXT    NOT NULL DEFAULT '',
    issue_time TEXT    NOT NULL DEFAULT '',
    remark     TEXT    NOT NULL DEFAULT '',
    created_by TEXT    NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mesrj_idx_issue_mo ON ord_issue(mo_no);

CREATE TABLE IF NOT EXISTS ord_issue_item (
    id            BIGSERIAL PRIMARY KEY,
    issue_no      TEXT    NOT NULL,
    material_code TEXT    NOT NULL,
    material_name TEXT    NOT NULL DEFAULT '',
    spec          TEXT    NOT NULL DEFAULT '',
    unit          TEXT    NOT NULL DEFAULT 'PCS',
    qty_per       DOUBLE PRECISION NOT NULL DEFAULT 0,
    need_qty      DOUBLE PRECISION NOT NULL DEFAULT 0,
    mpq           INTEGER NOT NULL DEFAULT 1,
    issue_qty     DOUBLE PRECISION NOT NULL DEFAULT 0,
    pos_ref       TEXT    NOT NULL DEFAULT '',
    alt_list      TEXT    NOT NULL DEFAULT '',
    line_seq      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS mesrj_idx_issueitem_no ON ord_issue_item(issue_no);

CREATE TABLE IF NOT EXISTS ord_replenish (
    id            BIGSERIAL PRIMARY KEY,
    rep_no        TEXT    NOT NULL UNIQUE,
    mo_no         TEXT    NOT NULL,
    material_code TEXT    NOT NULL,
    qty           DOUBLE PRECISION NOT NULL DEFAULT 0,
    reason        TEXT    NOT NULL DEFAULT '',
    status        TEXT    NOT NULL DEFAULT '待审',
    created_by    TEXT    NOT NULL DEFAULT '',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 域 5 · 生产计划 ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pln_capacity (
    id         BIGSERIAL PRIMARY KEY,
    line_code  TEXT    NOT NULL,
    shift_code TEXT    NOT NULL DEFAULT 'DAY',
    tact_time  DOUBLE PRECISION NOT NULL DEFAULT 0,
    capacity   INTEGER NOT NULL DEFAULT 0,
    status     INTEGER NOT NULL DEFAULT 1,
    UNIQUE (line_code, shift_code)
);

CREATE TABLE IF NOT EXISTS pln_schedule (
    id         BIGSERIAL PRIMARY KEY,
    plan_date  TEXT    NOT NULL,
    shift_code TEXT    NOT NULL DEFAULT 'DAY',
    line_code  TEXT    NOT NULL,
    mo_no      TEXT    NOT NULL,
    plan_qty   INTEGER NOT NULL DEFAULT 0,
    seq_no     INTEGER NOT NULL DEFAULT 0,
    status     TEXT    NOT NULL DEFAULT '计划中',
    remark     TEXT    NOT NULL DEFAULT '',
    created_by TEXT    NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mesrj_idx_plan_date ON pln_schedule(plan_date, line_code);

-- ── 域 6 · 工艺路线 ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS proc_route (
    id           BIGSERIAL PRIMARY KEY,
    route_code   TEXT    NOT NULL UNIQUE,
    route_name   TEXT    NOT NULL DEFAULT '',
    product_code TEXT    NOT NULL DEFAULT '',
    version      TEXT    NOT NULL DEFAULT 'V1.0',
    status       TEXT    NOT NULL DEFAULT '生效',
    remark       TEXT    NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS proc_step (
    id             BIGSERIAL PRIMARY KEY,
    route_code     TEXT    NOT NULL,
    seq_no         INTEGER NOT NULL DEFAULT 0,
    process_code   TEXT    NOT NULL DEFAULT '',
    station_code   TEXT    NOT NULL DEFAULT '',
    station_name   TEXT    NOT NULL DEFAULT '',
    is_must_pass   INTEGER NOT NULL DEFAULT 1,
    allow_retest   INTEGER NOT NULL DEFAULT 1,
    max_retest     INTEGER NOT NULL DEFAULT 2,
    is_key_station INTEGER NOT NULL DEFAULT 0,
    remark         TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS mesrj_idx_step_route ON proc_step(route_code, seq_no);

CREATE TABLE IF NOT EXISTS proc_station_rule (
    id           BIGSERIAL PRIMARY KEY,
    station_code TEXT    NOT NULL,
    rule_type    TEXT    NOT NULL DEFAULT '',
    rule_name    TEXT    NOT NULL DEFAULT '',
    rule_value   TEXT    NOT NULL DEFAULT '',
    enabled      INTEGER NOT NULL DEFAULT 1,
    remark       TEXT    NOT NULL DEFAULT '',
    UNIQUE (station_code, rule_type)
);

-- ── 域 7 · 生产执行 ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS prd_sn (
    id           BIGSERIAL PRIMARY KEY,
    sn           TEXT    NOT NULL UNIQUE,
    sn_type      TEXT    NOT NULL DEFAULT '整机',
    product_code TEXT    NOT NULL DEFAULT '',
    mo_no        TEXT    NOT NULL DEFAULT '',
    line_code    TEXT    NOT NULL DEFAULT '',
    cur_station  TEXT    NOT NULL DEFAULT '',
    cur_seq      INTEGER NOT NULL DEFAULT 0,
    status       TEXT    NOT NULL DEFAULT '在制',
    repair_times INTEGER NOT NULL DEFAULT 0,
    box_no       TEXT    NOT NULL DEFAULT '',
    pallet_no    TEXT    NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mesrj_idx_sn_mo ON prd_sn(mo_no);
CREATE INDEX IF NOT EXISTS mesrj_idx_sn_status ON prd_sn(status);

CREATE TABLE IF NOT EXISTS prd_sn_rel (
    id         BIGSERIAL PRIMARY KEY,
    parent_sn  TEXT    NOT NULL,
    child_sn   TEXT    NOT NULL,
    rel_type   TEXT    NOT NULL DEFAULT '',
    mo_no      TEXT    NOT NULL DEFAULT '',
    station    TEXT    NOT NULL DEFAULT '',
    operator   TEXT    NOT NULL DEFAULT '',
    is_active  INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mesrj_idx_snrel_parent ON prd_sn_rel(parent_sn);
CREATE INDEX IF NOT EXISTS mesrj_idx_snrel_child ON prd_sn_rel(child_sn);

CREATE TABLE IF NOT EXISTS prd_pass (
    id           BIGSERIAL PRIMARY KEY,
    sn           TEXT    NOT NULL,
    station_code TEXT    NOT NULL,
    line_code    TEXT    NOT NULL DEFAULT '',
    track_code   TEXT    NOT NULL DEFAULT '',
    process_code TEXT    NOT NULL DEFAULT '',
    seq_no       INTEGER NOT NULL DEFAULT 0,
    mo_no        TEXT    NOT NULL DEFAULT '',
    mark         TEXT    NOT NULL DEFAULT '',
    result       TEXT    NOT NULL DEFAULT 'OK',
    ng_code      TEXT    NOT NULL DEFAULT '',
    operator     TEXT    NOT NULL DEFAULT '',
    pass_time    TIMESTAMPTZ NOT NULL DEFAULT now(),
    forwarded    INTEGER NOT NULL DEFAULT 0,
    forward_msg  TEXT    NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mesrj_idx_pass_sn ON prd_pass(sn);
CREATE INDEX IF NOT EXISTS mesrj_idx_pass_station ON prd_pass(station_code, pass_time);

CREATE TABLE IF NOT EXISTS prd_test (
    id           BIGSERIAL PRIMARY KEY,
    sn           TEXT    NOT NULL,
    equip_code   TEXT    NOT NULL DEFAULT '',
    station_code TEXT    NOT NULL DEFAULT '',
    mo_no        TEXT    NOT NULL DEFAULT '',
    param_key    TEXT    NOT NULL DEFAULT '',
    param_val    TEXT    NOT NULL DEFAULT '',
    result       TEXT    NOT NULL DEFAULT '',
    test_time    TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mesrj_idx_test_sn ON prd_test(sn);

CREATE TABLE IF NOT EXISTS prd_defect_rec (
    id           BIGSERIAL PRIMARY KEY,
    sn           TEXT    NOT NULL,
    defect_code  TEXT    NOT NULL,
    station_code TEXT    NOT NULL DEFAULT '',
    process_code TEXT    NOT NULL DEFAULT '',
    mo_no        TEXT    NOT NULL DEFAULT '',
    root_cause   TEXT    NOT NULL DEFAULT '',
    handle       TEXT    NOT NULL DEFAULT '待处理',
    repair_times INTEGER NOT NULL DEFAULT 0,
    operator     TEXT    NOT NULL DEFAULT '',
    defect_time  TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mesrj_idx_defect_sn ON prd_defect_rec(sn);

CREATE TABLE IF NOT EXISTS prd_repair (
    id           BIGSERIAL PRIMARY KEY,
    sn           TEXT    NOT NULL,
    repair_times INTEGER NOT NULL DEFAULT 0,
    station_code TEXT    NOT NULL DEFAULT '',
    defect_code  TEXT    NOT NULL DEFAULT '',
    root_cause   TEXT    NOT NULL DEFAULT '',
    action       TEXT    NOT NULL DEFAULT '',
    result       TEXT    NOT NULL DEFAULT '',
    repair_by    TEXT    NOT NULL DEFAULT '',
    repair_time  TIMESTAMPTZ NOT NULL DEFAULT now(),
    remark       TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS mesrj_idx_repair_sn ON prd_repair(sn);

CREATE TABLE IF NOT EXISTS prd_scrap (
    id           BIGSERIAL PRIMARY KEY,
    sn           TEXT    NOT NULL,
    scrap_code   TEXT    NOT NULL DEFAULT '',
    reason       TEXT    NOT NULL DEFAULT '',
    station_code TEXT    NOT NULL DEFAULT '',
    mo_no        TEXT    NOT NULL DEFAULT '',
    approved_by  TEXT    NOT NULL DEFAULT '',
    scrap_time   TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS prd_decode (
    id           BIGSERIAL PRIMARY KEY,
    sn           TEXT    NOT NULL,
    station_code TEXT    NOT NULL DEFAULT '',
    reason       TEXT    NOT NULL DEFAULT '',
    apply_by     TEXT    NOT NULL DEFAULT '',
    approve_by   TEXT    NOT NULL DEFAULT '',
    status       TEXT    NOT NULL DEFAULT '待审',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS prd_box (
    id          BIGSERIAL PRIMARY KEY,
    box_no      TEXT    NOT NULL UNIQUE,
    mo_no       TEXT    NOT NULL DEFAULT '',
    po_no       TEXT    NOT NULL DEFAULT '',
    product_code TEXT   NOT NULL DEFAULT '',
    qty         INTEGER NOT NULL DEFAULT 0,
    capacity    INTEGER NOT NULL DEFAULT 0,
    sn_list     TEXT    NOT NULL DEFAULT '',
    status      TEXT    NOT NULL DEFAULT '装箱中',
    pallet_no   TEXT    NOT NULL DEFAULT '',
    tpl_code    TEXT    NOT NULL DEFAULT '',
    print_times INTEGER NOT NULL DEFAULT 0,
    created_by  TEXT    NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS prd_pallet (
    id               BIGSERIAL PRIMARY KEY,
    pallet_no        TEXT    NOT NULL UNIQUE,
    mo_no            TEXT    NOT NULL DEFAULT '',
    po_no            TEXT    NOT NULL DEFAULT '',
    cust_code        TEXT    NOT NULL DEFAULT '',
    product_code     TEXT    NOT NULL DEFAULT '',
    capacity         INTEGER NOT NULL DEFAULT 0,
    box_count        INTEGER NOT NULL DEFAULT 0,
    total_qty        INTEGER NOT NULL DEFAULT 0,
    box_list         TEXT    NOT NULL DEFAULT '',
    status           TEXT    NOT NULL DEFAULT '装板中',
    tpl_code         TEXT    NOT NULL DEFAULT '',
    print_times      INTEGER NOT NULL DEFAULT 0,
    ship_to          TEXT    NOT NULL DEFAULT '',
    subordinate_name TEXT    NOT NULL DEFAULT '',
    sub_po           TEXT    NOT NULL DEFAULT '',
    pallet_x         TEXT    NOT NULL DEFAULT '',
    pallet_y         TEXT    NOT NULL DEFAULT '',
    created_by       TEXT    NOT NULL DEFAULT '',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mesrj_idx_pallet_mo ON prd_pallet(mo_no);

-- ── 域 8 · 配置中心（打印/包装/绑码部分，原 schema 就插在此处） ─────────────

CREATE TABLE IF NOT EXISTS cfg_print_tpl (
    id           BIGSERIAL PRIMARY KEY,
    tpl_code     TEXT    NOT NULL UNIQUE,
    tpl_name     TEXT    NOT NULL DEFAULT '',
    tpl_type     TEXT    NOT NULL DEFAULT '外箱标签',
    product_code TEXT    NOT NULL DEFAULT '',
    file_name    TEXT    NOT NULL DEFAULT '',
    fields       TEXT    NOT NULL DEFAULT '[]',
    enabled      INTEGER NOT NULL DEFAULT 1,
    sort_no      INTEGER NOT NULL DEFAULT 0,
    remark       TEXT    NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS cfg_pack_rule (
    id                 BIGSERIAL PRIMARY KEY,
    product_code       TEXT    NOT NULL UNIQUE,
    machine_model      TEXT    NOT NULL DEFAULT '',
    oem_code           TEXT    NOT NULL DEFAULT 'N',
    model_code         TEXT    NOT NULL DEFAULT '',
    factory_code       TEXT    NOT NULL DEFAULT 'V',
    supplier_code      TEXT    NOT NULL DEFAULT 'NBT',
    carton_qty         INTEGER NOT NULL DEFAULT 0,
    cartons_per_pallet INTEGER NOT NULL DEFAULT 0,
    wireline_sku       TEXT    NOT NULL DEFAULT '',
    consumer_sku       TEXT    NOT NULL DEFAULT '',
    carton_tpl_code    TEXT    NOT NULL DEFAULT '',
    pallet_tpl_code    TEXT    NOT NULL DEFAULT '',
    sn_prefix          TEXT    NOT NULL DEFAULT '',
    enabled            INTEGER NOT NULL DEFAULT 1,
    remark             TEXT    NOT NULL DEFAULT '',
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cfg_pcb_code (
    id               BIGSERIAL PRIMARY KEY,
    product_code     TEXT    NOT NULL UNIQUE,
    machine_model    TEXT    NOT NULL DEFAULT '',
    pcb_code         TEXT    NOT NULL DEFAULT '',
    laser_machine_no TEXT    NOT NULL DEFAULT '',
    charset_note     TEXT    NOT NULL DEFAULT '',
    enabled          INTEGER NOT NULL DEFAULT 1,
    remark           TEXT    NOT NULL DEFAULT '',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cfg_bind_station (
    id           BIGSERIAL PRIMARY KEY,
    station_code TEXT    NOT NULL UNIQUE,
    station_name TEXT    NOT NULL DEFAULT '',
    rel_type     TEXT    NOT NULL DEFAULT '',
    old_label    TEXT    NOT NULL DEFAULT 'SN OLD',
    old_hint     TEXT    NOT NULL DEFAULT '',
    old_sn_type  TEXT    NOT NULL DEFAULT '',
    new_label    TEXT    NOT NULL DEFAULT 'SN NEW',
    new_hint     TEXT    NOT NULL DEFAULT '',
    new_sn_type  TEXT    NOT NULL DEFAULT '',
    auto_pass    INTEGER NOT NULL DEFAULT 0,
    enabled      INTEGER NOT NULL DEFAULT 1,
    sort_no      INTEGER NOT NULL DEFAULT 10,
    remark       TEXT    NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cfg_bind_rule (
    id            BIGSERIAL PRIMARY KEY,
    station_code  TEXT    NOT NULL,
    role          TEXT    NOT NULL,
    sn_type       TEXT    NOT NULL DEFAULT '',
    label         TEXT    NOT NULL DEFAULT '',
    hint          TEXT    NOT NULL DEFAULT '',
    check_len     INTEGER NOT NULL DEFAULT 0,
    prefix        TEXT    NOT NULL DEFAULT '',
    regex         TEXT    NOT NULL DEFAULT '',
    require_exist INTEGER NOT NULL DEFAULT 0,
    auto_create   INTEGER NOT NULL DEFAULT 0,
    enabled       INTEGER NOT NULL DEFAULT 1,
    remark        TEXT    NOT NULL DEFAULT '',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS mesrj_ux_bind_rule ON cfg_bind_rule(station_code, role);

-- 设备接口密钥（同构网关的 X-Api-Key）
CREATE TABLE IF NOT EXISTS sys_api_key (
    id         BIGSERIAL PRIMARY KEY,
    api_key    TEXT    NOT NULL UNIQUE,
    name       TEXT    NOT NULL DEFAULT '',
    enabled    INTEGER NOT NULL DEFAULT 1,
    remark     TEXT    NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS prd_pass_check (
    id           BIGSERIAL PRIMARY KEY,
    mark         TEXT    NOT NULL UNIQUE,
    sn           TEXT    NOT NULL,
    station_code TEXT    NOT NULL DEFAULT '',
    line_sn      TEXT    NOT NULL DEFAULT '',
    track        TEXT    NOT NULL DEFAULT '',
    mo_no        TEXT    NOT NULL DEFAULT '',
    result_msg   TEXT    NOT NULL DEFAULT '',
    ok           INTEGER NOT NULL DEFAULT 1,
    used         INTEGER NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mesrj_idx_passcheck_sn ON prd_pass_check(sn);

CREATE TABLE IF NOT EXISTS prd_machine_data (
    id           BIGSERIAL PRIMARY KEY,
    sn           TEXT    NOT NULL,
    machine_no   TEXT    NOT NULL DEFAULT '',
    machine_type TEXT    NOT NULL DEFAULT '',
    product_no   TEXT    NOT NULL DEFAULT '',
    version      TEXT    NOT NULL DEFAULT '',
    lot_no       TEXT    NOT NULL DEFAULT '',
    loader_no    TEXT    NOT NULL DEFAULT '',
    station_code TEXT    NOT NULL DEFAULT '',
    line_sn      TEXT    NOT NULL DEFAULT '',
    track        TEXT    NOT NULL DEFAULT '',
    mo_no        TEXT    NOT NULL DEFAULT '',
    seq          TEXT    NOT NULL DEFAULT '',
    begin_time   TEXT    NOT NULL DEFAULT '',
    end_time     TEXT    NOT NULL DEFAULT '',
    location     TEXT    NOT NULL DEFAULT '',
    channel      TEXT    NOT NULL DEFAULT '',
    pass_ng      TEXT    NOT NULL DEFAULT '',
    ng_info      TEXT    NOT NULL DEFAULT '',
    create_by    TEXT    NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mesrj_idx_machinedata_sn ON prd_machine_data(sn);

CREATE TABLE IF NOT EXISTS prd_print_job (
    id         BIGSERIAL PRIMARY KEY,
    job_no     TEXT    NOT NULL UNIQUE,
    box_no     TEXT    NOT NULL DEFAULT '',
    ref_type   TEXT    NOT NULL DEFAULT 'box',
    ref_no     TEXT    NOT NULL DEFAULT '',
    tpl_code   TEXT    NOT NULL DEFAULT '',
    payload    TEXT    NOT NULL DEFAULT '{}',
    status     TEXT    NOT NULL DEFAULT '待打印',
    created_by TEXT    NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    printed_at TIMESTAMPTZ,
    print_msg  TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS mesrj_idx_print_job_box ON prd_print_job(box_no);

CREATE TABLE IF NOT EXISTS prd_mo_route (
    id         BIGSERIAL PRIMARY KEY,
    mo_no      TEXT    NOT NULL UNIQUE,
    route_code TEXT    NOT NULL DEFAULT '',
    route_name TEXT    NOT NULL DEFAULT '',
    version    TEXT    NOT NULL DEFAULT '',
    snapshot   TEXT    NOT NULL DEFAULT '[]',
    step_count INTEGER NOT NULL DEFAULT 0,
    is_locked  INTEGER NOT NULL DEFAULT 1,
    locked_by  TEXT    NOT NULL DEFAULT '',
    locked_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    remark     TEXT    NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS prd_route_change (
    id           BIGSERIAL PRIMARY KEY,
    mo_no        TEXT    NOT NULL,
    change_type  TEXT    NOT NULL DEFAULT '切换路线',
    old_route    TEXT    NOT NULL DEFAULT '',
    new_route    TEXT    NOT NULL DEFAULT '',
    old_snapshot TEXT    NOT NULL DEFAULT '',
    new_snapshot TEXT    NOT NULL DEFAULT '',
    reason       TEXT    NOT NULL DEFAULT '',
    apply_by     TEXT    NOT NULL DEFAULT '',
    approve_by   TEXT    NOT NULL DEFAULT '',
    status       TEXT    NOT NULL DEFAULT '已生效',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mesrj_idx_routechg_mo ON prd_route_change(mo_no);

CREATE TABLE IF NOT EXISTS prd_pass_release (
    id           BIGSERIAL PRIMARY KEY,
    release_no   TEXT    NOT NULL UNIQUE,
    scope        TEXT    NOT NULL DEFAULT '按SN',
    mo_no        TEXT    NOT NULL DEFAULT '',
    sn           TEXT    NOT NULL DEFAULT '',
    station_code TEXT    NOT NULL DEFAULT '',
    valid_from   TEXT    NOT NULL DEFAULT '',
    valid_to     TEXT    NOT NULL DEFAULT '',
    max_times    INTEGER NOT NULL DEFAULT 1,
    used_times   INTEGER NOT NULL DEFAULT 0,
    reason       TEXT    NOT NULL DEFAULT '',
    apply_by     TEXT    NOT NULL DEFAULT '',
    approve_by   TEXT    NOT NULL DEFAULT '',
    status       TEXT    NOT NULL DEFAULT '待审',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mesrj_idx_release_sn ON prd_pass_release(sn, station_code);

CREATE TABLE IF NOT EXISTS prd_skip_log (
    id           BIGSERIAL PRIMARY KEY,
    sn           TEXT    NOT NULL,
    station_code TEXT    NOT NULL,
    mo_no        TEXT    NOT NULL DEFAULT '',
    skip_type    TEXT    NOT NULL DEFAULT '扫码跳过',
    release_no   TEXT    NOT NULL DEFAULT '',
    reason       TEXT    NOT NULL DEFAULT '',
    operator     TEXT    NOT NULL DEFAULT '',
    skip_time    TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mesrj_idx_skiplog_sn ON prd_skip_log(sn);

-- ── 域 8 · 配置中心 ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cfg_sn_rule (
    id          BIGSERIAL PRIMARY KEY,
    sn_type     TEXT    NOT NULL DEFAULT '整机',
    prefix      TEXT    NOT NULL DEFAULT '',
    total_len   INTEGER NOT NULL DEFAULT 16,
    segments    TEXT    NOT NULL DEFAULT '',
    reset_cycle TEXT    NOT NULL DEFAULT 'DAY',
    cur_seq     INTEGER NOT NULL DEFAULT 0,
    sample      TEXT    NOT NULL DEFAULT '',
    enabled     INTEGER NOT NULL DEFAULT 1,
    remark      TEXT    NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS cfg_threshold (
    id      BIGSERIAL PRIMARY KEY,
    th_key  TEXT    NOT NULL UNIQUE,
    th_name TEXT    NOT NULL DEFAULT '',
    th_value DOUBLE PRECISION NOT NULL DEFAULT 0,
    th_unit TEXT    NOT NULL DEFAULT 'H',
    apply_to TEXT   NOT NULL DEFAULT '',
    action  TEXT    NOT NULL DEFAULT '预警',
    enabled INTEGER NOT NULL DEFAULT 1,
    remark  TEXT    NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS cfg_pokayoke (
    id         BIGSERIAL PRIMARY KEY,
    rule_key   TEXT    NOT NULL UNIQUE,
    rule_name  TEXT    NOT NULL DEFAULT '',
    rule_value TEXT    NOT NULL DEFAULT '',
    scope      TEXT    NOT NULL DEFAULT '全局',
    enabled    INTEGER NOT NULL DEFAULT 1,
    remark     TEXT    NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS cfg_code_dict (
    id      BIGSERIAL PRIMARY KEY,
    dict_type TEXT  NOT NULL,
    code    TEXT    NOT NULL,
    name    TEXT    NOT NULL DEFAULT '',
    sort_no INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    remark  TEXT    NOT NULL DEFAULT '',
    UNIQUE (dict_type, code)
);

-- ── 域 9 · 接口对接 ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS itf_api_config (
    id        BIGSERIAL PRIMARY KEY,
    api_name  TEXT    NOT NULL DEFAULT '',
    base_url  TEXT    NOT NULL DEFAULT '',
    api_key   TEXT    NOT NULL DEFAULT '',
    timeout   INTEGER NOT NULL DEFAULT 10,
    use_proxy INTEGER NOT NULL DEFAULT 0,
    enabled   INTEGER NOT NULL DEFAULT 1,
    remark    TEXT    NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS itf_api_log (
    id          BIGSERIAL PRIMARY KEY,
    direction   TEXT    NOT NULL DEFAULT 'OUT',
    api_path    TEXT    NOT NULL DEFAULT '',
    method      TEXT    NOT NULL DEFAULT '',
    req_body    TEXT    NOT NULL DEFAULT '',
    resp_body   TEXT    NOT NULL DEFAULT '',
    http_status INTEGER NOT NULL DEFAULT 0,
    success     INTEGER NOT NULL DEFAULT 0,
    cost_ms     INTEGER NOT NULL DEFAULT 0,
    sn          TEXT    NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mesrj_idx_apilog_created ON itf_api_log(created_at);

-- ── SMT-AOI 检测数据（AOI 上位机 JSON，tools/sync_aoi.py 解析入库） ────────

CREATE TABLE IF NOT EXISTS prd_aoi_result (
    id              BIGSERIAL PRIMARY KEY,
    file_name       TEXT NOT NULL,
    device_name     TEXT,
    pcb_sn          TEXT,
    project_name    TEXT,
    track_line      TEXT,
    board_side      TEXT,
    test_time       TIMESTAMPTZ,
    cycle_time      DOUBLE PRECISION,
    robot_result    TEXT,
    user_result     TEXT,
    final_result    TEXT,
    repair_user     TEXT,
    board_number    INTEGER,
    board_ng_number INTEGER,
    comp_number     INTEGER,
    comp_ng_number  INTEGER,
    image_path      TEXT,
    raw_json        TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS mesrj_ux_aoi_file ON prd_aoi_result(file_name);
CREATE INDEX IF NOT EXISTS mesrj_ix_aoi_sn ON prd_aoi_result(pcb_sn);
CREATE INDEX IF NOT EXISTS mesrj_ix_aoi_time ON prd_aoi_result(test_time);

CREATE TABLE IF NOT EXISTS prd_aoi_comp (
    id             BIGSERIAL PRIMARY KEY,
    aoi_id         BIGINT,
    file_name      TEXT,
    pcb_sn         TEXT,
    board_no       TEXT,
    board_result   TEXT,
    comp_designator TEXT,
    comp_part      TEXT,
    comp_package   TEXT,
    comp_type      TEXT,
    robot_code     TEXT,
    robot_result   TEXT,
    user_code      TEXT,
    user_result    TEXT,
    image_path     TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mesrj_ix_aoi_comp_aoi ON prd_aoi_comp(aoi_id);
CREATE INDEX IF NOT EXISTS mesrj_ix_aoi_comp_sn ON prd_aoi_comp(pcb_sn);

-- 拼板级（子板）：一片一行，厂商 JSON 的 board_data[]
CREATE TABLE IF NOT EXISTS prd_aoi_board (
    id           BIGSERIAL PRIMARY KEY,
    aoi_id       BIGINT,
    file_name    TEXT,
    pcb_sn       TEXT,
    board_no     TEXT,
    board_sn     TEXT,
    robot_result TEXT,
    user_result  TEXT,
    final_result TEXT,
    ng_comp_number INTEGER DEFAULT 0,
    test_time    TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(file_name, board_no)
);
CREATE INDEX IF NOT EXISTS mesrj_ix_aoi_board_sn ON prd_aoi_board(board_sn);
CREATE INDEX IF NOT EXISTS mesrj_ix_aoi_board_pcb ON prd_aoi_board(pcb_sn);

CREATE TABLE IF NOT EXISTS cfg_aoi_defect (
    id       BIGSERIAL PRIMARY KEY,
    code     TEXT NOT NULL UNIQUE,
    name_en  TEXT DEFAULT '',
    name_zh  TEXT NOT NULL DEFAULT '',
    category TEXT DEFAULT '',
    remark   TEXT DEFAULT '',
    status   INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS cfg_aoi_comp_map (
    id         BIGSERIAL PRIMARY KEY,
    model      TEXT NOT NULL DEFAULT '',
    comp_id    TEXT NOT NULL,
    designator TEXT NOT NULL,
    part_no    TEXT DEFAULT '',
    package    TEXT DEFAULT '',
    comp_type  TEXT DEFAULT '',
    remark     TEXT DEFAULT '',
    UNIQUE(model, comp_id)
);
CREATE INDEX IF NOT EXISTS mesrj_ix_aoi_comp_map_md ON cfg_aoi_comp_map(model, comp_id);
