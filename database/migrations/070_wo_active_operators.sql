-- Allow multiple PDA operators to work on the same WO simultaneously
ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS active_operators TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN work_orders.active_operators IS 'List of operator usernames currently loading this WO from PDA';

CREATE INDEX IF NOT EXISTS idx_wo_active_operators ON work_orders USING GIN (active_operators);
