-- Migration 181: WMS IQC 补充表 + 上料/成品/出货
BEGIN;

CREATE TABLE IF NOT EXISTS iqc_defect_records (
  id BIGSERIAL PRIMARY KEY,
  inspection_id BIGINT NOT NULL REFERENCES iqc_inspections(id),
  defect_no INTEGER NOT NULL, defect_type VARCHAR(24) NOT NULL,
  defect_code VARCHAR(40), defect_description TEXT, defect_location VARCHAR(80),
  quantity_defect INTEGER NOT NULL DEFAULT 1, severity VARCHAR(12) DEFAULT 'minor',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS iqc_aql_rules (
  id BIGSERIAL PRIMARY KEY,
  material_category VARCHAR(80), supplier_grade VARCHAR(8),
  aql_major DECIMAL(4,2) DEFAULT 1.0, aql_minor DECIMAL(4,2) DEFAULT 2.5, aql_critical DECIMAL(4,2) DEFAULT 0.1,
  inspection_level VARCHAR(8) DEFAULT 'Normal', sample_size_code VARCHAR(8),
  active INTEGER DEFAULT 1, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS iqc_sampling_plans (
  id BIGSERIAL PRIMARY KEY,
  aql_level VARCHAR(8) NOT NULL, inspection_level VARCHAR(16) NOT NULL,
  sample_size INTEGER NOT NULL, accept_point INTEGER NOT NULL, reject_point INTEGER NOT NULL,
  description VARCHAR(240), active INTEGER DEFAULT 1, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS iqc_special_approvals (
  id BIGSERIAL PRIMARY KEY, inspection_id BIGINT REFERENCES iqc_inspections(id),
  applicant_id VARCHAR(80) NOT NULL, applicant_name VARCHAR(120),
  approver_id VARCHAR(80), approver_name VARCHAR(120),
  approval_date DATE NOT NULL DEFAULT CURRENT_DATE,
  reason TEXT NOT NULL, usage_purpose VARCHAR(240), quantity_approved DECIMAL(12,3),
  approval_status VARCHAR(16) DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS wms_material_loading (
  id BIGSERIAL PRIMARY KEY,
  work_order_no VARCHAR(80) NOT NULL, station_code VARCHAR(40) NOT NULL,
  feeder_no VARCHAR(40) NOT NULL, slot_no VARCHAR(16) NOT NULL,
  material_lot_no VARCHAR(120) NOT NULL, material_code VARCHAR(120), material_name VARCHAR(240),
  qty_loaded DECIMAL(12,3) DEFAULT 0,
  operator_id VARCHAR(80) NOT NULL, line_leader_id VARCHAR(80),
  loading_status VARCHAR(24) DEFAULT 'pending', released_at TIMESTAMPTZ,
  msd_verified BOOLEAN DEFAULT FALSE, iqc_verified BOOLEAN DEFAULT FALSE, expiry_verified BOOLEAN DEFAULT FALSE,
  msd_level VARCHAR(8), baking_required BOOLEAN DEFAULT FALSE, baking_passed BOOLEAN,
  quality_gate_passed BOOLEAN DEFAULT FALSE, gate_failed_items JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS wms_feeder_changes (
  id BIGSERIAL PRIMARY KEY,
  work_order_no VARCHAR(80) NOT NULL, station_code VARCHAR(40) NOT NULL,
  feeder_no VARCHAR(40) NOT NULL, slot_no VARCHAR(16),
  old_lot_no VARCHAR(120), new_lot_no VARCHAR(120),
  old_material_code VARCHAR(120), new_material_code VARCHAR(120),
  change_reason VARCHAR(240), change_type VARCHAR(24) DEFAULT 'manual',
  operator_id VARCHAR(80) NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS wms_line_stops (
  id BIGSERIAL PRIMARY KEY,
  work_order_no VARCHAR(80), station_code VARCHAR(40) NOT NULL,
  stop_reason_code VARCHAR(40) NOT NULL, stop_reason VARCHAR(240),
  start_time TIMESTAMPTZ NOT NULL DEFAULT NOW(), end_time TIMESTAMPTZ, duration_minutes INTEGER,
  operator_id VARCHAR(80) NOT NULL, resolution TEXT, production_loss DECIMAL(10,2) DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS wms_finished_goods (
  id BIGSERIAL PRIMARY KEY,
  sn_no VARCHAR(80) NOT NULL UNIQUE, work_order_no VARCHAR(80) NOT NULL,
  material_code VARCHAR(120) NOT NULL, material_name VARCHAR(240),
  batch_code VARCHAR(80), production_date DATE NOT NULL DEFAULT CURRENT_DATE,
  qty DECIMAL(12,3) NOT NULL DEFAULT 1,
  location_code VARCHAR(40), warehouse_zone VARCHAR(24),
  iqc_status VARCHAR(16) DEFAULT 'pending',
  oqc_inspector VARCHAR(80), oqc_inspected_at TIMESTAMPTZ,
  stored_at TIMESTAMPTZ, stored_by VARCHAR(80),
  status VARCHAR(24) DEFAULT 'pending_oqc',
  customer_code VARCHAR(80), customer_order_no VARCHAR(80),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS wms_sn_material_lots (
  id BIGSERIAL PRIMARY KEY,
  sn_no VARCHAR(80) NOT NULL, material_lot_no VARCHAR(120) NOT NULL,
  material_code VARCHAR(120) NOT NULL, material_name VARCHAR(240),
  work_order_no VARCHAR(80), station_code VARCHAR(40),
  loaded_at TIMESTAMPTZ NOT NULL, operator_id VARCHAR(80), qty_per_unit DECIMAL(12,3) DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS wms_outbound_orders (
  id BIGSERIAL PRIMARY KEY,
  outbound_no VARCHAR(80) NOT NULL UNIQUE, customer_code VARCHAR(80) NOT NULL,
  customer_name VARCHAR(240), customer_order_no VARCHAR(80),
  outbound_type VARCHAR(24) DEFAULT 'sales',
  planned_date DATE, actual_date DATE, status VARCHAR(24) DEFAULT 'pending',
  total_qty DECIMAL(12,3) DEFAULT 0, operator_id VARCHAR(80),
  logistics_no VARCHAR(80), packing_operator VARCHAR(80), packing_time TIMESTAMPTZ,
  shipping_method VARCHAR(40), destination TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS wms_outbound_items (
  id BIGSERIAL PRIMARY KEY,
  outbound_order_id BIGINT NOT NULL REFERENCES wms_outbound_orders(id),
  sn_no VARCHAR(80) NOT NULL, material_code VARCHAR(120), batch_code VARCHAR(80),
  qty DECIMAL(12,3) DEFAULT 1, pick_status VARCHAR(16) DEFAULT 'pending',
  picked_at TIMESTAMPTZ, picked_by VARCHAR(80), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS wms_packing_records (
  id BIGSERIAL PRIMARY KEY, outbound_order_id BIGINT REFERENCES wms_outbound_orders(id),
  operator_id VARCHAR(80) NOT NULL, packing_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  packing_materials JSONB DEFAULT '[]', photo_urls JSONB DEFAULT '[]', marking_info JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_defect_insp ON iqc_defect_records(inspection_id);
CREATE INDEX IF NOT EXISTS idx_ml_wo ON wms_material_loading(work_order_no);
CREATE INDEX IF NOT EXISTS idx_ml_lot ON wms_material_loading(material_lot_no);
CREATE INDEX IF NOT EXISTS idx_ml_station ON wms_material_loading(station_code);
CREATE INDEX IF NOT EXISTS idx_fc_wo ON wms_feeder_changes(work_order_no);
CREATE INDEX IF NOT EXISTS idx_ls_station ON wms_line_stops(station_code);
CREATE INDEX IF NOT EXISTS idx_fg_sn ON wms_finished_goods(sn_no);
CREATE INDEX IF NOT EXISTS idx_fg_wo ON wms_finished_goods(work_order_no);
CREATE INDEX IF NOT EXISTS idx_fg_status ON wms_finished_goods(status);
CREATE INDEX IF NOT EXISTS idx_sn_sn ON wms_sn_material_lots(sn_no);
CREATE INDEX IF NOT EXISTS idx_sn_lot ON wms_sn_material_lots(material_lot_no);
CREATE INDEX IF NOT EXISTS idx_outbound_no ON wms_outbound_orders(outbound_no);
CREATE INDEX IF NOT EXISTS idx_outbound_status ON wms_outbound_orders(status);

INSERT INTO iqc_aql_rules (material_category, supplier_grade, aql_major, aql_minor, aql_critical, inspection_level, sample_size_code)
VALUES
  ('SMT_SOLDER_PASTE','A',1.0,2.5,0.1,'Normal','G'),
  ('SMT_SOLDER_PASTE','B',1.0,2.5,0.1,'Normal','G'),
  ('SMT_SOLDER_PASTE','C',1.5,4.0,0.1,'Normal','H'),
  ('SMT_COMPONENT','A',1.0,2.5,0.1,'Normal','G'),
  ('SMT_COMPONENT','B',1.0,2.5,0.1,'Normal','G'),
  ('SMT_COMPONENT','C',1.5,4.0,0.1,'Normal','H'),
  ('PCB_PANEL','A',0.65,1.5,0.1,'Normal','F'),
  ('PCB_PANEL','B',1.0,2.5,0.1,'Normal','G'),
  ('CHEMICAL','A',1.0,2.5,0.1,'Normal','G'),
  ('CHEMICAL','B',1.5,4.0,0.1,'Normal','H'),
  ('MECHANICAL','A',1.0,2.5,0.1,'Normal','G'),
  ('MECHANICAL','B',1.5,4.0,0.1,'Normal','H'),
  ('DEFAULT','A',1.0,2.5,0.1,'Normal','G'),
  ('DEFAULT','B',1.5,4.0,0.1,'Normal','H'),
  ('DEFAULT','C',2.5,4.0,0.1,'Normal','J')
ON CONFLICT DO NOTHING;

INSERT INTO iqc_sampling_plans (aql_level, inspection_level, sample_size, accept_point, reject_point, description)
VALUES
  ('0.065','Normal',50,0,1,'AQL 0.065 Normal'),('0.10','Normal',50,0,1,'AQL 0.10 Normal'),
  ('0.15','Normal',50,0,1,'AQL 0.15 Normal'),('0.25','Normal',125,1,2,'AQL 0.25 Normal'),
  ('0.40','Normal',125,1,2,'AQL 0.40 Normal'),('0.65','Normal',200,2,3,'AQL 0.65 Normal'),
  ('1.0','Normal',200,3,4,'AQL 1.0 Normal'),('1.5','Normal',315,4,5,'AQL 1.5 Normal'),
  ('2.5','Normal',315,7,8,'AQL 2.5 Normal'),('4.0','Normal',500,10,11,'AQL 4.0 Normal')
ON CONFLICT DO NOTHING;

INSERT INTO _migrations(filename, hash)
VALUES ('181_wms_iqc_material_loading_finished.sql','wms-iqc-ml-fg-v1')
ON CONFLICT (filename) DO NOTHING;
COMMIT;
