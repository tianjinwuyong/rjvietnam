-- W9: 员工资质 (emp) + 工程变更 (ecn) 表
-- 源：D:\rj\repos\MES-ruijing\core\emp.py (ensure) + core\ecn.py (ensure)
-- PG 方言：bigserial PK，timestamptz 文本列兼容源 TEXT + now()

-- ── emp: md_employee 员工档案 ──
CREATE TABLE IF NOT EXISTS md_employee (
    id         bigserial PRIMARY KEY,
    emp_no     varchar NOT NULL UNIQUE,
    emp_name   varchar NOT NULL DEFAULT '',
    dept       varchar NOT NULL DEFAULT '',
    post       varchar NOT NULL DEFAULT '',
    line_code  varchar NOT NULL DEFAULT '',
    phone      varchar NOT NULL DEFAULT '',
    status     int NOT NULL DEFAULT 1,
    hire_date  varchar NOT NULL DEFAULT '',
    remark     varchar NOT NULL DEFAULT '',
    created_at varchar NOT NULL DEFAULT '',
    updated_at varchar NOT NULL DEFAULT ''
);

-- ── emp: cfg_skill 资质项 ──
CREATE TABLE IF NOT EXISTS cfg_skill (
    id           bigserial PRIMARY KEY,
    skill_code   varchar NOT NULL UNIQUE,
    skill_name   varchar NOT NULL DEFAULT '',
    process_code varchar NOT NULL DEFAULT '',
    sort_no      int NOT NULL DEFAULT 0,
    enabled      int NOT NULL DEFAULT 1,
    remark       varchar NOT NULL DEFAULT ''
);

-- ── emp: cfg_station_skill 工位资质要求 ──
CREATE TABLE IF NOT EXISTS cfg_station_skill (
    id           bigserial PRIMARY KEY,
    station_code varchar NOT NULL DEFAULT '',
    type_code    varchar NOT NULL DEFAULT '',
    skill_code   varchar NOT NULL DEFAULT '',
    remark       varchar NOT NULL DEFAULT ''
);

