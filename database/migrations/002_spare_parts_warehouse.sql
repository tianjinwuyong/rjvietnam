-- Migration: 002_spare_parts_warehouse.sql
-- Spare Parts Warehouse Management + Wear Lifetime Tracking
-- Part of perpetual patrol system (virtual agent: spare-parts-warehouse-manager)

-- ============================================================
-- SPARE PARTS MASTER
-- ============================================================

CREATE TABLE spare_parts (
  id varchar(40) PRIMARY KEY,
  part_no varchar(40) NOT NULL UNIQUE,
  name_zh varchar(120),
  name_en varchar(120),
  name_vi varchar(120),
  equipment_model varchar(80),      -- which machine model uses this part
  equipment_type varchar(40),        -- mounter | printer | reflow | AOI | ICT | etc.
  current_stock int NOT NULL DEFAULT 0,
  min_stock int NOT NULL DEFAULT 0,
  unit varchar(20) NOT NULL DEFAULT 'pcs',
  location_code varchar(40),         -- warehouse bin location (e.g., A-01-03)
  supplier varchar(120),
  unit_cost numeric(12,2) DEFAULT 0,
  lead_time_days int DEFAULT 7,
  status varchar(20) NOT NULL DEFAULT 'active',  -- active | discontinued | on_order
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_spare_parts_equipment_model ON spare_parts(equipment_model);
CREATE INDEX idx_spare_parts_status ON spare_parts(status);
CREATE INDEX idx_spare_parts_low_stock ON spare_parts(current_stock) WHERE current_stock < min_stock;

-- ============================================================
-- PARTS WEAR SCHEDULE (per equipment instance)
-- ============================================================

CREATE TABLE parts_wear_schedule (
  id bigserial PRIMARY KEY,
  part_id varchar(40) NOT NULL REFERENCES spare_parts(id) ON DELETE CASCADE,
  equipment_id varchar(40) NOT NULL,          -- links to equipment.id
  equipment_no varchar(40),                   -- human-readable equipment code
  installed_at timestamptz,
  running_hours numeric(12,2) NOT NULL DEFAULT 0,
  replace_interval_hours numeric(12,2) NOT NULL,  -- expected lifetime in hours
  next_replace_due timestamptz,
  last_replaced_at timestamptz,
  wear_status varchar(20) NOT NULL DEFAULT 'normal',  -- normal | warning | critical | overdue
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(part_id, equipment_id)
);

CREATE INDEX idx_wear_schedule_equipment ON parts_wear_schedule(equipment_id);
CREATE INDEX idx_wear_schedule_wear_status ON parts_wear_schedule(wear_status);
CREATE INDEX idx_wear_schedule_overdue ON parts_wear_schedule(next_replace_due) WHERE wear_status IN ('overdue', 'critical');

-- ============================================================
-- PARTS CONSUMPTION LOG (evidence for velocity calc)
-- ============================================================

CREATE TABLE parts_consumption_log (
  id bigserial PRIMARY KEY,
  part_id varchar(40) NOT NULL REFERENCES spare_parts(id) ON DELETE CASCADE,
  equipment_id varchar(40),
  work_order_code varchar(40),
  quantity int NOT NULL,
  reason varchar(40) NOT NULL,           -- corrective | preventive | preventive_scheduled | breakdown
  operator_name varchar(80),
  notes text,
  consumed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_consumption_part_id ON parts_consumption_log(part_id);
CREATE INDEX idx_consumption_equipment ON parts_consumption_log(equipment_id);
CREATE INDEX idx_consumption_date ON parts_consumption_log(consumed_at DESC);

-- ============================================================
-- PARTS WEAR ALERTS
-- ============================================================

CREATE TABLE parts_wear_alerts (
  id bigserial PRIMARY KEY,
  part_id varchar(40) NOT NULL REFERENCES spare_parts(id) ON DELETE CASCADE,
  equipment_id varchar(40),
  alert_type varchar(20) NOT NULL,        -- low_stock | wear_warning | wear_critical | overdue | consumption_spike
  severity varchar(10) NOT NULL,          -- info | warning | critical
  message text NOT NULL,
  current_stock int,
  min_stock int,
  running_hours numeric(12,2),
  replace_interval_hours numeric(12,2),
  acknowledged boolean NOT NULL DEFAULT false,
  acknowledged_by varchar(80),
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  resolved_by varchar(80),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_alerts_acknowledged ON parts_wear_alerts(acknowledged) WHERE NOT acknowledged;
CREATE INDEX idx_alerts_created ON parts_wear_alerts(created_at DESC);
CREATE INDEX idx_alerts_type ON parts_wear_alerts(alert_type);

-- ============================================================
-- PERFORMANCE LOG (for self-improvement loop)
-- ============================================================

CREATE TABLE spare_parts_performance_log (
  id bigserial PRIMARY KEY,
  run_at timestamptz NOT NULL DEFAULT now(),
  task_type varchar(40) NOT NULL,          -- patrol_low_stock | patrol_wear | alert_fire | alert_ack | consumption_record
  latency_ms int,
  parts_checked int,
  alerts_found int,
  alerts_critical int,
  low_stock_count int,
  overdue_count int,
  notes text
);

-- ============================================================
-- SEED: Demo spare parts data
-- ============================================================

INSERT INTO spare_parts (id, part_no, name_zh, name_en, name_vi, equipment_model, equipment_type, current_stock, min_stock, unit, location_code, supplier, unit_cost, lead_time_days) VALUES
  ('SP-001', 'NOZ-FUJI-NXT-III', ' Fuji NXT III 贴装头喷嘴', 'Fuji NXT III mounter nozzle', 'Đầu hàn Fuji NXT III', 'Fuji NXT III', 'mounter', 12, 5, 'pcs', 'A-01-01', 'Fuji机械', 2800.00, 14),
  ('SP-002', 'NOZ-FUJI-NXT-IV', 'Fuji NXT IV 贴装头喷嘴', 'Fuji NXT IV mounter nozzle', 'Đầu hàn Fuji NXT IV', 'Fuji NXT IV', 'mounter', 6, 5, 'pcs', 'A-01-02', 'Fuji机械', 3200.00, 14),
  ('SP-003', 'NOZZLE-SMT-003', 'SMT通用喷嘴 Ø3', 'SMT universal nozzle Ø3', 'Đầu hàn SMT Ø3', 'Universal', 'mounter', 20, 10, 'pcs', 'A-01-03', '国产', 180.00, 7),
  ('SP-004', 'FEEDER-FUJI-8', 'Fuji 8mm feeder供料器', 'Fuji 8mm feeder', 'Bộ cấp liệu Fuji 8mm', 'Fuji NXT III', 'mounter', 45, 20, 'pcs', 'A-02-01', 'Fuji机械', 1200.00, 21),
  ('SP-005', 'FEEDER-FUJI-12', 'Fuji 12mm feeder供料器', 'Fuji 12mm feeder', 'Bộ cấp liệu Fuji 12mm', 'Fuji NXT III', 'mounter', 30, 15, 'pcs', 'A-02-02', 'Fuji机械', 1400.00, 21),
  ('SP-006', 'SOLDER-PRINT-5', '锡膏印刷刮刀 5mm', 'Solder paste squeegee 5mm', 'Lưỡi gạt thiếc 5mm', 'DEK Horizon', 'printer', 8, 5, 'pcs', 'B-01-01', 'DEK原厂', 450.00, 7),
  ('SP-007', 'SOLDER-PRINT-8', '锡膏印刷刮刀 8mm', 'Solder paste squeegee 8mm', 'Lưỡi gạt thiếc 8mm', 'DEK Horizon', 'printer', 6, 5, 'pcs', 'B-01-02', 'DEK原厂', 520.00, 7),
  ('SP-008', 'HEATER-REHM-1', 'Rehm回流焊加热管', 'Rehm reflow heater tube', 'Ống gia nhiệt Rehm', 'Rehm V8', 'reflow', 3, 2, 'pcs', 'C-01-01', 'Rehm原厂', 8500.00, 30),
  ('SP-009', 'THERMOCOUPLE-1', '热电偶温度传感器', 'Thermocouple temperature sensor', 'Cặp nhiệt điện', 'Rehm V8', 'reflow', 5, 3, 'pcs', 'C-01-02', '国产', 320.00, 14),
  ('SP-010', 'CAMERA-AOI-1', 'AOI检测相机光源', 'AOI inspection camera light', 'Đèn camera AOI', 'CTI A40', 'AOI', 2, 2, 'pcs', 'D-01-01', 'Cognex', 12000.00, 45),
  ('SP-011', 'LASER-AOI-1', 'AOI激光扫描头', 'AOI laser scan head', 'Đầu quét laser AOI', 'CTI A40', 'AOI', 1, 2, 'pcs', 'D-01-02', 'Cognex', 28000.00, 60),
  ('SP-012', 'ICT-NOZZLE-1', 'ICT测试顶针', 'ICT test probe needle', 'Kim probe ICT', 'TR518II', 'ICT', 100, 50, 'pcs', 'E-01-01', '国产', 25.00, 7),
  ('SP-013', 'ICT-NOZZLE-2', 'ICT真空吸嘴', 'ICT vacuum nozzle', 'Đầu hút chân ICT', 'TR518II', 'ICT', 50, 30, 'pcs', 'E-01-02', '国产', 45.00, 7),
  ('SP-014', 'VACCUM-PUMP-1', '真空泵膜片', 'Vacuum pump diaphragm', 'Màng bơm chân không', 'Universal', 'general', 4, 3, 'pcs', 'F-01-01', '干式真空泵', 1800.00, 21),
  ('SP-015', 'FILTER-HEPA-1', 'HEPA过滤器', 'HEPA air filter', 'Lọc khí HEPA', 'Universal', 'general', 10, 5, 'pcs', 'F-02-01', 'AAF', 2200.00, 30),
  ('SP-016', 'LUBRICANT-GREASE', '轴承润滑脂', 'Bearing lubricant grease', 'Mỡ bôi trơn ổ đỡ', 'Universal', 'general', 20, 10, 'kg', 'F-03-01', '美孚', 180.00, 14),
  ('SP-017', 'BELT-TIMING-1', '同步皮带 100T', 'Timing belt 100T', 'Dây curoa định thời 100T', 'Universal', 'general', 15, 8, 'pcs', 'G-01-01', '盖茨', 85.00, 14),
  ('SP-018', 'MOTOR-SERVO-1', '伺服电机驱动器', 'Servo motor driver', 'Driver động cơ servo', 'Fuji NXT III', 'mounter', 2, 2, 'pcs', 'H-01-01', 'Fuji原厂', 15000.00, 45),
  ('SP-019', 'SPONGE-CLEAN-1', '清洁海绵条', 'Cleaning sponge strip', 'Miếng bọt biển sạch', 'DEK Horizon', 'printer', 30, 15, 'pcs', 'B-02-01', 'DEK原厂', 120.00, 7),
  ('SP-020', 'DISPENSER-SYRINGE', '点胶注射器 30cc', 'Dispensing syringe 30cc', 'Ống tiêm phết keo 30cc', 'Universal', 'general', 50, 20, 'pcs', 'G-02-01', '国产', 15.00, 7);

-- Wear schedule entries (one per active equipment × relevant parts)
INSERT INTO parts_wear_schedule (part_id, equipment_id, equipment_no, installed_at, running_hours, replace_interval_hours, next_replace_due, wear_status) VALUES
  -- eq-001: Fuji NXT III (SMT-NXT-01)
  ('SP-001', 'eq-001', 'SMT-NXT-01', '2026-01-15', 1840, 2000, '2026-07-15', 'warning'),
  ('SP-004', 'eq-001', 'SMT-NXT-01', '2026-03-01', 960, 2000, '2026-10-01', 'normal'),
  ('SP-018', 'eq-001', 'SMT-NXT-01', '2026-02-01', 1200, 4000, '2026-09-01', 'normal'),
  -- eq-002: Fuji NXT III #2 (SMT-NXT-02)
  ('SP-002', 'eq-002', 'SMT-NXT-02', '2026-04-01', 720, 2000, '2026-11-01', 'normal'),
  ('SP-004', 'eq-002', 'SMT-NXT-02', '2026-04-01', 720, 2000, '2026-11-01', 'normal'),
  -- eq-003: DEK Horizon printer (PRINTER-DEK-01)
  ('SP-006', 'eq-003', 'PRINTER-DEK-01', '2026-05-01', 480, 500, '2026-06-28', 'critical'),
  ('SP-007', 'eq-003', 'PRINTER-DEK-01', '2026-05-01', 480, 500, '2026-06-28', 'critical'),
  ('SP-019', 'eq-003', 'PRINTER-DEK-01', '2026-05-15', 360, 400, '2026-07-15', 'normal'),
  -- eq-004: CTI A40 AOI (AOI-CTI-01) — overdue
  ('SP-010', 'eq-004', 'AOI-CTI-01', '2026-01-01', 2100, 2000, '2026-06-10', 'overdue'),
  ('SP-011', 'eq-004', 'AOI-CTI-01', '2026-01-01', 2100, 3000, '2026-08-01', 'warning'),
  -- eq-005: Rehm V8 reflow (REF-V8-01)
  ('SP-008', 'eq-005', 'REF-V8-01', '2026-02-15', 1400, 3000, '2026-09-15', 'normal'),
  ('SP-009', 'eq-005', 'REF-V8-01', '2026-02-15', 1400, 2000, '2026-08-15', 'warning'),
  -- eq-006: DEK Horizon #2 (PRINTER-DEK-02)
  ('SP-006', 'eq-006', 'PRINTER-DEK-02', '2026-03-10', 860, 1000, '2026-08-10', 'normal'),
  ('SP-019', 'eq-006', 'PRINTER-DEK-02', '2026-04-01', 600, 400, '2026-07-01', 'warning');

-- Consumption log (last 30 days evidence)
INSERT INTO parts_consumption_log (part_id, equipment_id, work_order_code, quantity, reason, operator_name, consumed_at) VALUES
  ('SP-001', 'eq-001', '26061010001', 1, 'corrective', 'Pham Van Long', '2026-06-25'),
  ('SP-004', 'eq-001', '26061010001', 2, 'preventive', 'Pham Van Long', '2026-06-20'),
  ('SP-006', 'eq-003', '26061010002', 1, 'preventive_scheduled', 'Dang Van Nam', '2026-06-22'),
  ('SP-010', 'eq-004', '26061010003', 1, 'breakdown', 'Hoang Van Cuong', '2026-06-10'),
  ('SP-019', 'eq-003', '26061010002', 3, 'preventive', 'Dang Van Nam', '2026-06-18'),
  ('SP-004', 'eq-002', '26061010004', 1, 'preventive', 'Le Thi Mai', '2026-06-15'),
  ('SP-007', 'eq-003', '26061010002', 1, 'corrective', 'Dang Van Nam', '2026-06-26'),
  ('SP-003', 'eq-001', '26061010001', 5, 'preventive', 'Pham Van Long', '2026-06-10'),
  ('SP-017', 'eq-005', NULL, 1, 'preventive_scheduled', 'Hoang Van Cuong', '2026-06-05'),
  ('SP-009', 'eq-005', NULL, 1, 'corrective', 'Hoang Van Cuong', '2026-06-20');

-- Active alerts
INSERT INTO parts_wear_alerts (part_id, equipment_id, alert_type, severity, message, current_stock, min_stock, running_hours, replace_interval_hours, created_at) VALUES
  ('SP-006', 'eq-003', 'wear_critical', 'critical', 'DEK印刷机刮刀已使用480小时，接近500小时更换周期', 8, 5, 480, 500, '2026-06-26'),
  ('SP-007', 'eq-003', 'wear_critical', 'critical', 'DEK印刷机刮刀已使用480小时，接近500小时更换周期', 6, 5, 480, 500, '2026-06-26'),
  ('SP-010', 'eq-004', 'overdue', 'critical', 'AOI相机光源已使用2100小时，超出2000小时更换周期，请立即更换', 2, 2, 2100, 2000, '2026-06-11'),
  ('SP-018', 'eq-001', 'low_stock', 'warning', 'SMT-NXT-01伺高分子驱动器的当前库存为2件，等于最低库存警戒线', 2, 2, NULL, NULL, '2026-06-27');
