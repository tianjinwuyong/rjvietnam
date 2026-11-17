-- Migration 059: Add acknowledged_at / acknowledged_by to material_financial_events
-- finance-execute.js ackMaterialEvent() writes these columns but they were missing from the original schema.
-- The status column exists (OPEN / ACKNOWLEDGED / RESOLVED); these columns track when/by whom it was acknowledged.

ALTER TABLE material_financial_events
  ADD COLUMN IF NOT EXISTS acknowledged_at   timestamptz,
  ADD COLUMN IF NOT EXISTS acknowledged_by   varchar(100);

COMMENT ON COLUMN material_financial_events.acknowledged_at IS 'When finance AI (or user) acknowledged the event';
COMMENT ON COLUMN material_financial_events.acknowledged_by IS 'Who acknowledged (e.g. FINANCE_AI, or operator name)';

-- Record migration
INSERT INTO _migrations (filename, hash)
VALUES ('059_material_financial_events_add_ack.sql', 'mfe-add-ack-columns')
ON CONFLICT (filename) DO NOTHING;
