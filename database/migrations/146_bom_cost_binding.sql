-- Immutable material-cost versions and BOM cost snapshots.

CREATE TABLE IF NOT EXISTS material_standard_cost_versions (
  id bigserial PRIMARY KEY,
  material_id bigint NOT NULL REFERENCES materials(id),
  cost_version integer NOT NULL,
  unit_cost numeric(18,6) NOT NULL CHECK(unit_cost>=0),
  currency_code varchar(12) NOT NULL REFERENCES currencies(code),
  effective_from date NOT NULL,
  effective_to date,
  status varchar(20) NOT NULL DEFAULT 'DRAFT',
  source_type varchar(40),source_reference varchar(120),
  created_by bigint REFERENCES users(id),approved_by bigint REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),approved_at timestamptz,
  UNIQUE(material_id,cost_version),
  CHECK(status IN ('DRAFT','ACTIVE','SUPERSEDED','REJECTED'))
);

CREATE TABLE IF NOT EXISTS bom_cost_snapshots (
  id bigserial PRIMARY KEY,
  snapshot_no varchar(100) NOT NULL UNIQUE,
  bom_id bigint NOT NULL REFERENCES boms(id),
  bom_revision varchar(30) NOT NULL,
  currency_code varchar(12) NOT NULL REFERENCES currencies(code),
  material_cost numeric(18,6) NOT NULL DEFAULT 0,
  labor_cost numeric(18,6) NOT NULL DEFAULT 0,
  overhead_cost numeric(18,6) NOT NULL DEFAULT 0,
  total_unit_cost numeric(18,6) GENERATED ALWAYS AS(material_cost+labor_cost+overhead_cost) STORED,
  status varchar(20) NOT NULL DEFAULT 'DRAFT',
  effective_from date NOT NULL,
  effective_to date,
  created_by bigint REFERENCES users(id),approved_by bigint REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),approved_at timestamptz,
  CHECK(status IN ('DRAFT','ACTIVE','SUPERSEDED','REJECTED'))
);

CREATE TABLE IF NOT EXISTS bom_cost_snapshot_lines (
  id bigserial PRIMARY KEY,
  snapshot_id bigint NOT NULL REFERENCES bom_cost_snapshots(id) ON DELETE CASCADE,
  bom_line_id bigint NOT NULL REFERENCES bom_lines(id),
  material_id bigint NOT NULL REFERENCES materials(id),
  material_naming_version integer NOT NULL,
  material_cost_version_id bigint REFERENCES material_standard_cost_versions(id),
  qty_per numeric(18,6) NOT NULL,
  loss_rate numeric(8,4) NOT NULL DEFAULT 0,
  unit_cost numeric(18,6) NOT NULL,
  extended_cost numeric(18,6) NOT NULL,
  UNIQUE(snapshot_id,bom_line_id)
);

CREATE TABLE IF NOT EXISTS work_order_bom_cost_bindings (
  id bigserial PRIMARY KEY,
  work_order_id bigint NOT NULL UNIQUE REFERENCES work_orders(id),
  bom_id bigint NOT NULL REFERENCES boms(id),
  cost_snapshot_id bigint NOT NULL REFERENCES bom_cost_snapshots(id),
  bound_by bigint REFERENCES users(id),bound_at timestamptz NOT NULL DEFAULT now(),
  reason text,
  CHECK(reason IS NOT NULL AND length(trim(reason))>0)
);

CREATE INDEX IF NOT EXISTS idx_material_cost_active ON material_standard_cost_versions(material_id,status,effective_from DESC);
CREATE INDEX IF NOT EXISTS idx_bom_cost_snapshot_bom ON bom_cost_snapshots(bom_id,status,effective_from DESC);
CREATE INDEX IF NOT EXISTS idx_wo_bom_cost_snapshot ON work_order_bom_cost_bindings(cost_snapshot_id);

CREATE OR REPLACE FUNCTION enforce_work_order_bom_cost_consistency()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE wo_bom bigint; snapshot_bom bigint; snapshot_status varchar(20);
BEGIN
  SELECT bom_id INTO wo_bom FROM work_orders WHERE id=NEW.work_order_id;
  SELECT bom_id,status INTO snapshot_bom,snapshot_status FROM bom_cost_snapshots WHERE id=NEW.cost_snapshot_id;
  IF wo_bom IS NULL OR wo_bom<>NEW.bom_id OR snapshot_bom<>NEW.bom_id THEN
    RAISE EXCEPTION 'Work order BOM, binding BOM and cost snapshot BOM must match';
  END IF;
  IF snapshot_status<>'ACTIVE' THEN RAISE EXCEPTION 'Only ACTIVE BOM cost snapshots can bind to work orders'; END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_wo_bom_cost_consistency ON work_order_bom_cost_bindings;
CREATE TRIGGER trg_wo_bom_cost_consistency
BEFORE INSERT OR UPDATE ON work_order_bom_cost_bindings
FOR EACH ROW EXECUTE FUNCTION enforce_work_order_bom_cost_consistency();

CREATE OR REPLACE VIEW v_bom_cost_control AS
SELECT s.id AS snapshot_id,s.snapshot_no,s.bom_id,s.bom_revision,s.currency_code,
       s.material_cost,s.labor_cost,s.overhead_cost,s.total_unit_cost,s.status,s.effective_from,
       p.code AS product_code,count(l.id)::int AS line_count
FROM bom_cost_snapshots s JOIN boms b ON b.id=s.bom_id JOIN products p ON p.id=b.product_id
LEFT JOIN bom_cost_snapshot_lines l ON l.snapshot_id=s.id
GROUP BY s.id,p.code;

CREATE OR REPLACE VIEW v_bom_cost_reconciliation AS
SELECT s.id AS snapshot_id,s.snapshot_no,s.bom_id,s.bom_revision,s.status,
       b.revision AS current_bom_revision,
       round(COALESCE(sum(l.extended_cost),0),6) AS calculated_material_cost,
       s.material_cost AS recorded_material_cost,
       (s.bom_revision=b.revision) AS revision_matches,
       (round(COALESCE(sum(l.extended_cost),0),6)=round(s.material_cost,6)) AS total_matches,
       bool_and(m.domain_code='RAW_MATERIAL') AS all_material_domains_valid,
       bool_and(l.material_naming_version=m.naming_version) AS all_naming_versions_current,
       bool_and(abs(l.extended_cost-(l.qty_per*(1+l.loss_rate)*l.unit_cost))<0.000001) AS all_line_costs_match
FROM bom_cost_snapshots s JOIN boms b ON b.id=s.bom_id
LEFT JOIN bom_cost_snapshot_lines l ON l.snapshot_id=s.id
LEFT JOIN materials m ON m.id=l.material_id
GROUP BY s.id,b.revision;