-- ── emp: prd_emp_cert 员工持证 ──
CREATE TABLE IF NOT EXISTS prd_emp_cert (
    id          bigserial PRIMARY KEY,
    emp_no      varchar NOT NULL,
    skill_code  varchar NOT NULL,
    level       int NOT NULL DEFAULT 1,
    pass_date   varchar NOT NULL DEFAULT '',
    expire_date varchar NOT NULL DEFAULT '',
    status      varchar NOT NULL DEFAULT '合格',
    skill_name  varchar NOT NULL DEFAULT '',
    exam_score  real,
    source      varchar NOT NULL DEFAULT '',
    remark      varchar NOT NULL DEFAULT '',
    updated_at  varchar NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_emp_cert ON prd_emp_cert(emp_no, skill_code);

-- ── emp: prd_emp_exam 考核记录 ──
CREATE TABLE IF NOT EXISTS prd_emp_exam (
    id         bigserial PRIMARY KEY,
    emp_no     varchar NOT NULL DEFAULT '',
    emp_name   varchar NOT NULL DEFAULT '',
    skill_code varchar NOT NULL DEFAULT '',
    exam_date  varchar NOT NULL DEFAULT '',
    score      real,
    pass       int NOT NULL DEFAULT 0,
    examiner   varchar NOT NULL DEFAULT '',
    remark     varchar NOT NULL DEFAULT '',
    created_at varchar NOT NULL DEFAULT ''
);

-- ── emp: prd_emp_login 上岗记录 ──
CREATE TABLE IF NOT EXISTS prd_emp_login (
    id           bigserial PRIMARY KEY,
    emp_no       varchar NOT NULL DEFAULT '',
    emp_name     varchar NOT NULL DEFAULT '',
    station_code varchar NOT NULL DEFAULT '',
    line_code    varchar NOT NULL DEFAULT '',
    work_date    varchar NOT NULL DEFAULT '',
    shift_code   varchar NOT NULL DEFAULT '',
    in_at        varchar NOT NULL DEFAULT '',
    out_at       varchar NOT NULL DEFAULT '',
    status       varchar NOT NULL DEFAULT '在岗',
    bind_by      varchar NOT NULL DEFAULT '',
    remark       varchar NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_emp_login ON prd_emp_login(station_code, status);

-- ── emp: prd_emp_auth 临时授权 ──
CREATE TABLE IF NOT EXISTS prd_emp_auth (
    id            bigserial PRIMARY KEY,
    emp_no        varchar NOT NULL DEFAULT '',
    station_code  varchar NOT NULL DEFAULT '',
    skill_code    varchar NOT NULL DEFAULT '',
    authorized_by varchar NOT NULL DEFAULT '',
    reason        varchar NOT NULL DEFAULT '',
    expire_at     varchar NOT NULL DEFAULT '',
    status        varchar NOT NULL DEFAULT '有效',
    created_at    varchar NOT NULL DEFAULT ''
);

-- ── ecn: eng_change 变更单 ──
CREATE TABLE IF NOT EXISTS eng_change (
    id              bigserial PRIMARY KEY,
    ecn_no          varchar NOT NULL UNIQUE,
    ecn_type        varchar NOT NULL DEFAULT 'ECN',
    title           varchar NOT NULL DEFAULT '',
    change_reason   varchar NOT NULL DEFAULT '',
    reason_note     varchar NOT NULL DEFAULT '',
    customer_code   varchar NOT NULL DEFAULT '',
    ref_no          varchar NOT NULL DEFAULT '',
    product_code    varchar NOT NULL DEFAULT '',
    product_model   varchar NOT NULL DEFAULT '',
    po_no           varchar NOT NULL DEFAULT '',
    line_code       varchar NOT NULL DEFAULT '',
    bom_from        varchar NOT NULL DEFAULT '',
    bom_to          varchar NOT NULL DEFAULT '',
    old_material    varchar NOT NULL DEFAULT '',
    new_material    varchar NOT NULL DEFAULT '',
    old_qty         real NOT NULL DEFAULT 0,
    new_qty         real NOT NULL DEFAULT 0,
    unit            varchar NOT NULL DEFAULT 'PCS',
    before_desc     varchar NOT NULL DEFAULT '',
    after_desc      varchar NOT NULL DEFAULT '',
    effectivity     varchar NOT NULL DEFAULT 'now',
    effective_date  varchar NOT NULL DEFAULT '',
    effective_mo_no varchar NOT NULL DEFAULT '',
    risk_level      varchar NOT NULL DEFAULT '中',
    need_fai        int NOT NULL DEFAULT 1,
    need_customer   int NOT NULL DEFAULT 0,
    block_pass      int NOT NULL DEFAULT 0,
    status          varchar NOT NULL DEFAULT '草稿',
    owner           varchar NOT NULL DEFAULT '',
    dept            varchar NOT NULL DEFAULT '',
    impact_json     varchar NOT NULL DEFAULT '',
    fai_result      varchar NOT NULL DEFAULT '',
    fai_note        varchar NOT NULL DEFAULT '',
    verify_result   varchar NOT NULL DEFAULT '',
    verify_note     varchar NOT NULL DEFAULT '',
    customer_reply  varchar NOT NULL DEFAULT '',
    customer_reply_at varchar NOT NULL DEFAULT '',
    customer_approver varchar NOT NULL DEFAULT '',
    created_by      varchar NOT NULL DEFAULT '',
    created_at      varchar NOT NULL DEFAULT '',
    updated_at      varchar NOT NULL DEFAULT '',
    submitted_at    varchar NOT NULL DEFAULT '',
    approved_at     varchar NOT NULL DEFAULT '',
    approved_by     varchar NOT NULL DEFAULT '',
    effective_at    varchar NOT NULL DEFAULT '',
    closed_at       varchar NOT NULL DEFAULT '',
    closed_by       varchar NOT NULL DEFAULT ''
);

-- ── ecn: eng_change_item 执行项 ──
CREATE TABLE IF NOT EXISTS eng_change_item (
    id          bigserial PRIMARY KEY,
    ecn_no      varchar NOT NULL,
    seq_no      int NOT NULL DEFAULT 0,
    item_type   varchar NOT NULL DEFAULT '',
    target      varchar NOT NULL DEFAULT '',
    before_val  varchar NOT NULL DEFAULT '',
    after_val   varchar NOT NULL DEFAULT '',
    action      varchar NOT NULL DEFAULT '',
    owner       varchar NOT NULL DEFAULT '',
    done        int NOT NULL DEFAULT 0,
    done_at     varchar NOT NULL DEFAULT '',
    done_by     varchar NOT NULL DEFAULT '',
    remark      varchar NOT NULL DEFAULT ''
);

-- ── ecn: eng_change_flow 流转记录 ──
CREATE TABLE IF NOT EXISTS eng_change_flow (
    id      bigserial PRIMARY KEY,
    ecn_no  varchar NOT NULL,
    node    varchar NOT NULL DEFAULT '',
    action  varchar NOT NULL DEFAULT '',
    actor   varchar NOT NULL DEFAULT '',
    opinion varchar NOT NULL DEFAULT '',
    at      varchar NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_ecn_status ON eng_change(status);
CREATE INDEX IF NOT EXISTS idx_ecn_product ON eng_change(product_code);
CREATE INDEX IF NOT EXISTS idx_ecn_item ON eng_change_item(ecn_no);
CREATE INDEX IF NOT EXISTS idx_ecn_flow ON eng_change_flow(ecn_no);
