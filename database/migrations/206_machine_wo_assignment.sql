-- Machine Work Order Assignment
-- Tracks which work order is currently assigned to which machine
-- PDA operator scans during line change to assign work order to machine
-- NPM consumption is then verified against this assignment

CREATE TABLE IF NOT EXISTS machine_work_order_assignments (
  id bigserial PRIMARY KEY,
  machine_code varchar(50) NOT NULL,
  work_order_code char(11) NOT NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  assigned_by bigint REFERENCES users(id),
  line_id bigint REFERENCES production_lines(id),
  UNIQUE (machine_code, work_order_code)
);

CREATE INDEX IF NOT EXISTS idx_mwoa_machine
  ON machine_work_order_assignments(machine_code, assigned_at DESC);

CREATE INDEX IF NOT EXISTS idx_mwoa_wo
  ON machine_work_order_assignments(work_order_code);

-- Remove duplicate machine assignments (keep latest per machine)
CREATE OR REPLACE FUNCTION clean_mwoa_duplicates()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM machine_work_order_assignments a
  WHERE EXISTS (
    SELECT 1 FROM machine_work_order_assignments b
    WHERE b.machine_code = a.machine_code
      AND b.work_order_code = a.work_order_code
      AND b.assigned_at > a.assigned_at
  );
END;
$$;

INSERT INTO _migrations(filename, hash)
VALUES('206_machine_wo_assignment.sql','machine-wo-assignment-v1')
ON CONFLICT(filename) DO NOTHING;
