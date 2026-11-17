-- Add pcb_serial_id to npm_material_consumption_events for PCB-level traceability
-- NPM consumption events can now be linked to specific PCB boards

ALTER TABLE npm_material_consumption_events
  ADD COLUMN IF NOT EXISTS pcb_serial_id bigint REFERENCES pcb_serials(id);

CREATE INDEX IF NOT EXISTS idx_npm_consumption_pcb
  ON npm_material_consumption_events(pcb_serial_id, source_occurred_at DESC);

INSERT INTO _migrations (filename, hash)
VALUES ('205_pcb_trace_npm.sql', 'npm-material-consumption-pcb-trace-v1')
ON CONFLICT (filename) DO NOTHING;
