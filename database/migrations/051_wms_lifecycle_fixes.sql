-- 051: WMS lifecycle action tracking.
--
-- The former migration generated random IQC exemptions, expiry dates and
-- sample scrap/reinspection rows. A production schema migration must never
-- fabricate operational data, so only the required schema remains.

BEGIN;

CREATE TABLE IF NOT EXISTS material_lifecycle_alert_log (
  id bigserial PRIMARY KEY,
  material_lot_id bigint NOT NULL REFERENCES material_lots(id),
  processing_status varchar(40) NOT NULL DEFAULT 'PENDING',
  action_plan text,
  responsible varchar(120),
  plan_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (material_lot_id)
);

CREATE INDEX IF NOT EXISTS idx_material_lifecycle_alert_status
  ON material_lifecycle_alert_log(processing_status, plan_date);

COMMIT;
