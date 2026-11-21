-- Migration 003: Spare Parts Extended — Supplier Comms, Pricing, Equipment Archive
-- Applied: 2026-06-28

-- ═══════════════════════════════════════════════════════
-- EQUIPMENT SUPPLIERS
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS equipment_suppliers (
  id varchar(40) PRIMARY KEY,
  supplier_code varchar(40) UNIQUE NOT NULL,
  name_zh varchar(200),
  name_en varchar(200),
  name_vi varchar(200),
  contact_person varchar(120),
  email varchar(200),
  phone varchar(60),
  country varchar(60),
  supplier_type varchar(40) DEFAULT 'distributor',
  account_number varchar(80),
  payment_terms varchar(60),
  rating int DEFAULT 3 CHECK (rating BETWEEN 1 AND 5),
  status varchar(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'blacklisted')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS parts_suppliers (
  id varchar(40) PRIMARY KEY,
  supplier_code varchar(40) UNIQUE NOT NULL,
  supplier_name_zh varchar(200),
  supplier_name_en varchar(200),
  supplier_name_vi varchar(200),
  contact_person varchar(120),
  email varchar(200),
  phone varchar(60),
  country varchar(60),
  payment_terms varchar(60),
  rating int DEFAULT 3 CHECK (rating BETWEEN 1 AND 5),
  status varchar(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'blacklisted')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ═══════════════════════════════════════════════════════
-- EQUIPMENT SUPPLIER COMMUNICATIONS
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS equipment_supplier_comms (
  id bigserial PRIMARY KEY,
  supplier_id varchar(40),
  equipment_id bigint,
  comm_type varchar(40) NOT NULL CHECK (comm_type IN (
    'warranty_claim', 'technical_support', 'price_inquiry', 'purchase_order',
    'delivery_followup', 'return_rma', 'contract_negotiation', 'quality_complaint', 'general_inquiry'
  )),
  subject varchar(300),
  content text,
  contact_person varchar(120),
  comm_date date NOT NULL DEFAULT CURRENT_DATE,
  next_action varchar(300),
  next_action_date date,
  status varchar(20) DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  resolved_date date,
  attachments jsonb DEFAULT '[]',
  operator_name varchar(80),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_es_comms_supplier ON equipment_supplier_comms(supplier_id);
CREATE INDEX IF NOT EXISTS idx_es_comms_status ON equipment_supplier_comms(status);
CREATE INDEX IF NOT EXISTS idx_es_comms_comm_date ON equipment_supplier_comms(comm_date);

-- ═══════════════════════════════════════════════════════
-- PARTS SUPPLIER COMMUNICATIONS
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS parts_supplier_comms (
  id bigserial PRIMARY KEY,
  supplier_id varchar(40),
  part_id varchar(40),
  comm_type varchar(40) NOT NULL CHECK (comm_type IN (
    'warranty_claim', 'technical_support', 'price_inquiry', 'purchase_order',
    'delivery_followup', 'return_rma', 'contract_negotiation', 'quality_complaint', 'general_inquiry'
  )),
  subject varchar(300),
  content text,
  contact_person varchar(120),
  comm_date date NOT NULL DEFAULT CURRENT_DATE,
  next_action varchar(300),
  next_action_date date,
  status varchar(20) DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  resolved_date date,
  attachments jsonb DEFAULT '[]',
  operator_name varchar(80),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ps_comms_supplier ON parts_supplier_comms(supplier_id);
CREATE INDEX IF NOT EXISTS idx_ps_comms_part ON parts_supplier_comms(part_id);
CREATE INDEX IF NOT EXISTS idx_ps_comms_status ON parts_supplier_comms(status);

-- ═══════════════════════════════════════════════════════
-- PARTS PRICING HISTORY
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS parts_pricing_history (
  id bigserial PRIMARY KEY,
  part_id varchar(40),
  supplier_id varchar(40),
  unit_cost numeric(12,4) NOT NULL,
  currency varchar(3) DEFAULT 'CNY',
  moq int DEFAULT 1,
  lead_time_days int,
  valid_from date NOT NULL DEFAULT CURRENT_DATE,
  valid_to date,
  quote_reference varchar(80),
  is_current boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pricing_part ON parts_pricing_history(part_id);
CREATE INDEX IF NOT EXISTS idx_pricing_supplier ON parts_pricing_history(supplier_id);
CREATE INDEX IF NOT EXISTS idx_pricing_current ON parts_pricing_history(part_id) WHERE is_current = true;

-- ═══════════════════════════════════════════════════════
-- SUPPLIER QUOTES
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS supplier_quotes (
  id bigserial PRIMARY KEY,
  part_id varchar(40),
  supplier_id varchar(40),
  unit_cost numeric(12,4) NOT NULL,
  currency varchar(3) DEFAULT 'CNY',
  moq int DEFAULT 1,
  lead_time_days int,
  quote_number varchar(80),
  quote_date date NOT NULL DEFAULT CURRENT_DATE,
  valid_until date,
  notes text,
  status varchar(20) DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'expired')),
  operator_name varchar(80),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quotes_part ON supplier_quotes(part_id);
CREATE INDEX IF NOT EXISTS idx_quotes_supplier ON supplier_quotes(supplier_id);
CREATE INDEX IF NOT EXISTS idx_quotes_status ON supplier_quotes(status);

-- ═══════════════════════════════════════════════════════
-- EQUIPMENT ARCHIVES
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS equipment_archives (
  id varchar(40) PRIMARY KEY,
  equipment_code varchar(40) UNIQUE NOT NULL,
  equipment_name varchar(200),
  equipment_model varchar(80),
  manufacturer varchar(120),
  serial_number varchar(80),
  install_date date,
  current_status varchar(30) DEFAULT 'new' CHECK (current_status IN (
    'new', 'installing', 'running', 'idle', 'maintenance', 'repair', 'overhauled', 'decommissioned'
  )),
  cumulative_running_hours numeric(12,2) DEFAULT 0,
  last_running_hours_update timestamptz,
  last_status_change timestamptz DEFAULT now(),
  total_uptime_hours numeric(12,2) DEFAULT 0,
  total_downtime_hours numeric(12,2) DEFAULT 0,
  mean_time_between_failures numeric(12,2),
  total_maintenance_count int DEFAULT 0,
  total_repair_count int DEFAULT 0,
  total_cost numeric(12,2) DEFAULT 0,
  photo_url varchar(500),
  notes text,
  warranty_expires_at date,
  next_service_due timestamptz,
  operator_name varchar(80),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS equipment_status_history (
  id bigserial PRIMARY KEY,
  equipment_id varchar(40),
  from_status varchar(30),
  to_status varchar(30) NOT NULL,
  reason varchar(300),
  running_hours_at_change numeric(12,2),
  operator_name varchar(80),
  changed_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ea_status_history_equipment ON equipment_status_history(equipment_id);
CREATE INDEX IF NOT EXISTS idx_ea_status_history_changed_at ON equipment_status_history(changed_at);

CREATE TABLE IF NOT EXISTS equipment_hours_log (
  id bigserial PRIMARY KEY,
  equipment_id varchar(40),
  hours_delta numeric(12,2) NOT NULL,
  cumulative_hours numeric(12,2) NOT NULL,
  logged_at timestamptz DEFAULT now(),
  source varchar(40) DEFAULT 'patrol' CHECK (source IN ('patrol', 'maintenance', 'manual')),
  notes text
);

CREATE INDEX IF NOT EXISTS idx_ea_hours_log_equipment ON equipment_hours_log(equipment_id);
CREATE INDEX IF NOT EXISTS idx_ea_hours_log_logged_at ON equipment_hours_log(logged_at);

CREATE TABLE IF NOT EXISTS equipment_wear_history (
  id bigserial PRIMARY KEY,
  equipment_id varchar(40),
  part_id varchar(40),
  wear_schedule_id bigint,
  wear_status varchar(20) NOT NULL CHECK (wear_status IN ('normal', 'warning', 'critical', 'overdue', 'replaced')),
  running_hours_at_event numeric(12,2),
  replaced_at timestamptz,
  replaced_by_part_id varchar(40),
  notes text,
  operator_name varchar(80),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ea_wear_history_equipment ON equipment_wear_history(equipment_id);

CREATE TABLE IF NOT EXISTS equipment_maintenance_log (
  id bigserial PRIMARY KEY,
  equipment_id varchar(40),
  maintenance_record_id varchar(40),
  maintenance_type varchar(30) CHECK (maintenance_type IN ('preventive', 'corrective', 'breakdown', 'inspection')),
  description text,
  cost numeric(12,2) DEFAULT 0,
  duration_hours numeric(8,2),
  performed_by varchar(120),
  scheduled_start timestamptz,
  actual_start timestamptz,
  completed_at timestamptz,
  status varchar(20) DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'in_progress', 'completed', 'cancelled')),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ea_maint_log_equipment ON equipment_maintenance_log(equipment_id);
CREATE INDEX IF NOT EXISTS idx_ea_maint_log_status ON equipment_maintenance_log(status);

CREATE TABLE IF NOT EXISTS equipment_wear_alert_log (
  id bigserial PRIMARY KEY,
  equipment_id varchar(40),
  part_id varchar(40),
  alert_type varchar(30) CHECK (alert_type IN ('low_stock', 'wear_warning', 'wear_critical', 'overdue')),
  severity varchar(10) CHECK (severity IN ('info', 'warning', 'critical')),
  message text,
  alert_created_at timestamptz,
  acknowledged boolean DEFAULT false,
  acknowledged_by varchar(80),
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  resolution_notes text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ea_wear_alert_log_equipment ON equipment_wear_alert_log(equipment_id);
CREATE INDEX IF NOT EXISTS idx_ea_wear_alert_log_acknowledged ON equipment_wear_alert_log(acknowledged);

-- ═══════════════════════════════════════════════════════
-- SEED DATA (skip if already seeded — use ON CONFLICT)
-- ═══════════════════════════════════════════════════════

INSERT INTO equipment_suppliers (id, supplier_code, name_zh, name_en, name_vi, contact_person, email, phone, country, supplier_type, payment_terms, rating)
VALUES
  ('es-001', 'SUP-OEM-001', '西门子（中国）有限公司', 'Siemens China Co.', 'Siemens China', '张工', 'zhang.gong@siemens.com', '+86-21-3889-1234', '中国', 'OEM', 'TT 30 days', 5),
  ('es-002', 'SUP-OEM-002', '松下电器机电（中国）有限公司', 'Panasonic Industrial Devices', 'Panasonic', '李明', 'li.ming@panasonic.cn', '+86-10-6588-2001', '日本', 'OEM', 'TT 45 days', 4),
  ('es-003', 'SUP-AGT-001', '深圳市世达威机电设备有限公司', 'Shenzhen SDW Equipment', 'SDW Equipment', '王华', 'wang.hua@sdw.cn', '+86-755-2600-8800', '中国', 'agent', 'TT 30 days', 3)
ON CONFLICT (supplier_code) DO NOTHING;

INSERT INTO parts_suppliers (id, supplier_code, supplier_name_zh, supplier_name_en, supplier_name_vi, contact_person, email, phone, country, payment_terms, rating)
VALUES
  ('ps-001', 'PART-SUP-001', '深圳市华腾电子有限公司', 'Shenzhen Huateng Electronics', 'Huateng Electronics', '陈总', 'chen.zong@huateng.cn', '+86-755-8270-6600', '中国', 'TT 30 days', 4),
  ('ps-002', 'PART-SUP-002', '广州亿盛贸易有限公司', 'Guangzhou Yisheng Trading', 'Yisheng Trading', '刘小姐', 'liu.xj@yisheng.cn', '+86-20-3800-1200', '中国', 'TT 45 days', 3),
  ('ps-003', 'PART-SUP-003', '东莞市铭基电子有限公司', 'Dongguan Mingji Electronics', 'Mingji Electronics', '周经理', 'zhou.jl@mingji.cn', '+86-769-8160-8800', '中国', 'TT 30 days', 4)
ON CONFLICT (supplier_code) DO NOTHING;

INSERT INTO equipment_supplier_comms (supplier_id, comm_type, subject, content, contact_person, comm_date, next_action, next_action_date, status)
VALUES
  ('es-001', 'technical_support', 'SMT贴片机定期维护咨询', '询问关于SMT贴片机定期维护周期和备件推荐', '张工', CURRENT_DATE - INTERVAL '15 days', '安排下次技术回访', CURRENT_DATE + INTERVAL '7 days', 'open'),
  ('es-002', 'warranty_claim', '回流焊炉温传感器故障', '温度传感器读数异常，申请保修更换', '李明', CURRENT_DATE - INTERVAL '5 days', '等待配件寄送', CURRENT_DATE + INTERVAL '3 days', 'in_progress'),
  ('es-001', 'price_inquiry', '2026年度备件价格更新', '询问2026年度备件价格表', '张工', CURRENT_DATE - INTERVAL '30 days', '收到报价单', CURRENT_DATE - INTERVAL '20 days', 'resolved')
ON CONFLICT DO NOTHING;

INSERT INTO parts_supplier_comms (supplier_id, part_id, comm_type, subject, content, contact_person, comm_date, next_action, next_action_date, status)
VALUES
  ('ps-001', 'SP-001', 'price_inquiry', '备件SP-001价格更新', '询问新型号备件价格', '陈总', CURRENT_DATE - INTERVAL '10 days', '等待报价', CURRENT_DATE + INTERVAL '5 days', 'open'),
  ('ps-002', 'SP-002', 'delivery_followup', 'SP-002订单交货期确认', '确认SP-002备件交货时间', '刘小姐', CURRENT_DATE - INTERVAL '3 days', '确认交货时间', CURRENT_DATE, 'open'),
  ('ps-001', 'SP-003', 'quality_complaint', 'SP-003质量反馈', 'SP-003备件使用寿命低于规格', '陈总', CURRENT_DATE - INTERVAL '20 days', '供应商回复处理方案', CURRENT_DATE - INTERVAL '10 days', 'resolved')
ON CONFLICT DO NOTHING;

INSERT INTO parts_pricing_history (part_id, supplier_id, unit_cost, currency, moq, lead_time_days, valid_from, is_current)
VALUES
  ('SP-001', 'ps-001', 128.00, 'CNY', 10, 7, CURRENT_DATE - INTERVAL '60 days', false),
  ('SP-001', 'ps-001', 135.00, 'CNY', 10, 7, CURRENT_DATE - INTERVAL '30 days', true),
  ('SP-002', 'ps-002', 85.50, 'CNY', 20, 14, CURRENT_DATE - INTERVAL '45 days', true),
  ('SP-003', 'ps-001', 220.00, 'CNY', 5, 10, CURRENT_DATE - INTERVAL '90 days', true)
ON CONFLICT DO NOTHING;

INSERT INTO supplier_quotes (part_id, supplier_id, unit_cost, currency, moq, lead_time_days, quote_number, quote_date, valid_until, status, operator_name)
VALUES
  ('SP-001', 'ps-001', 135.00, 'CNY', 10, 7, 'QT-2026-0601', CURRENT_DATE - INTERVAL '30 days', CURRENT_DATE + INTERVAL '30 days', 'accepted', '系统管理员'),
  ('SP-001', 'ps-002', 142.00, 'CNY', 20, 14, 'QT-2026-0615', CURRENT_DATE - INTERVAL '15 days', CURRENT_DATE + INTERVAL '15 days', 'pending', '系统管理员'),
  ('SP-002', 'ps-002', 85.50, 'CNY', 20, 14, 'QT-2026-0510', CURRENT_DATE - INTERVAL '45 days', CURRENT_DATE + INTERVAL '45 days', 'accepted', '系统管理员'),
  ('SP-003', 'ps-003', 215.00, 'CNY', 5, 10, 'QT-2026-0520', CURRENT_DATE - INTERVAL '60 days', CURRENT_DATE - INTERVAL '30 days', 'expired', '系统管理员')
ON CONFLICT DO NOTHING;

INSERT INTO equipment_archives (id, equipment_code, equipment_name, equipment_model, manufacturer, serial_number, install_date, current_status, cumulative_running_hours, last_running_hours_update, total_uptime_hours, total_maintenance_count, total_repair_count, warranty_expires_at, next_service_due)
VALUES
  ('ea-001', 'EQ-SMT-001', 'SMT贴片机 #1', 'SM482', 'Samsung', 'SN-SM482-2024001', '2024-03-15', 'running', 4521.50, now(), 4600.00, 12, 2, '2027-03-14', now() + INTERVAL '30 days'),
  ('ea-002', 'EQ-SMT-002', 'SMT贴片机 #2', 'SM482', 'Samsung', 'SN-SM482-2024002', '2024-03-15', 'running', 4380.25, now(), 4450.00, 10, 3, '2027-03-14', now() + INTERVAL '25 days'),
  ('ea-003', 'EQ-REFLOW-001', '回流焊炉 #1', 'Heller 1809EXL', 'Heller', 'SN-HE1809-2023001', '2023-11-20', 'running', 6820.00, now(), 7000.00, 8, 1, '2026-11-19', now() + INTERVAL '60 days'),
  ('ea-004', 'EQ-AOI-001', 'AOI自动光学检测 #1', 'Saki BF-金星', 'Saki', 'SN-SAKI-AOI-001', '2024-06-01', 'idle', 1200.00, now() - INTERVAL '7 days', 1500.00, 4, 1, '2027-05-31', now() + INTERVAL '90 days')
ON CONFLICT (equipment_code) DO NOTHING;

INSERT INTO equipment_status_history (equipment_id, from_status, to_status, reason, running_hours_at_change, changed_at)
VALUES
  ('ea-001', 'new', 'installing', '设备到厂安装', 0, '2024-03-10'),
  ('ea-001', 'installing', 'running', '安装调试完成，投产', 0, '2024-03-15'),
  ('ea-001', 'running', 'maintenance', '计划性保养', 2000.00, '2025-01-10'),
  ('ea-001', 'maintenance', 'running', '保养完成', 2050.00, '2025-01-11'),
  ('ea-004', 'new', 'installing', '设备到厂安装', 0, '2024-05-20'),
  ('ea-004', 'installing', 'running', '安装调试完成，投产', 0, '2024-06-01'),
  ('ea-004', 'running', 'idle', '暂停使用，等待重新配置', 1200.00, now() - INTERVAL '7 days')
ON CONFLICT DO NOTHING;

INSERT INTO equipment_hours_log (equipment_id, hours_delta, cumulative_hours, logged_at, source, notes)
VALUES
  ('ea-001', 8.50, 4521.50, now() - INTERVAL '1 hour', 'patrol', '例行小时记录'),
  ('ea-002', 8.25, 4380.25, now() - INTERVAL '1 hour', 'patrol', '例行小时记录'),
  ('ea-003', 9.00, 6820.00, now() - INTERVAL '1 hour', 'patrol', '例行小时记录')
ON CONFLICT DO NOTHING;
