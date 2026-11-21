-- Product stagnation and scrap controls derived from 产品呆滞管控.xlsx.
-- Additive migration; existing MES records are retained.

ALTER TABLE product_stagnation_logs ADD COLUMN IF NOT EXISTS po_number varchar(80);
ALTER TABLE product_stagnation_logs ADD COLUMN IF NOT EXISTS warehouse_location_id bigint REFERENCES storage_locations(id);
ALTER TABLE product_stagnation_logs ADD COLUMN IF NOT EXISTS warehouse_location_code varchar(80);
ALTER TABLE product_stagnation_logs ADD COLUMN IF NOT EXISTS threshold_months numeric(8,2);
ALTER TABLE product_stagnation_logs ADD COLUMN IF NOT EXISTS first_detected_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE product_stagnation_logs ADD COLUMN IF NOT EXISTS last_station_event_at timestamptz;
ALTER TABLE product_stagnation_logs ADD COLUMN IF NOT EXISTS disposition varchar(30) NOT NULL DEFAULT 'PENDING';
ALTER TABLE product_stagnation_logs ADD COLUMN IF NOT EXISTS disposition_by bigint REFERENCES users(id);
ALTER TABLE product_stagnation_logs ADD COLUMN IF NOT EXISTS disposition_at timestamptz;

ALTER TABLE product_scraps ADD COLUMN IF NOT EXISTS source_stagnation_id bigint REFERENCES product_stagnation_logs(id);
ALTER TABLE product_scraps ADD COLUMN IF NOT EXISTS physical_retention_location varchar(120);
ALTER TABLE product_scraps ADD COLUMN IF NOT EXISTS item_retained boolean NOT NULL DEFAULT true;
ALTER TABLE product_scraps ADD COLUMN IF NOT EXISTS custody_owner varchar(120);
ALTER TABLE product_scraps ADD COLUMN IF NOT EXISTS disposed_at timestamptz;
ALTER TABLE product_scraps ADD COLUMN IF NOT EXISTS disposed_by bigint REFERENCES users(id);
ALTER TABLE product_scraps ADD COLUMN IF NOT EXISTS disposal_method varchar(80);
ALTER TABLE product_scraps ADD COLUMN IF NOT EXISTS disposal_witness varchar(120);

CREATE TABLE IF NOT EXISTS product_stagnation_actions (
  id bigserial PRIMARY KEY,
  stagnation_id bigint NOT NULL REFERENCES product_stagnation_logs(id) ON DELETE CASCADE,
  action_type varchar(40) NOT NULL,
  from_station_code varchar(80), to_station_code varchar(80),
  from_location_code varchar(80), to_location_code varchar(80),
  reason_code varchar(60), notes text,
  actor_id bigint REFERENCES users(id), actor_name varchar(120),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (action_type IN ('DETECTED','MOVED','RETEST','RELEASED','HOLD','SCRAP_REQUESTED','SCRAP_APPROVED','RESOLVED'))
);

CREATE TABLE IF NOT EXISTS product_scrap_approvals (
  id bigserial PRIMARY KEY,
  product_scrap_id bigint NOT NULL REFERENCES product_scraps(id) ON DELETE CASCADE,
  approval_step integer NOT NULL,
  approver_role varchar(50) NOT NULL,
  approver_id bigint REFERENCES users(id),
  decision varchar(20) NOT NULL DEFAULT 'PENDING',
  comments text, decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_scrap_id, approval_step, approver_role),
  CHECK (decision IN ('PENDING','APPROVED','REJECTED','RETURNED'))
);

CREATE TABLE IF NOT EXISTS product_scrap_custody_events (
  id bigserial PRIMARY KEY,
  product_scrap_id bigint NOT NULL REFERENCES product_scraps(id) ON DELETE CASCADE,
  event_type varchar(30) NOT NULL,
  location varchar(120), custodian varchar(120), quantity integer NOT NULL DEFAULT 1,
  evidence_url text, notes text,
  actor_id bigint REFERENCES users(id), occurred_at timestamptz NOT NULL DEFAULT now(),
  CHECK (event_type IN ('RETAINED','TRANSFERRED','COUNTED','DISPOSAL_AUTHORIZED','DISPOSED'))
);

CREATE INDEX IF NOT EXISTS idx_product_stagnation_location
  ON product_stagnation_logs(warehouse_location_id, status, first_detected_at);
CREATE INDEX IF NOT EXISTS idx_product_stagnation_po
  ON product_stagnation_logs(po_number, product_model, status);
CREATE INDEX IF NOT EXISTS idx_product_stagnation_actions
  ON product_stagnation_actions(stagnation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_scrap_approval_pending
  ON product_scrap_approvals(decision, created_at);
CREATE INDEX IF NOT EXISTS idx_product_scrap_custody
  ON product_scrap_custody_events(product_scrap_id, occurred_at DESC);

CREATE OR REPLACE VIEW v_product_stagnation_control AS
SELECT psl.id, psl.customer_code, psl.product_model, psl.sn, psl.pcb_no,
       psl.laser_qr_date, fs.code AS from_station_code, ts.code AS to_station_code,
       psl.station_code AS latest_station, psl.line_code, psl.po_number,
       COALESCE(sl.code, psl.warehouse_location_code) AS warehouse_location,
       ROUND(psl.stagnation_minutes::numeric / (30.44 * 24 * 60), 2) AS overdue_months,
       psl.stagnation_level, psl.status, psl.disposition, psl.notes,
       psl.first_detected_at, psl.updated_at, psl.resolved_at
FROM product_stagnation_logs psl
LEFT JOIN stations fs ON fs.id = psl.from_station_id
LEFT JOIN stations ts ON ts.id = psl.to_station_id
LEFT JOIN storage_locations sl ON sl.id = psl.warehouse_location_id;

COMMENT ON VIEW v_product_stagnation_control IS 'Canonical query matching 产品呆滞 worksheet columns and filters.';
COMMENT ON COLUMN product_scraps.item_retained IS 'Scrapped physical product remains under custody until authorized disposal.';
