-- Material Dispatch PDA Persistence — store active PDAs in DB so they survive API restarts
-- Adds pdas JSONB column to material_dispatch_sessions

ALTER TABLE material_dispatch_sessions
  ADD COLUMN IF NOT EXISTS pdas jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_dispatch_session_pdas
  ON material_dispatch_sessions USING GIN (pdas);

-- Record admin applied this migration
INSERT INTO _migrations (filename, hash)
VALUES ('074_dispatch_pdas_persist.sql', 'dispatch-pdas-persist-v1')
ON CONFLICT (filename) DO NOTHING;
