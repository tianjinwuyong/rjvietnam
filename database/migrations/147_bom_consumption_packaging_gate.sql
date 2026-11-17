-- End-to-end BOM consumption control: loading -> production -> packaging write-off.
-- A finished-product QR may only be bound after every frozen work-order BOM line
-- has been completely reconciled.

CREATE TABLE IF NOT EXISTS work_order_bom_requirements (
  id bigserial PRIMARY KEY,
  work_order_id bigint NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  bom_id bigint NOT NULL REFERENCES boms(id),
  bom_revision varchar(30) NOT NULL,
  bom_line_id bigint NOT NULL REFERENCES bom_lines(id),
  material_id bigint NOT NULL REFERENCES materials(id),
  material_naming_version integer NOT NULL,
  qty_per numeric(18,6) NOT NULL CHECK(qty_per>0),
  loss_rate numeric(8,4) NOT NULL DEFAULT 0 CHECK(loss_rate>=0),
  planned_product_qty numeric(18,4) NOT NULL CHECK(planned_product_qty>0),
  required_qty numeric(18,6) NOT NULL CHECK(required_qty>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(work_order_id,bom_line_id)
);

CREATE TABLE IF NOT EXISTS work_order_bom_writeoffs (
  id bigserial PRIMARY KEY,
  event_no varchar(100) NOT NULL UNIQUE,
  work_order_id bigint NOT NULL REFERENCES work_orders(id),
  requirement_id bigint NOT NULL REFERENCES work_order_bom_requirements(id),
  material_lot_id bigint REFERENCES material_lots(id),
  stage varchar(30) NOT NULL,
  qty numeric(18,6) NOT NULL CHECK(qty>0),
  status varchar(20) NOT NULL DEFAULT 'POSTED',
  source_reference varchar(160),
  actor varchar(120) NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  reversed_event_id bigint REFERENCES work_order_bom_writeoffs(id),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  CHECK(stage IN ('LOADING','ISSUE','PRODUCTION','PACKAGING','ADJUSTMENT','REVERSAL')),
  CHECK(status IN ('POSTED','REVERSED','PENDING_APPROVAL'))
);

CREATE INDEX IF NOT EXISTS idx_wo_bom_req_work_order ON work_order_bom_requirements(work_order_id,material_id);
CREATE INDEX IF NOT EXISTS idx_wo_bom_writeoff_req ON work_order_bom_writeoffs(requirement_id,status,occurred_at);

CREATE OR REPLACE FUNCTION enforce_bom_writeoff_exact_membership()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_requirement_wo bigint; v_required numeric(18,6); v_posted numeric(18,6);
BEGIN
  SELECT work_order_id,required_qty INTO v_requirement_wo,v_required
  FROM work_order_bom_requirements WHERE id=NEW.requirement_id FOR UPDATE;
  IF v_requirement_wo IS NULL OR v_requirement_wo<>NEW.work_order_id THEN
    RAISE EXCEPTION 'Write-off material is not a member of this work-order BOM';
  END IF;
  IF NEW.status='POSTED' AND NEW.stage<>'REVERSAL' THEN
    SELECT COALESCE(sum(qty),0) INTO v_posted FROM work_order_bom_writeoffs
    WHERE requirement_id=NEW.requirement_id AND status='POSTED' AND stage<>'REVERSAL'
      AND id<>COALESCE(NEW.id,-1);
    IF v_posted+NEW.qty>v_required THEN
      RAISE EXCEPTION 'BOM write-off exceeds exact required quantity';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_bom_writeoff_exact_membership ON work_order_bom_writeoffs;
CREATE TRIGGER trg_bom_writeoff_exact_membership BEFORE INSERT OR UPDATE ON work_order_bom_writeoffs
FOR EACH ROW EXECUTE FUNCTION enforce_bom_writeoff_exact_membership();

CREATE OR REPLACE FUNCTION freeze_work_order_bom_requirements(p_work_order_id bigint)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE v_bom_id bigint; v_revision varchar(30); v_qty numeric(18,4); v_count integer;
BEGIN
  SELECT wo.bom_id,b.revision,wo.planned_qty INTO v_bom_id,v_revision,v_qty
  FROM work_orders wo JOIN boms b ON b.id=wo.bom_id WHERE wo.id=p_work_order_id;
  IF v_bom_id IS NULL THEN RAISE EXCEPTION 'Work order must have an explicit BOM revision'; END IF;
  INSERT INTO work_order_bom_requirements
    (work_order_id,bom_id,bom_revision,bom_line_id,material_id,material_naming_version,
     qty_per,loss_rate,planned_product_qty,required_qty)
  SELECT p_work_order_id,v_bom_id,v_revision,bl.id,bl.material_id,m.naming_version,
         bl.qty_per,COALESCE(bl.loss_rate,0),v_qty,
         round(bl.qty_per*(1+COALESCE(bl.loss_rate,0))*v_qty,6)
  FROM bom_lines bl JOIN materials m ON m.id=bl.material_id
  WHERE bl.bom_id=v_bom_id
  ON CONFLICT(work_order_id,bom_line_id) DO NOTHING;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  RETURN v_count;
END $$;

CREATE OR REPLACE VIEW v_work_order_bom_reconciliation AS
SELECT r.work_order_id,r.bom_id,r.bom_revision,r.bom_line_id,r.material_id,
       m.code AS material_code,m.name_zh AS material_name,
       r.material_naming_version,m.naming_version AS current_naming_version,
       r.required_qty,
       COALESCE(sum(CASE WHEN w.status='POSTED' AND w.stage<>'REVERSAL' THEN w.qty ELSE 0 END),0)::numeric(18,6) AS written_off_qty,
       GREATEST(r.required_qty-COALESCE(sum(CASE WHEN w.status='POSTED' AND w.stage<>'REVERSAL' THEN w.qty ELSE 0 END),0),0)::numeric(18,6) AS remaining_qty,
       (r.material_naming_version=m.naming_version) AS naming_version_matches,
       (COALESCE(sum(CASE WHEN w.status='POSTED' AND w.stage<>'REVERSAL' THEN w.qty ELSE 0 END),0)=r.required_qty) AS fully_reconciled
FROM work_order_bom_requirements r
JOIN materials m ON m.id=r.material_id
LEFT JOIN work_order_bom_writeoffs w ON w.requirement_id=r.id
GROUP BY r.id,m.id;

CREATE OR REPLACE FUNCTION work_order_bom_is_fully_reconciled(p_work_order_id bigint)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS(SELECT 1 FROM work_order_bom_requirements WHERE work_order_id=p_work_order_id)
     AND NOT EXISTS(
       SELECT 1 FROM v_work_order_bom_reconciliation
       WHERE work_order_id=p_work_order_id AND (NOT fully_reconciled OR NOT naming_version_matches)
     )
     AND EXISTS(
       SELECT 1 FROM work_order_bom_cost_bindings cb
       JOIN bom_cost_snapshots cs ON cs.id=cb.cost_snapshot_id
       WHERE cb.work_order_id=p_work_order_id AND cs.status='ACTIVE'
     );
$$;

CREATE OR REPLACE VIEW v_work_order_bom_gate AS
SELECT wo.id AS work_order_id,wo.code AS work_order_code,wo.bom_id,b.revision AS bom_revision,
       count(r.bom_line_id)::int AS bom_line_count,
       count(r.bom_line_id) FILTER(WHERE r.fully_reconciled AND r.naming_version_matches)::int AS reconciled_line_count,
       COALESCE(sum(r.remaining_qty),0)::numeric(18,6) AS total_remaining_qty,
       work_order_bom_is_fully_reconciled(wo.id) AS product_binding_allowed
FROM work_orders wo LEFT JOIN boms b ON b.id=wo.bom_id
LEFT JOIN v_work_order_bom_reconciliation r ON r.work_order_id=wo.id
GROUP BY wo.id,b.revision;

CREATE OR REPLACE FUNCTION prevent_bom_change_after_work_order_use()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM work_order_bom_requirements WHERE bom_id=OLD.id) THEN
    IF NEW.revision IS DISTINCT FROM OLD.revision OR NEW.product_id IS DISTINCT FROM OLD.product_id THEN
      RAISE EXCEPTION 'BOM revision/product is frozen by work-order usage; create a new BOM revision';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_bom_frozen_after_wo_use ON boms;
CREATE TRIGGER trg_bom_frozen_after_wo_use BEFORE UPDATE ON boms
FOR EACH ROW EXECUTE FUNCTION prevent_bom_change_after_work_order_use();
