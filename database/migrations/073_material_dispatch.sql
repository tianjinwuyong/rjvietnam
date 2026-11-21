-- Material Dispatch System — multi-PDA coordination for simultaneous feeder loading
-- Tracks which PDA/operator is assigned to load which material for a given WO.
-- MES dispatcher evenly splits unassigned materials across online PDAs dynamically.

CREATE TABLE IF NOT EXISTS material_dispatch_sessions (
    id              bigserial PRIMARY KEY,
    work_order_code varchar(50)  NOT NULL,
    line_code       varchar(20),
    status          varchar(20)  NOT NULL DEFAULT 'active',  -- active | completed | cancelled
    created_at      timestamptz  NOT NULL DEFAULT now(),
    updated_at      timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dispatch_session_wo ON material_dispatch_sessions(work_order_code);

-- Tracks which materials are assigned to which PDA/operator for a dispatch session.
-- Material can be claimed by a different operator than originally assigned (reassignment).
CREATE TABLE IF NOT EXISTS material_dispatch_assignments (
    id                  bigserial PRIMARY KEY,
    dispatch_session_id  bigint      NOT NULL REFERENCES material_dispatch_sessions(id) ON DELETE CASCADE,
    material_code       varchar(50)  NOT NULL,
    material_name_zh    varchar(200),
    smt_flag            varchar(20)  NOT NULL DEFAULT 'SMT',  -- SMT | THT | CONNECTOR | CABLE | MECHANICAL | OTHERS
    unit                varchar(20),
    assigned_operator   varchar(100),  -- operator username (from original even-split)
    assigned_pda       varchar(64),   -- device_id of the PDA
    claim_operator      varchar(100),  -- who actually claimed it (may differ if reassigned)
    claim_pda          varchar(64),
    claimed_at          timestamptz,
    status              varchar(20)  NOT NULL DEFAULT 'pending',  -- pending | loading | loaded | error
    feeder_slot         varchar(50),   -- which feeder slot this was loaded into
    lot_no             varchar(50),   -- actual lot that was loaded
    loaded_at          timestamptz,
    created_at         timestamptz   NOT NULL DEFAULT now(),
    updated_at         timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dispatch_assign_session ON material_dispatch_assignments(dispatch_session_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_assign_operator ON material_dispatch_assignments(assigned_operator);
CREATE INDEX IF NOT EXISTS idx_dispatch_assign_claim_op ON material_dispatch_assignments(claim_operator);
CREATE INDEX IF NOT EXISTS idx_dispatch_assign_status  ON material_dispatch_assignments(status);
CREATE INDEX IF NOT EXISTS idx_dispatch_assign_mat   ON material_dispatch_assignments(material_code);

-- Record: admin applied this migration
INSERT INTO _migrations (filename, hash) VALUES ('073_material_dispatch.sql', 'material-dispatch-v1')
ON CONFLICT (filename) DO NOTHING;
