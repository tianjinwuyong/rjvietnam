-- Migration 083: SMT Feeder Binding — 4-way anti-error records
-- Records machine + channel + feeder + slot + lot + material binding for L001 SMT line
begin;

-- ── Feeder Binding Events ────────────────────────────────────────────────────────
-- Complete binding record: machine + channel + feeder + slot + lot + material
CREATE TABLE IF NOT EXISTS feeder_binding_events (
    id              bigserial PRIMARY KEY,
    work_order_code varchar(50)  NOT NULL,
    line_code       varchar(20)  NOT NULL DEFAULT 'L001',
    machine_code    varchar(50)  NOT NULL,   -- NPM-D3A
    channel_code    varchar(20),            -- 站位码: 1L/1R/2L/2R
    feeder_code    varchar(50)  NOT NULL,  -- 飞达编号: FD08001
    slot_no        varchar(20)  NOT NULL,  -- 槽位: A1/F01
    lot_no         varchar(50)  NOT NULL,  -- 批次/料盘条码
    material_code  varchar(50)  NOT NULL,  -- 物料编码
    material_name_zh varchar(200),
    qty            int DEFAULT 0,
    operator_name  varchar(100),
    bound_at       timestamptz NOT NULL DEFAULT now(),
    unbound_at     timestamptz,
    status         varchar(20) NOT NULL DEFAULT 'active',  -- active / unbound
    quality_verdict varchar(20),  -- PASS / NG / DAMAGED
    return_reason_code varchar(50),
    return_reason_note  varchar(200),
    return_verified_by  varchar(100),
    return_verified_at  timestamptz,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_feeder_binding_wo_machine_slot
        UNIQUE (work_order_code, machine_code, slot_no, status)
        -- only one active binding per WO/machine/slot combo
);

CREATE INDEX IF NOT EXISTS idx_binding_wo        ON feeder_binding_events(work_order_code);
CREATE INDEX IF NOT EXISTS idx_binding_machine   ON feeder_binding_events(machine_code);
CREATE INDEX IF NOT EXISTS idx_binding_slot    ON feeder_binding_events(machine_code, slot_no);
CREATE INDEX IF NOT EXISTS idx_binding_lot     ON feeder_binding_events(lot_no);
CREATE INDEX IF NOT EXISTS idx_binding_status  ON feeder_binding_events(status);

-- ── Extend fool_proof_rules ────────────────────────────────────────────────────
-- Add expected_material_code so we can validate directly without product_id join
ALTER TABLE fool_proof_rules
    ADD COLUMN IF NOT EXISTS expected_material_code varchar(50);

ALTER TABLE fool_proof_rules
    ADD COLUMN IF NOT EXISTS feeder_width varchar(20);  -- e.g. '8mm', '12mm'

-- Add slot type for L001 SMT line
ALTER TABLE fool_proof_rules
    ADD COLUMN IF NOT EXISTS slot_type varchar(20);  -- 'SMT' / 'AI' / 'HAND'

CREATE INDEX IF NOT EXISTS idx_foolproof_slot_material
    ON fool_proof_rules(expected_material_code);

-- (idx_foolproof_machine_slot removed — machine_code belongs to machine_slots, not fool_proof_rules)

-- ── Feeder Master ────────────────────────────────────────────────────────────────
-- Master data for feeder units (校准/保养/宽度管理)
CREATE TABLE IF NOT EXISTS feeders (
    id              bigserial PRIMARY KEY,
    feeder_code     varchar(50)  NOT NULL UNIQUE,  -- FD08001
    feeder_type     varchar(20),   -- 'SMT' / 'AI'
    width_mm        varchar(20),   -- '8mm' / '12mm' / '16mm'
    status          varchar(20) NOT NULL DEFAULT 'available',  -- available / in_use / maintenance / retired
    location_code   varchar(50),
    last_calibrated_at timestamptz,
    next_calibration_at timestamptz,
    total_usage_count int DEFAULT 0,
    notes           text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feeder_code  ON feeders(feeder_code);
CREATE INDEX IF NOT EXISTS idx_feeder_status ON feeders(status);

-- ── Machine Slots (NPM贴片机站位表) ──────────────────────────────────────────
-- Defines all slots per machine for L001
CREATE TABLE IF NOT EXISTS machine_slots (
    id              bigserial PRIMARY KEY,
    machine_code    varchar(50)  NOT NULL,   -- NPM-D3A
    slot_no         varchar(20)  NOT NULL,   -- A1 / F01
    slot_type       varchar(20)  NOT NULL DEFAULT 'SMT',  -- SMT / AI
    expected_material_code varchar(50),
    feeder_width    varchar(20),  -- expected feeder width
    max_qty         int DEFAULT 1,  -- usually 1, but some slots can hold 2
    notes           text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_machine_slot UNIQUE (machine_code, slot_no)
);

CREATE INDEX IF NOT EXISTS idx_machine_slots_machine ON machine_slots(machine_code);

-- Record migration
INSERT INTO _migrations (filename, hash)
VALUES ('083_feeder_binding.sql', 'feeder-binding-4way')
ON CONFLICT (filename) DO NOTHING;

commit;
