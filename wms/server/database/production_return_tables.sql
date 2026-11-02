CREATE TABLE IF NOT EXISTS production_return (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_no varchar(50) NOT NULL,
  material_id uuid NOT NULL,
  material_code varchar(100) NOT NULL,
  material_name varchar(200) NOT NULL,
  supplier_id uuid,
  supplier_code varchar(50),
  supplier_name varchar(200),
  quantity numeric NOT NULL,
  unit varchar(20) NOT NULL DEFAULT 'PCS',
  production_date date,
  batch_no varchar(100),
  return_reason text,
  work_order_no varchar(50),
  status varchar(20) NOT NULL DEFAULT 'draft',
  received_good_qty numeric NOT NULL DEFAULT '0',
  received_incoming_defect_qty numeric NOT NULL DEFAULT '0',
  received_operation_defect_qty numeric NOT NULL DEFAULT '0',
  _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile,
  _updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile
);

CREATE UNIQUE INDEX IF NOT EXISTS production_return_return_no_key ON production_return (return_no);
CREATE INDEX IF NOT EXISTS idx_pr_status ON production_return (status);
CREATE INDEX IF NOT EXISTS idx_pr_material ON production_return (material_id);
CREATE INDEX IF NOT EXISTS idx_pr_created ON production_return (_created_at);

CREATE TABLE IF NOT EXISTS production_return_iqc (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id uuid NOT NULL,
  good_qty numeric NOT NULL DEFAULT '0',
  incoming_defect_qty numeric NOT NULL DEFAULT '0',
  operation_defect_qty numeric NOT NULL DEFAULT '0',
  inspector_id user_profile,
  inspector_name varchar(100),
  inspection_time timestamptz(3),
  remark text,
  _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile,
  _updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile,
  CONSTRAINT production_return_iqc_return_id_fkey FOREIGN KEY (return_id)
    REFERENCES production_return (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pri_return ON production_return_iqc (return_id);
