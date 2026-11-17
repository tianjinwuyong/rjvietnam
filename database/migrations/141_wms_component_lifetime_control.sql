-- Warehouse electronic-component lifetime control derived from
-- 仓库电子元器件寿命管参�?(1).xlsx.

CREATE TABLE IF NOT EXISTS material_lifetime_policies (
  id bigserial PRIMARY KEY,
  policy_code varchar(60) NOT NULL UNIQUE,
  material_id bigint REFERENCES materials(id),
  category_id bigint REFERENCES wms_material_categories(id),
  material_type varchar(60),
  sealed_shelf_life_months integer,
  opened_shelf_life_days integer,
  warning_level_2_days integer NOT NULL DEFAULT 60,
  warning_level_1_days integer NOT NULL DEFAULT 30,
  reinspection_extension_months integer NOT NULL DEFAULT 6,
  reinspection_required boolean NOT NULL DEFAULT true,
  storage_temperature_min numeric(8,2), storage_temperature_max numeric(8,2),
  storage_humidity_min numeric(8,2), storage_humidity_max numeric(8,2),
  status varchar(20) NOT NULL DEFAULT 'ACTIVE',
  effective_from date NOT NULL DEFAULT current_date, effective_to date,
  approved_by bigint REFERENCES users(id), approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (warning_level_2_days >= warning_level_1_days),
  CHECK (status IN ('DRAFT','ACTIVE','INACTIVE'))
);

INSERT INTO material_lifetime_policies
  (policy_code, warning_level_2_days, warning_level_1_days, reinspection_extension_months, reinspection_required, status)
VALUES ('DEFAULT-ELECTRONIC-COMPONENT', 60, 30, 6, true, 'ACTIVE')
ON CONFLICT (policy_code) DO NOTHING;

