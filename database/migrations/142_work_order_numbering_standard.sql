-- Formal 11-digit work-order numbering standard from 工单编码规则.doc.

ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS po_line_no varchar(40);
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS order_source varchar(30) NOT NULL DEFAULT 'PMC';
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS legacy_code varchar(80);

CREATE TABLE IF NOT EXISTS work_order_code_allocations (
  code char(11) PRIMARY KEY,
  yy char(2) NOT NULL, mm char(2) NOT NULL,
  work_order_type smallint NOT NULL CHECK (work_order_type IN (1,2,3)),
  numeric_line_code char(2) NOT NULL,
  serial_no integer NOT NULL CHECK (serial_no BETWEEN 1 AND 9999),
  work_order_id bigint UNIQUE REFERENCES work_orders(id),
  allocation_status varchar(20) NOT NULL DEFAULT 'ALLOCATED',
  allocated_by bigint REFERENCES users(id), allocated_at timestamptz NOT NULL DEFAULT now(),
  voided_at timestamptz, voided_by bigint REFERENCES users(id), void_reason text,
  UNIQUE (yy, mm, work_order_type, numeric_line_code, serial_no),
  CHECK (code ~ '^[0-9]{11}$'),
  CHECK (allocation_status IN ('ALLOCATED','BOUND','VOIDED'))
);

CREATE TABLE IF NOT EXISTS work_order_relationships (
  id bigserial PRIMARY KEY,
  upstream_work_order_id bigint NOT NULL REFERENCES work_orders(id),
  downstream_work_order_id bigint NOT NULL REFERENCES work_orders(id),
  relationship_type varchar(30) NOT NULL DEFAULT 'PROCESS_FLOW',
  customer_po_id bigint REFERENCES customer_pos(id),
  notes text, created_by bigint REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (upstream_work_order_id, downstream_work_order_id, relationship_type),
  CHECK (upstream_work_order_id <> downstream_work_order_id),
  CHECK (relationship_type IN ('PROCESS_FLOW','REWORK_OF','SPLIT_FROM','MERGED_WITH'))
);

CREATE TABLE IF NOT EXISTS work_order_number_audit (
  id bigserial PRIMARY KEY,
  work_order_id bigint REFERENCES work_orders(id),
  work_order_code char(11) NOT NULL,
  action varchar(30) NOT NULL,
  old_status varchar(30), new_status varchar(30), reason text,
  actor_id bigint REFERENCES users(id), actor_name varchar(120),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CHECK (action IN ('ALLOCATED','CREATED','RELEASED','CHANGED','VOIDED','CLOSED','DUPLICATE_BLOCKED'))
);

CREATE OR REPLACE FUNCTION allocate_work_order_code(
  p_work_order_type smallint,
  p_numeric_line_code char(2),
  p_actor_id bigint DEFAULT NULL,
  p_at timestamptz DEFAULT now()
) RETURNS char(11) LANGUAGE plpgsql AS $$
DECLARE
  v_yy char(2) := to_char(p_at, 'YY');
  v_mm char(2) := to_char(p_at, 'MM');
  v_serial integer;
  v_code char(11);
BEGIN
  IF p_work_order_type NOT IN (1,2,3) THEN
    RAISE EXCEPTION 'work order type must be 1, 2, or 3';
  END IF;
  IF p_numeric_line_code !~ '^[0-9]{2}$' THEN
    RAISE EXCEPTION 'numeric line code must contain exactly 2 digits';
  END IF;

  INSERT INTO work_order_serial_counters(yy,mm,work_order_type,numeric_line_code,next_serial)
  VALUES(v_yy,v_mm,p_work_order_type,p_numeric_line_code,1)
  ON CONFLICT(yy,mm,work_order_type,numeric_line_code)
  DO UPDATE SET next_serial=work_order_serial_counters.next_serial+1
  RETURNING next_serial INTO v_serial;

  IF v_serial > 9999 THEN RAISE EXCEPTION 'monthly work-order sequence exhausted'; END IF;
  v_code := v_yy || v_mm || p_work_order_type::text || p_numeric_line_code || lpad(v_serial::text,4,'0');

  INSERT INTO work_order_code_allocations
    (code,yy,mm,work_order_type,numeric_line_code,serial_no,allocated_by)
  VALUES(v_code,v_yy,v_mm,p_work_order_type,p_numeric_line_code,v_serial,p_actor_id);
  RETURN v_code;
END $$;

CREATE OR REPLACE FUNCTION validate_work_order_code_components() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_line char(2);
BEGIN
  SELECT numeric_line_code INTO v_line FROM production_lines WHERE id=NEW.line_id;
  IF NEW.code !~ '^[0-9]{11}$' THEN RAISE EXCEPTION 'work order code must be exactly 11 digits'; END IF;
  IF substring(NEW.code from 5 for 1)::smallint <> NEW.work_order_type THEN
    RAISE EXCEPTION 'work order code type does not match work_order_type';
  END IF;
  IF substring(NEW.code from 6 for 2) <> v_line THEN
    RAISE EXCEPTION 'work order code line does not match production line';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_validate_work_order_code_components ON work_orders;
CREATE TRIGGER trg_validate_work_order_code_components
BEFORE INSERT OR UPDATE OF code,work_order_type,line_id ON work_orders
FOR EACH ROW EXECUTE FUNCTION validate_work_order_code_components();

CREATE INDEX IF NOT EXISTS idx_wo_alloc_month_line_type
  ON work_order_code_allocations(yy,mm,numeric_line_code,work_order_type,serial_no);
CREATE INDEX IF NOT EXISTS idx_wo_relationship_upstream ON work_order_relationships(upstream_work_order_id);
CREATE INDEX IF NOT EXISTS idx_wo_relationship_downstream ON work_order_relationships(downstream_work_order_id);
CREATE INDEX IF NOT EXISTS idx_wo_number_audit_code ON work_order_number_audit(work_order_code,occurred_at DESC);

COMMENT ON FUNCTION allocate_work_order_code IS 'Atomically allocates YYMM+type+line+4-digit monthly sequence; voided numbers are never recycled.';

-- API-friendly overload because PostgreSQL does not implicitly narrow JSON
-- integers/text into smallint/char function arguments.
CREATE OR REPLACE FUNCTION allocate_work_order_code(
  p_work_order_type integer,
  p_numeric_line_code text,
  p_actor_id bigint DEFAULT NULL
) RETURNS char(11) LANGUAGE sql AS $$
  SELECT allocate_work_order_code(p_work_order_type::smallint,p_numeric_line_code::char(2),p_actor_id,now());
$$;
