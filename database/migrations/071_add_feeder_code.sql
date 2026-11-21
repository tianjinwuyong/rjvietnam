-- Add feeder_code column to feeder_loading_events for 3-QR binding flow
-- The three QR codes: slot_no (通道码), feeder_code (feeder码), lot_no (物料码)

ALTER TABLE feeder_loading_events
    ADD COLUMN IF NOT EXISTS feeder_code varchar(50);

CREATE INDEX IF NOT EXISTS idx_feeder_loading_feeder ON feeder_loading_events(feeder_code);

-- Record migration
INSERT INTO _migrations (filename, hash) VALUES ('071_add_feeder_code.sql', 'add-feeder-code')
ON CONFLICT (filename) DO NOTHING;
