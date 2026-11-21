-- W10: 辅料管控 (smta) 表 —— 锡膏/红胶回温追溯、钢网寿命、刮刀寿命、SMT 站位绑码
-- 源：D:\rj\repos\MES-ruijing\api\smta.py + core\feeder_slot.py + core\gkg.py
--      DDL 取自源 工具\测试联调\test_supply_mo.py / test_feeder_slot.py（源库为 SQLite，
--      其余 4 张表在源仓库无 DDL —— 由客户生产库手工建 —— 字段按代码用法反推）
-- PG 方言：bigserial PK；文本/日期列一律 varchar（源为 TEXT，保留 'YYYY-MM-DD' 字符串语义）
--
-- ⚠ 与 SMT 侧既有表的关系（收敛说明）：
--    · cfg_threshold  —— SMT 已有且字段一致，**直接复用，不重复建表**
--    · consumables / solder_paste_* —— SMT 侧是「设备保养 / 仓库」视角
--      （item_code、unit_cost、qty_kg、equipment_asset_id），与源的「产线作业追溯」视角
--      （stencil_no 分面机型、回温/待用时限、上机绑定机位）主键与生命周期语义不同，
--      本波按 mesrj 子系统既有惯例保真移植源表，不做跨系统硬合并。

-- ── 一、锡膏 / 红胶 ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS prd_paste (
    id            bigserial PRIMARY KEY,
    batch_no      varchar NOT NULL UNIQUE,
    paste_type    varchar NOT NULL DEFAULT '',      -- 红胶 / 锡膏
    material_code varchar NOT NULL DEFAULT '',
    product_name  varchar NOT NULL DEFAULT '',
    supplier      varchar NOT NULL DEFAULT '',
    arrive_date   varchar NOT NULL DEFAULT '',
    expire_date   varchar NOT NULL DEFAULT '',
    storage_temp  varchar NOT NULL DEFAULT '',
    init_qty      real NOT NULL DEFAULT 0,
    left_qty      real NOT NULL DEFAULT 0,
    status        varchar NOT NULL DEFAULT '在库',   -- 在库/回温中/待用/使用中/已用完/已报废/退回
    place         varchar NOT NULL DEFAULT '',
    operator      varchar NOT NULL DEFAULT '',
    remark        varchar NOT NULL DEFAULT '',
    created_at    varchar NOT NULL DEFAULT '',
    updated_at    varchar NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS prd_paste_log (
    id         bigserial PRIMARY KEY,
    batch_no   varchar NOT NULL DEFAULT '',
    paste_type varchar NOT NULL DEFAULT '',
    log_type   varchar NOT NULL DEFAULT '',         -- WARM 回温 / USE 上线使用
    start_time varchar NOT NULL DEFAULT '',
    end_time   varchar NOT NULL DEFAULT '',
    duration_h real NOT NULL DEFAULT 0,
    std_hours  real NOT NULL DEFAULT 0,
    is_ok      int NOT NULL DEFAULT 0,
    temp_c     real NOT NULL DEFAULT 0,
    qty        real NOT NULL DEFAULT 0,
    dispose    varchar NOT NULL DEFAULT '',          -- 回收 / 用完 / 报废
    mo_no      varchar NOT NULL DEFAULT '',
    line_code  varchar NOT NULL DEFAULT '',
    machine_no varchar NOT NULL DEFAULT '',
    shift      varchar NOT NULL DEFAULT '',
    operator   varchar NOT NULL DEFAULT '',
    remark     varchar NOT NULL DEFAULT '',
    created_at varchar NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_paste_log_batch ON prd_paste_log(batch_no, log_type);
CREATE INDEX IF NOT EXISTS ix_paste_log_mo ON prd_paste_log(mo_no);

-- 辅料时间参数（回温/待用/开盖/有效期），全部可调，不写死在代码里
CREATE TABLE IF NOT EXISTS cfg_paste_param (
    id           bigserial PRIMARY KEY,
    paste_type   varchar NOT NULL UNIQUE,
    storage_min  real NOT NULL DEFAULT 2,            -- 储存温度下限 ℃
    storage_max  real NOT NULL DEFAULT 10,           -- 储存温度上限 ℃
    warm_hours   real NOT NULL DEFAULT 4,            -- 回温标准时长（小时）
    wait_hours   real NOT NULL DEFAULT 8,            -- 回温后可待用时限（小时）
    open_hours   real NOT NULL DEFAULT 8,            -- 开盖使用时限（小时）
    valid_months int NOT NULL DEFAULT 6,             -- 有效期（月）
    warn_days    int NOT NULL DEFAULT 7,             -- 临期预警天数
    created_at   varchar NOT NULL DEFAULT '',
    updated_at   varchar NOT NULL DEFAULT ''
);

INSERT INTO cfg_paste_param (paste_type, storage_min, storage_max, warm_hours, wait_hours, open_hours, valid_months, warn_days, created_at, updated_at)
VALUES ('红胶', 2, 10, 4, 8, 8, 6, 7, to_char(now(), 'YYYY-MM-DD HH24:MI:SS'), to_char(now(), 'YYYY-MM-DD HH24:MI:SS')),
       ('锡膏', 2, 10, 4, 8, 8, 6, 7, to_char(now(), 'YYYY-MM-DD HH24:MI:SS'), to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))
ON CONFLICT (paste_type) DO NOTHING;

-- ── 二、钢网（寿命按印刷次数）────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS prd_stencil (
    id                 bigserial PRIMARY KEY,
    sn                 varchar NOT NULL DEFAULT '',
    stencil_no         varchar NOT NULL DEFAULT '',
    version            varchar NOT NULL DEFAULT '',
    thickness          varchar NOT NULL DEFAULT '',
    models             varchar NOT NULL DEFAULT '',  -- 适用系列
    model              varchar NOT NULL DEFAULT '',  -- 适用具体面（PCB1 / PCB2）
    gerber_version     varchar NOT NULL DEFAULT '',
    max_print_times    int NOT NULL DEFAULT 0,
    used_print_times   int NOT NULL DEFAULT 0,
    clean_warn_times   int NOT NULL DEFAULT 0,
    deep_clean_times   int NOT NULL DEFAULT 0,
    clean_count        int NOT NULL DEFAULT 0,
    warn_pct           real NOT NULL DEFAULT 80,
    status             varchar NOT NULL DEFAULT '在用',
    scrap_reason       varchar NOT NULL DEFAULT '',
    scrap_by           varchar NOT NULL DEFAULT '',
    scrap_at           varchar NOT NULL DEFAULT '',
    buy_date           varchar NOT NULL DEFAULT '',
    supplier           varchar NOT NULL DEFAULT '',
    price              real NOT NULL DEFAULT 0,
    place              varchar NOT NULL DEFAULT '',
    owner              varchar NOT NULL DEFAULT '',
    size_mm            varchar NOT NULL DEFAULT '',
    material           varchar NOT NULL DEFAULT '',
    remark             varchar NOT NULL DEFAULT '',
    created_at         varchar NOT NULL DEFAULT '',
    updated_at         varchar NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_stencil_no ON prd_stencil(stencil_no);

CREATE TABLE IF NOT EXISTS prd_stencil_bind (
    id            bigserial PRIMARY KEY,
    stencil_sn    varchar NOT NULL DEFAULT '',
    machine_no    varchar NOT NULL DEFAULT '',
    mo_no         varchar NOT NULL DEFAULT '',
    line_no       varchar NOT NULL DEFAULT '',
    used_in_round int NOT NULL DEFAULT 0,
    clean_in_round int NOT NULL DEFAULT 0,
    online_time   varchar NOT NULL DEFAULT '',
    offline_time  varchar NOT NULL DEFAULT '',
    operator      varchar NOT NULL DEFAULT '',
    status        varchar NOT NULL DEFAULT '使用中',  -- 使用中 / 已下线
    created_at    varchar NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_stencil_bind_sn ON prd_stencil_bind(stencil_sn, status);

CREATE TABLE IF NOT EXISTS prd_stencil_clean (
    id          bigserial PRIMARY KEY,
    stencil_sn  varchar NOT NULL DEFAULT '',
    clean_type  varchar NOT NULL DEFAULT '',
    clean_method varchar NOT NULL DEFAULT '',
    clean_time  varchar NOT NULL DEFAULT '',
    operator    varchar NOT NULL DEFAULT '',
    created_at  varchar NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_stencil_clean_sn ON prd_stencil_clean(stencil_sn);

-- ── 三、刮刀（寿命同上，且带「上机 / 下机」绑定）────────────────────────────
CREATE TABLE IF NOT EXISTS md_squeegee (
    id         bigserial PRIMARY KEY,
    sq_no      varchar NOT NULL UNIQUE,
    spec       varchar NOT NULL DEFAULT '',
    material   varchar NOT NULL DEFAULT '',
    model      varchar NOT NULL DEFAULT '',
    position   varchar NOT NULL DEFAULT '',           -- 前 / 后（一台印刷机两把）
    buy_date   varchar NOT NULL DEFAULT '',
    supplier   varchar NOT NULL DEFAULT '',
    price      real NOT NULL DEFAULT 0,
    max_times  int NOT NULL DEFAULT 0,
    warn_pct   real NOT NULL DEFAULT 80,
    used_times int NOT NULL DEFAULT 0,
    status     varchar NOT NULL DEFAULT '在用',       -- 在用/使用中/已报废/待报废
    place      varchar NOT NULL DEFAULT '',
    owner      varchar NOT NULL DEFAULT '',
    remark     varchar NOT NULL DEFAULT '',
    created_at varchar NOT NULL DEFAULT '',
    updated_at varchar NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS prd_squeegee_bind (
    id            bigserial PRIMARY KEY,
    sq_no         varchar NOT NULL DEFAULT '',
    machine_no    varchar NOT NULL DEFAULT '',
    position      varchar NOT NULL DEFAULT '',
    mo_no         varchar NOT NULL DEFAULT '',
    line_code     varchar NOT NULL DEFAULT '',
    used_in_round int NOT NULL DEFAULT 0,
    status        varchar NOT NULL DEFAULT '使用中',
    online_time   varchar NOT NULL DEFAULT '',
    offline_time  varchar NOT NULL DEFAULT '',
    operator      varchar NOT NULL DEFAULT '',
    created_at    varchar NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_sq_bind_no ON prd_squeegee_bind(sq_no, status);
CREATE INDEX IF NOT EXISTS ix_sq_bind_mc ON prd_squeegee_bind(machine_no, status);

CREATE TABLE IF NOT EXISTS prd_squeegee_use (
    id         bigserial PRIMARY KEY,
    sq_no      varchar NOT NULL DEFAULT '',
    use_date   varchar NOT NULL DEFAULT '',
    shift      varchar NOT NULL DEFAULT '',
    line_code  varchar NOT NULL DEFAULT '',
    mo_no      varchar NOT NULL DEFAULT '',
    machine_no varchar NOT NULL DEFAULT '',
    model      varchar NOT NULL DEFAULT '',
    times      int NOT NULL DEFAULT 0,
    clean_type varchar NOT NULL DEFAULT '',
    operator   varchar NOT NULL DEFAULT '',
    remark     varchar NOT NULL DEFAULT '',
    created_at varchar NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_sq_use_mo ON prd_squeegee_use(mo_no);

-- ── 四、钢网印刷参数（拼版数 / 每版印刷次数 / 寿命上限）──────────────────────
CREATE TABLE IF NOT EXISTS cfg_stencil_param (
    id              bigserial PRIMARY KEY,
    model           varchar NOT NULL DEFAULT '',
    side            varchar NOT NULL DEFAULT '',      -- PCB1 / PCB2
    panel_count     int NOT NULL DEFAULT 1,          -- 拼版数
    print_per_panel int NOT NULL DEFAULT 1,          -- 每版印刷次数
    max_times       int NOT NULL DEFAULT 0,          -- 寿命上限（次）
    warn_pct        real NOT NULL DEFAULT 80,
    remark          varchar NOT NULL DEFAULT '',
    created_at      varchar NOT NULL DEFAULT '',
    updated_at      varchar NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_stencil_param ON cfg_stencil_param(model, side);

-- ── 五、SMT 站位绑码（贴片上料防呆的唯一数据源）────────────────────────────
CREATE TABLE IF NOT EXISTS md_feeder_slot (
    id            bigserial PRIMARY KEY,
    model         varchar NOT NULL DEFAULT '',
    machine_code  varchar NOT NULL DEFAULT '',        -- 设备内部码
    machine_no    varchar NOT NULL DEFAULT '',
    slot_no       varchar NOT NULL DEFAULT '',
    feeder_no     varchar NOT NULL DEFAULT '',
    material_code varchar NOT NULL DEFAULT '',        -- 主料
    vn_code       varchar NOT NULL DEFAULT '',        -- 越南料号
    spec          varchar NOT NULL DEFAULT '',
    designators   varchar NOT NULL DEFAULT '',        -- 位号
    status        int NOT NULL DEFAULT 1,
    remark        varchar NOT NULL DEFAULT '',
    created_at    varchar NOT NULL DEFAULT '',
    updated_at    varchar NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_feeder_slot_model ON md_feeder_slot(model, machine_no, slot_no);

CREATE TABLE IF NOT EXISTS md_feeder_slot_alt (
    id            bigserial PRIMARY KEY,
    slot_id       bigint NOT NULL,                    -- md_feeder_slot.id
    material_code varchar NOT NULL DEFAULT '',        -- 主料 / 替代料（都放这张表）
    vn_code       varchar NOT NULL DEFAULT '',
    seq_no        int NOT NULL DEFAULT 0,            -- 原始格子里的顺序，0 = 主料
    is_main       int NOT NULL DEFAULT 0,            -- 1 = 主料
    created_at    varchar NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_fs_alt ON md_feeder_slot_alt(slot_id, material_code);
CREATE INDEX IF NOT EXISTS ix_fs_alt_mat ON md_feeder_slot_alt(material_code);

-- ── 六、GKG 印刷机 CSV 记录（真实印刷次数，优先于「按 AOI 板数反推」）────────
CREATE TABLE IF NOT EXISTS prd_print_log (
    id             bigserial PRIMARY KEY,
    ts             varchar NOT NULL DEFAULT '',
    barcode        varchar NOT NULL DEFAULT '',
    machine_id     varchar NOT NULL DEFAULT '',
    prod_name      varchar NOT NULL DEFAULT '',
    prod_type      varchar NOT NULL DEFAULT '',
    print_mode     varchar NOT NULL DEFAULT '',       -- Once/Double/Three/…
    print_times    int NOT NULL DEFAULT 1,
    cycle_time     real NOT NULL DEFAULT 0,
    cleaning_freq  real NOT NULL DEFAULT 0,
    front_press    real NOT NULL DEFAULT 0,
    rear_press     real NOT NULL DEFAULT 0,
    file_name      varchar NOT NULL DEFAULT '',
    mo_no          varchar NOT NULL DEFAULT '',
    raw            text NOT NULL DEFAULT '',
    created_at     varchar NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_print_log_file ON prd_print_log(file_name);
CREATE INDEX IF NOT EXISTS ix_print_log_mo ON prd_print_log(mo_no);