CREATE TABLE IF NOT EXISTS material_lifecycle_openings (
  id bigserial PRIMARY KEY,
  material_lot_id bigint NOT NULL REFERENCES material_lots(id),
  opened_at timestamptz NOT NULL,
  opened_shelf_life_days integer NOT NULL CHECK (opened_shelf_life_days > 0),
  opened_qty numeric(18,4),
  department varchar(120),
  operator varchar(120),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE material_lifecycle_openings ADD COLUMN IF NOT EXISTS remaining_qty numeric(18,4);
ALTER TABLE material_lifecycle_openings ADD COLUMN IF NOT EXISTS opened_expiry_at timestamptz;
ALTER TABLE material_lifecycle_openings ADD COLUMN IF NOT EXISTS status varchar(20) NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE material_lifecycle_openings ADD COLUMN IF NOT EXISTS closed_at timestamptz;
ALTER TABLE material_lifecycle_openings ADD COLUMN IF NOT EXISTS closed_by bigint REFERENCES users(id);

ALTER TABLE material_reinspection ADD COLUMN IF NOT EXISTS decision varchar(20);
ALTER TABLE material_reinspection ADD COLUMN IF NOT EXISTS extension_months integer;
ALTER TABLE material_reinspection ADD COLUMN IF NOT EXISTS previous_expiry_date date;
ALTER TABLE material_reinspection ADD COLUMN IF NOT EXISTS extended_expiry_date date;
ALTER TABLE material_reinspection ADD COLUMN IF NOT EXISTS status varchar(20) NOT NULL DEFAULT 'DRAFT';

ALTER TABLE material_lifecycle_alert_log ADD COLUMN IF NOT EXISTS alert_level varchar(20);
ALTER TABLE material_lifecycle_alert_log ADD COLUMN IF NOT EXISTS alert_type varchar(30) NOT NULL DEFAULT 'SEALED_EXPIRY';
ALTER TABLE material_lifecycle_alert_log ADD COLUMN IF NOT EXISTS days_remaining integer;
ALTER TABLE material_lifecycle_alert_log ADD COLUMN IF NOT EXISTS acknowledged_by bigint REFERENCES users(id);
ALTER TABLE material_lifecycle_alert_log ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz;
ALTER TABLE material_lifecycle_alert_log ADD COLUMN IF NOT EXISTS resolved_at timestamptz;

ALTER TABLE material_scrapping ADD COLUMN IF NOT EXISTS source_reinspection_id bigint REFERENCES material_reinspection(id);
ALTER TABLE material_scrapping ADD COLUMN IF NOT EXISTS isolated_at timestamptz;
ALTER TABLE material_scrapping ADD COLUMN IF NOT EXISTS isolation_location_id bigint REFERENCES storage_locations(id);
ALTER TABLE material_scrapping ADD COLUMN IF NOT EXISTS disposal_completed_at timestamptz;
ALTER TABLE material_scrapping ADD COLUMN IF NOT EXISTS disposal_completed_by bigint REFERENCES users(id);

CREATE TABLE IF NOT EXISTS material_lifecycle_status_history (
  id bigserial PRIMARY KEY,
  material_lot_id bigint NOT NULL REFERENCES material_lots(id),
  event_type varchar(40) NOT NULL,
  old_status varchar(30), new_status varchar(30) NOT NULL,
  source_type varchar(40), source_id varchar(120),
  days_remaining integer, notes text,
  actor_id bigint REFERENCES users(id), occurred_at timestamptz NOT NULL DEFAULT now(),
  CHECK (event_type IN ('RECEIVED','OPENED','NEAR_EXPIRY','EXPIRED','ISOLATED','REINSPECTED','EXTENDED','SCRAP_REQUESTED','SCRAPPED','CLOSED'))
);

CREATE TABLE IF NOT EXISTS material_scrap_approval_events (
  id bigserial PRIMARY KEY,
  material_scrapping_id bigint NOT NULL REFERENCES material_scrapping(id) ON DELETE CASCADE,
  approval_step integer NOT NULL,
  approver_role varchar(50) NOT NULL,
  approver_id bigint REFERENCES users(id),
  decision varchar(20) NOT NULL DEFAULT 'PENDING', comments text,
  decided_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (material_scrapping_id, approval_step, approver_role),
  CHECK (decision IN ('PENDING','APPROVED','REJECTED','RETURNED'))
);

CREATE OR REPLACE VIEW v_material_lifetime_control AS
SELECT ml.id AS material_lot_id, ml.lot_no,
       m.code AS material_code, m.name_zh AS material_name, m.specification,
       COALESCE(mc.name_zh, m.material_type) AS material_category,
       ml.manufacturing_date, ml.received_at::date AS inbound_date,
       COALESCE(p.sealed_shelf_life_months,
         CASE WHEN m.shelf_life_days IS NOT NULL THEN CEIL(m.shelf_life_days / 30.44) END) AS sealed_shelf_life_months,
       ml.expiry_date,
       CASE WHEN ml.manufacturing_date IS NOT NULL
         THEN ROUND((current_date - ml.manufacturing_date) / 30.44, 1) END AS used_months,
       CASE WHEN ml.expiry_date IS NOT NULL
         THEN ROUND((ml.expiry_date - current_date) / 30.44, 1) END AS remaining_life_months,
       CASE WHEN ml.expiry_date IS NOT NULL THEN ml.expiry_date - current_date END AS days_remaining,
       ml.received_qty - ml.reserved_qty AS inventory_qty, m.uom,
       COALESCE(s.name_zh, s.name_en, s.code) AS supplier_name,
       CASE
         WHEN ml.lot_status IN ('isolated','scrapped','closed') THEN upper(ml.lot_status)
         WHEN ml.expiry_date < current_date THEN 'EXPIRED_ISOLATE'
         WHEN ml.expiry_date - current_date <= COALESCE(p.warning_level_1_days,30) THEN 'WARNING_LEVEL_1'
         WHEN ml.expiry_date - current_date <= COALESCE(p.warning_level_2_days,60) THEN 'WARNING_LEVEL_2'
         ELSE 'NORMAL'
       END AS lifecycle_status,
       sl.code AS location_code
FROM material_lots ml
JOIN materials m ON m.id = ml.material_id
LEFT JOIN wms_material_categories mc ON mc.id = m.category_id
LEFT JOIN suppliers s ON s.id = ml.supplier_id
LEFT JOIN storage_locations sl ON sl.id = ml.storage_location_id
LEFT JOIN LATERAL (
  SELECT lp.* FROM material_lifetime_policies lp
  WHERE lp.status='ACTIVE'
    AND (lp.material_id=m.id OR (lp.material_id IS NULL AND lp.category_id=m.category_id)
         OR lp.policy_code='DEFAULT-ELECTRONIC-COMPONENT')
  ORDER BY (lp.material_id IS NOT NULL) DESC, (lp.category_id IS NOT NULL) DESC
  LIMIT 1
) p ON true
WHERE ml.voided_at IS NULL;

CREATE OR REPLACE VIEW v_material_opening_lifetime AS
SELECT o.id AS opening_id, o.material_lot_id, m.code AS material_code,
       m.name_zh AS material_name, m.specification, o.opened_at,
       o.opened_shelf_life_days,
       COALESCE(o.opened_expiry_at, o.opened_at + make_interval(days => o.opened_shelf_life_days::int)) AS opened_expiry_at,
       o.opened_qty, o.remaining_qty, m.uom, o.department, o.operator,
       CASE
         WHEN o.status='CLOSED' THEN 'CLOSED'
         WHEN COALESCE(o.opened_expiry_at, o.opened_at + make_interval(days => o.opened_shelf_life_days::int)) < now() THEN 'EXPIRED_ISOLATE'
         WHEN COALESCE(o.opened_expiry_at, o.opened_at + make_interval(days => o.opened_shelf_life_days::int)) < now()+interval '7 days' THEN 'NEAR_EXPIRY'
         ELSE 'ACTIVE'
       END AS lifecycle_status
FROM material_lifecycle_openings o
JOIN material_lots ml ON ml.id=o.material_lot_id
JOIN materials m ON m.id=ml.material_id;

CREATE INDEX IF NOT EXISTS idx_lifetime_policy_material ON material_lifetime_policies(material_id, category_id, status);
CREATE INDEX IF NOT EXISTS idx_lifecycle_opening_expiry ON material_lifecycle_openings(opened_expiry_at, status);
CREATE INDEX IF NOT EXISTS idx_lifecycle_alert_level ON material_lifecycle_alert_log(processing_status, alert_level, created_at);
CREATE INDEX IF NOT EXISTS idx_lifecycle_history_lot ON material_lifecycle_status_history(material_lot_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_material_scrap_approval_pending ON material_scrap_approval_events(decision, created_at);

COMMENT ON VIEW v_material_lifetime_control IS 'Canonical effective-life ledger matching 物料有效期管控台�?and near-expiry warning workbook.';
COMMENT ON VIEW v_material_opening_lifetime IS 'Canonical opened-package lifetime ledger matching 物料开封日期登记记录表.';
