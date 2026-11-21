-- Migration 061: Cycle Count System
--
-- Two count triggers:
--   A. Real-time: inventory tx INSERT → DB trigger → count_session + count_item
--   B. Scheduled: count_schedules table + WMS worker fires daily at configured time
--
-- Workflow:
--   inventory tx → count_session (open) → operator PDA claim → count items → submit
--   → variance reviewed → session closed
--
-- Alerts:
--   VARIANCE: counted variance pct > threshold_pct  → write count_alerts + alert_history
--   TIMEOUT:  session stays 'open' > timeout_hours  → WMS patrol creates count_alerts

-- ── A. count_sessions ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS count_sessions (
    id                   bigserial PRIMARY KEY,
    session_code         varchar(50)  NOT NULL UNIQUE,
    -- Trigger context
    trigger_type         varchar(20)  NOT NULL,   -- INVENTORY_TX | SCHEDULED
    trigger_action       varchar(30),             -- RECEIVE|PUT_AWAY|ISSUE_TO_LINE|RETURN|SCRAP|ADJUST (null for SCHEDULED)
    inventory_tx_no      varchar(80),              -- null for SCHEDULED
    count_schedule_id    bigint,                  -- null for INVENTORY_TX
    -- Location
    storage_location_id  bigint,
    location_code       varchar(30),
    location_name       varchar(100),
    -- Material lot (denormalized; null for SCHEDULED which counts all lots at location)
    material_lot_id     bigint,
    lot_no              varchar(80),
    material_code       varchar(50),
    material_name_zh    varchar(100),
    system_qty          int,                       -- qty at moment of trigger
    counted_qty         int,                      -- sum of all counted items
    variance            int,                       -- counted_qty - system_qty
    -- Alert config
    threshold_pct        int         NOT NULL DEFAULT 10,   -- variance % that triggers alert
    timeout_hours        int         NOT NULL DEFAULT 4,    -- hours before timeout alert
    -- Status: open|in_progress|completed|cancelled
    status              varchar(20) NOT NULL DEFAULT 'open',
    -- Who claimed / processed
    operator_id         bigint,
    operator_name       varchar(100),
    claimed_at          timestamptz,
    completed_at       timestamptz,
    notes               varchar(200),
    created_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE count_sessions IS '实时盘点任务 + 计划盘点任务 — 库存变动或定时触发';
COMMENT ON COLUMN count_sessions.trigger_type IS 'INVENTORY_TX（库存变动触发）| SCHEDULED（定点定时触发）';
COMMENT ON COLUMN count_sessions.status IS 'open | in_progress | completed | cancelled';

CREATE INDEX idx_cs_status      ON count_sessions(status);
CREATE INDEX idx_cs_type       ON count_sessions(trigger_type);
CREATE INDEX idx_cs_location    ON count_sessions(storage_location_id);
CREATE INDEX idx_cs_trigger_tx ON count_sessions(inventory_tx_no);
CREATE INDEX idx_cs_schedule   ON count_sessions(count_schedule_id);
CREATE INDEX idx_cs_created    ON count_sessions(created_at DESC);
CREATE INDEX idx_cs_operator   ON count_sessions(operator_id);

-- ── B. count_items ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS count_items (
    id                   bigserial PRIMARY KEY,
    count_session_id     bigint      NOT NULL REFERENCES count_sessions(id) ON DELETE CASCADE,
    -- Lot reference
    material_lot_id      bigint,
    lot_no               varchar(80),
    material_code        varchar(50),
    material_name_zh    varchar(100),
    -- Qty
    system_qty           int         NOT NULL DEFAULT 0,
    counted_qty          int,
    variance             int,                        -- counted_qty - system_qty
    counted              boolean     NOT NULL DEFAULT false,
    counted_at           timestamptz,
    counted_by           bigint,
    -- Source inventory tx (null for SCHEDULED sessions)
    inventory_tx_id     bigint,
    inventory_tx_no     varchar(80),
    created_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE count_items IS '盘点明细项 — 每个批号一行';
CREATE INDEX idx_ci_session ON count_items(count_session_id);
CREATE INDEX idx_ci_lot     ON count_items(material_lot_id);

-- ── C. count_schedules ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS count_schedules (
    id                   bigserial PRIMARY KEY,
    schedule_name        varchar(100) NOT NULL,
    schedule_type        varchar(20) NOT NULL,   -- DAILY | WEEKLY | MONTHLY
    -- For DAILY: scheduled_time (HH:MM)
    scheduled_time       varchar(5),              -- '20:00' — HH:MM in local time
    -- For WEEKLY: day_of_week (1=Mon, 7=Sun)
    day_of_week          int,
    -- For MONTHLY: day_of_month (1-31)
    day_of_month         int,
    -- Target: specific location or ALL
    storage_location_id  bigint,
    location_code       varchar(30),
    location_name       varchar(100),
    -- Scope
    scope                varchar(20) NOT NULL DEFAULT 'ALL',  -- ALL | LOCATION
    -- Alert config (inherit from defaults)
    threshold_pct        int         NOT NULL DEFAULT 10,
    timeout_hours        int         NOT NULL DEFAULT 4,
    -- Active flag
    is_active            boolean     NOT NULL DEFAULT true,
    last_run_at         timestamptz,
    next_run_at         timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now(),
    created_by         bigint
);

COMMENT ON TABLE count_schedules IS '定点盘点计划 — 每日/每周/每月定时触发全库或指定库位盘点';
COMMENT ON COLUMN count_schedules.schedule_type IS 'DAILY（每日定点）| WEEKLY（每周）| MONTHLY（每月）';
COMMENT ON COLUMN count_schedules.scope IS 'ALL（全部库位）| LOCATION（指定库位）';

CREATE INDEX idx_csch_active ON count_schedules(is_active);
CREATE INDEX idx_csch_next  ON count_schedules(next_run_at);

-- Seed default daily schedule at 20:00 for all locations
INSERT INTO count_schedules (schedule_name, schedule_type, scheduled_time, scope, threshold_pct, timeout_hours, is_active)
VALUES ('每日全库盘点', 'DAILY', '20:00', 'ALL', 10, 4, true)
ON CONFLICT DO NOTHING;

-- ── D. count_alerts ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS count_alerts (
    id                   bigserial PRIMARY KEY,
    count_session_id     bigint      REFERENCES count_sessions(id),
    count_item_id        bigint      REFERENCES count_items(id),
    alert_type           varchar(20) NOT NULL,  -- VARIANCE | TIMEOUT
    priority              int         NOT NULL DEFAULT 2,  -- 1=critical 2=high 3=normal
    title                varchar(200) NOT NULL,
    message              text         NOT NULL,
    -- Detail
    variance_pct         numeric(8,2),
    threshold_pct        int,
    system_qty           int,
    counted_qty          int,
    location_code        varchar(30),
    lot_no               varchar(80),
    material_code        varchar(50),
    operator_id         bigint,
    operator_name       varchar(100),
    -- Ack
    acknowledged         boolean     NOT NULL DEFAULT false,
    acknowledged_at     timestamptz,
    acknowledged_by     bigint,
    created_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE count_alerts IS '盘点预警 — 差异超限(VARIANCE)或超时未盘(TIMEOUT)';
CREATE INDEX idx_ca_session ON count_alerts(count_session_id);
CREATE INDEX idx_ca_type    ON count_alerts(alert_type);
CREATE INDEX idx_ca_ack     ON count_alerts(acknowledged);
CREATE INDEX idx_ca_created ON count_alerts(created_at DESC);

-- ── E. Sequence ──────────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS count_session_seq;

-- ── F. Permissions ────────────────────────────────────────────────────────────
GRANT SELECT ON count_sessions   TO public;
GRANT SELECT ON count_items     TO public;
GRANT SELECT ON count_schedules TO public;
GRANT SELECT ON count_alerts    TO public;
GRANT INSERT, UPDATE, DELETE ON count_sessions   TO smt_factory;
GRANT INSERT, UPDATE, DELETE ON count_items     TO smt_factory;
GRANT INSERT, UPDATE           ON count_schedules TO smt_factory;
GRANT INSERT, UPDATE           ON count_alerts    TO smt_factory;

-- ── G. DB Trigger: inventory tx → count session ──────────────────────────────
CREATE OR REPLACE FUNCTION fn_auto_create_count_session()
RETURNS TRIGGER AS $$
DECLARE
    v_loc_id    bigint;
    v_loc_code  varchar(30);
    v_loc_name  varchar(100);
    v_mat_code  varchar(50);
    v_mat_name  varchar(100);
    v_lot_no    varchar(80);
    v_sys_qty   int;
    v_seq_val   bigint;
BEGIN
    IF NEW.action NOT IN ('RECEIVE', 'PUT_AWAY', 'ISSUE_TO_LINE', 'RETURN', 'SCRAP', 'ADJUST') THEN
        RETURN NEW;
    END IF;

    SELECT
        ml.id,
        ml.lot_no,
        COALESCE(m.code, ''),
        COALESCE(m.name_zh, m.name_en, ''),
        COALESCE(sl.id, 0),
        COALESCE(sl.code, ''),
        COALESCE(sl.name_zh, sl.name_en, '')
    INTO
        v_lot_no,
        v_lot_no,
        v_mat_code,
        v_mat_name,
        v_loc_id,
        v_loc_code,
        v_loc_name
    FROM material_lots ml
    LEFT JOIN materials m ON m.id = ml.material_id
    LEFT JOIN storage_locations sl ON sl.id = ml.storage_location_id
    WHERE ml.id = NEW.material_lot_id;

    v_sys_qty := ABS(NEW.qty);
    SELECT nextval('count_session_seq') INTO v_seq_val;

    INSERT INTO count_sessions (
        session_code, trigger_type, trigger_action, inventory_tx_no,
        storage_location_id, location_code, location_name,
        material_lot_id, lot_no, material_code, material_name_zh,
        system_qty, counted_qty, variance,
        status
    ) VALUES (
        'CS-' || to_char(now(), 'YYMMDD') || '-' || LPAD(v_seq_val::text, 6, '0'),
        'INVENTORY_TX',
        NEW.action,
        NEW.tx_no,
        v_loc_id, v_loc_code, v_loc_name,
        NEW.material_lot_id, v_lot_no, v_mat_code, v_mat_name,
        v_sys_qty, NULL, NULL,
        'open'
    );

    INSERT INTO count_items (
        count_session_id, material_lot_id, lot_no,
        material_code, material_name_zh, system_qty,
        inventory_tx_id, inventory_tx_no
    ) VALUES (
        currval('count_sessions_id_seq'),
        NEW.material_lot_id, v_lot_no,
        v_mat_code, v_mat_name, v_sys_qty,
        NEW.id, NEW.tx_no
    );

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_inventory_tx_auto_count ON inventory_transactions;
CREATE TRIGGER trg_inventory_tx_auto_count
    AFTER INSERT ON inventory_transactions
    FOR EACH ROW EXECUTE FUNCTION fn_auto_create_count_session();

-- ── H. Record migration ───────────────────────────────────────────────────────
INSERT INTO _migrations (filename, hash) VALUES ('061_count_sessions.sql', 'count-sessions-v3')
ON CONFLICT (filename) DO NOTHING;
