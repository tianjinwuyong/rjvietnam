-- Feeder loading events table for SMT material loading confirmation
-- Records when an operator confirms a feeder slot is loaded with a specific reel

CREATE TABLE IF NOT EXISTS feeder_loading_events (
    id              bigserial PRIMARY KEY,
    work_order_code varchar(50)  NOT NULL,
    line_code       varchar(20),
    slot_no         varchar(50)  NOT NULL,
    lot_no          varchar(50)  NOT NULL,
    material_code   varchar(50),
    qty             int,
    operator_id     bigint,
    operator_name   varchar(100),
    loaded_at       timestamptz  NOT NULL DEFAULT now(),
    created_at      timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feeder_loading_wo ON feeder_loading_events(work_order_code);
CREATE INDEX IF NOT EXISTS idx_feeder_loading_line ON feeder_loading_events(line_code);
CREATE INDEX IF NOT EXISTS idx_feeder_loading_slot ON feeder_loading_events(slot_no);
CREATE INDEX IF NOT EXISTS idx_feeder_loading_lot ON feeder_loading_events(lot_no);

-- Record: admin (id=10) applied this migration
INSERT INTO _migrations (filename, hash) VALUES ('054_feeder_loading_events.sql', 'feeder-loading')
ON CONFLICT (filename) DO NOTHING;
