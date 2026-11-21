-- 313: 镭雕发码（MES 下发 PCBA SN 给镭雕机）缺失结构
-- 源：设备对接工具/镭雕机/laser_sn_server.py（旧库这两张表由现场补建，schema.sql 里没有）

CREATE TABLE IF NOT EXISTS prd_laser_sn (
    id            BIGSERIAL PRIMARY KEY,
    sn            TEXT NOT NULL UNIQUE,
    seq_no        INTEGER NOT NULL DEFAULT 0,
    machine_code  TEXT    NOT NULL DEFAULT '',
    client_ip     TEXT    NOT NULL DEFAULT '',
    status        TEXT    NOT NULL DEFAULT 'issued',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    panel_no      INTEGER NOT NULL DEFAULT 0,
    panel_pos     INTEGER NOT NULL DEFAULT 0,
    mo_no         TEXT    NOT NULL DEFAULT '',
    product_code  TEXT    NOT NULL DEFAULT '',
    product_model TEXT    NOT NULL DEFAULT '',
    machine_no    TEXT    NOT NULL DEFAULT '',
    panel_size    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS mesrj_ix_laser_mo    ON prd_laser_sn(mo_no);
CREATE INDEX IF NOT EXISTS mesrj_ix_laser_panel ON prd_laser_sn(panel_no, panel_pos);
CREATE INDEX IF NOT EXISTS mesrj_ix_laser_time  ON prd_laser_sn(created_at);

-- 镭雕机台登记：按来源 IP 认机台（IP 固定，登记一次即可）
CREATE TABLE IF NOT EXISTS cfg_laser_machine (
    id         BIGSERIAL PRIMARY KEY,
    machine_no TEXT    NOT NULL DEFAULT '',
    ip         TEXT    NOT NULL DEFAULT '',
    line_code  TEXT    NOT NULL DEFAULT '',
    enabled    INTEGER NOT NULL DEFAULT 1,
    remark     TEXT    NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS mesrj_ux_laser_ip ON cfg_laser_machine(ip) WHERE enabled = 1;
