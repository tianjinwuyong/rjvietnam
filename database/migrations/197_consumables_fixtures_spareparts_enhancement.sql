-- Migration 197: P2 — Consumables + Fixtures + Spare Parts Enhancement
-- Grill Q5(D), Q6(D), Q7(D), Q15(A: strict separate tables)
-- Applied: 2026-07-24

BEGIN;

-- ═══════════════════════════════════════════════════════
-- 1. SPARE PARTS ENHANCEMENT (Q5-D: ABC + Min/Max + ROP + Vietnam lead time)
-- ═══════════════════════════════════════════════════════

ALTER TABLE spare_parts ADD COLUMN IF NOT EXISTS abc_class varchar(1) DEFAULT 'C' CHECK (abc_class IN ('A','B','C'));
ALTER TABLE spare_parts ADD COLUMN IF NOT EXISTS max_stock int DEFAULT 0;
ALTER TABLE spare_parts ADD COLUMN IF NOT EXISTS reorder_point int DEFAULT 0;
ALTER TABLE spare_parts ADD COLUMN IF NOT EXISTS safety_stock_days int DEFAULT 7;
ALTER TABLE spare_parts ADD COLUMN IF NOT EXISTS vn_lead_time_days int DEFAULT 7;
ALTER TABLE spare_parts ADD COLUMN IF NOT EXISTS customs_clearance_days int DEFAULT 3;
ALTER TABLE spare_parts ADD COLUMN IF NOT EXISTS is_obsolete boolean DEFAULT false;
ALTER TABLE spare_parts ADD COLUMN IF NOT EXISTS obsolete_date date;
ALTER TABLE spare_parts ADD COLUMN IF NOT EXISTS equipment_asset_id varchar(40);
ALTER TABLE spare_parts ADD COLUMN IF NOT EXISTS last_purchase_date date;
ALTER TABLE spare_parts ADD COLUMN IF NOT EXISTS last_purchase_price numeric(12,2);
ALTER TABLE spare_parts ADD COLUMN IF NOT EXISTS annual_consumption numeric(12,2) DEFAULT 0;
ALTER TABLE spare_parts ADD COLUMN IF NOT EXISTS stock_value numeric(14,2) DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_spare_parts_abc ON spare_parts(abc_class);
CREATE INDEX IF NOT EXISTS idx_spare_parts_reorder ON spare_parts(current_stock, reorder_point) WHERE current_stock <= reorder_point;
CREATE INDEX IF NOT EXISTS idx_spare_parts_obsolete ON spare_parts(is_obsolete) WHERE is_obsolete = true;

-- ═══════════════════════════════════════════════════════
-- 2. CONSUMABLES (Q6-D: count/time dual-track life tracking)
--    易耗品 = 寿命管控 (吸嘴/刮刀/网板/锡膏/滤网/皮带等)
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS consumables (
  id bigserial PRIMARY KEY,
  item_code varchar(40) NOT NULL UNIQUE,
  name_zh varchar(120) NOT NULL,
  name_en varchar(120),
  name_vi varchar(120),
  category varchar(40) NOT NULL DEFAULT 'general',
    -- nozzle(吸嘴) | squeegee(刮刀) | stencil(网板) | solder_paste(锡膏)
    -- filter(滤网) | belt(皮带) | wiper(擦拭纸) | blade(刀片) | general
  tracking_mode varchar(20) NOT NULL DEFAULT 'count',
    -- count(计数) | time(计时) | dual(双轨)
  equipment_type varchar(40),
    -- mounter | printer | reflow | AOI | SPI | wave_solder | ICT | FCT | general
  equipment_asset_id varchar(40),
  specification varchar(200),
  material varchar(80),
  manufacturer varchar(120),
  model_no varchar(80),
  unit varchar(20) DEFAULT 'pcs',
  unit_cost numeric(12,2) DEFAULT 0,
  current_stock int DEFAULT 0,
  min_stock int DEFAULT 0,
  location_code varchar(40),
  -- Life tracking
  expected_life_count int,
  expected_life_hours numeric(12,2),
  current_usage_count int DEFAULT 0,
  current_usage_hours numeric(12,2) DEFAULT 0,
  life_percentage numeric(5,2) DEFAULT 0,
  life_status varchar(20) DEFAULT 'new',
    -- new | in_use | warning | expired | replaced
  installed_at timestamptz,
  replaced_at timestamptz,
  -- Solder paste specific (Q6: 锡膏专项)
  storage_temp_min numeric(5,2),
  storage_temp_max numeric(5,2),
  opened_at timestamptz,
  expiry_after_open_hours int,
  batch_no varchar(60),
  -- Stencil specific (Q6: 网板张力)
  tension_value numeric(8,2),
  tension_min numeric(8,2),
  tension_max numeric(8,2),
  last_tension_check timestamptz,
  -- Vietnam import
  vn_lead_time_days int DEFAULT 7,
  customs_clearance_days int DEFAULT 3,
  supplier varchar(120),
  status varchar(20) DEFAULT 'active' CHECK (status IN ('active','inactive','discontinued')),
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_consumables_category ON consumables(category);
CREATE INDEX IF NOT EXISTS idx_consumables_equipment_type ON consumables(equipment_type);
CREATE INDEX IF NOT EXISTS idx_consumables_life_status ON consumables(life_status);
CREATE INDEX IF NOT EXISTS idx_consumables_tracking ON consumables(tracking_mode);
CREATE INDEX IF NOT EXISTS idx_consumables_low_stock ON consumables(current_stock) WHERE current_stock <= min_stock;
CREATE INDEX IF NOT EXISTS idx_consumables_life_warn ON consumables(life_percentage) WHERE life_percentage >= 80;

-- ═══════════════════════════════════════════════════════
-- 3. CONSUMABLE USAGE LOGS (MES auto + manual)
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS consumable_usage_logs (
  id bigserial PRIMARY KEY,
  consumable_id bigint NOT NULL REFERENCES consumables(id) ON DELETE CASCADE,
  usage_type varchar(20) NOT NULL DEFAULT 'increment',
    -- increment | reset | replace | install | retire
  usage_count int DEFAULT 0,
  usage_hours numeric(12,2) DEFAULT 0,
  source varchar(20) DEFAULT 'manual',
    -- auto(MES) | manual | pm | repair
  equipment_asset_id varchar(40),
  work_order_no varchar(40),
  operator_id varchar(40),
  operator_name varchar(80),
  notes text,
  logged_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_consumable_usage_consumable ON consumable_usage_logs(consumable_id);
CREATE INDEX IF NOT EXISTS idx_consumable_usage_time ON consumable_usage_logs(logged_at);

-- ═══════════════════════════════════════════════════════
-- 4. FIXTURES / JIGS (Q7-D: usage count + cleaning + location + calibration)
--    治具 = FCT/ICT治具, 波峰焊载具, 老化架, 超声波模具等
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS fixtures (
  id bigserial PRIMARY KEY,
  fixture_code varchar(40) NOT NULL UNIQUE,
  name_zh varchar(120) NOT NULL,
  name_en varchar(120),
  name_vi varchar(120),
  fixture_type varchar(40) NOT NULL DEFAULT 'general',
    -- fct_jig | ict_jig | wave_pallet | burnin_rack | ultrasonic_horn
    -- test_fixture | assembly_jig | solder_stencil | general
  product_code varchar(60),
  product_name varchar(120),
  equipment_type varchar(40),
  equipment_asset_id varchar(40),
  manufacturer varchar(120),
  model_no varchar(80),
  serial_no varchar(80),
  -- Usage tracking
  max_usage_count int,
  current_usage_count int DEFAULT 0,
  usage_percentage numeric(5,2) DEFAULT 0,
  usage_status varchar(20) DEFAULT 'available',
    -- available | in_use | cleaning | maintenance | calibration | retired
  -- Location (定置管理)
  storage_location varchar(80),
  storage_zone varchar(40),
  current_location varchar(80),
  -- Cleaning
  cleaning_interval_uses int DEFAULT 100,
  uses_since_cleaning int DEFAULT 0,
  last_cleaned_at timestamptz,
  cleaning_method varchar(120),
  -- Calibration
  calibration_interval_days int,
  last_calibration_date date,
  next_calibration_date date,
  calibration_status varchar(20) DEFAULT 'valid',
    -- valid | expiring | expired | na
  -- Status & lifecycle
  status varchar(20) DEFAULT 'active' CHECK (status IN ('active','inactive','retired','scrapped')),
  purchase_date date,
  purchase_price numeric(12,2),
  warranty_expiry date,
  -- Vietnam import
  vn_lead_time_days int DEFAULT 14,
  customs_clearance_days int DEFAULT 3,
  import_customs_no varchar(60),
  supplier varchar(120),
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fixtures_type ON fixtures(fixture_type);
CREATE INDEX IF NOT EXISTS idx_fixtures_product ON fixtures(product_code);
CREATE INDEX IF NOT EXISTS idx_fixtures_status ON fixtures(status);
CREATE INDEX IF NOT EXISTS idx_fixtures_usage ON fixtures(usage_percentage) WHERE usage_percentage >= 80;
CREATE INDEX IF NOT EXISTS idx_fixtures_calibration ON fixtures(next_calibration_date) WHERE calibration_status != 'na';
CREATE INDEX IF NOT EXISTS idx_fixtures_cleaning ON fixtures(uses_since_cleaning, cleaning_interval_uses);

-- ═══════════════════════════════════════════════════════
-- 5. FIXTURE USAGE LOGS (领用/归还/使用)
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS fixture_usage_logs (
  id bigserial PRIMARY KEY,
  fixture_id bigint NOT NULL REFERENCES fixtures(id) ON DELETE CASCADE,
  action varchar(20) NOT NULL,
    -- checkout(领用) | return(归还) | use(使用) | retire(报废)
  usage_count int DEFAULT 1,
  product_code varchar(60),
  work_order_no varchar(40),
  line_code varchar(20),
  operator_id varchar(40),
  operator_name varchar(80),
  from_location varchar(80),
  to_location varchar(80),
  condition_before varchar(20) DEFAULT 'good',
  condition_after varchar(20) DEFAULT 'good',
    -- good | worn | damaged | needs_repair
  notes text,
  logged_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fixture_usage_fixture ON fixture_usage_logs(fixture_id);
CREATE INDEX IF NOT EXISTS idx_fixture_usage_time ON fixture_usage_logs(logged_at);
CREATE INDEX IF NOT EXISTS idx_fixture_usage_product ON fixture_usage_logs(product_code);

-- ═══════════════════════════════════════════════════════
-- 6. FIXTURE CLEANING RECORDS
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS fixture_cleaning_records (
  id bigserial PRIMARY KEY,
  fixture_id bigint NOT NULL REFERENCES fixtures(id) ON DELETE CASCADE,
  cleaning_type varchar(30) DEFAULT 'routine',
    -- routine | deep | repair | pre_production
  cleaned_by varchar(80),
  cleaning_method varchar(120),
  cleaning_agent varchar(80),
  result varchar(20) DEFAULT 'pass',
    -- pass | fail | needs_rework
  usage_count_at_cleaning int DEFAULT 0,
  notes text,
  cleaned_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fixture_cleaning_fixture ON fixture_cleaning_records(fixture_id);

-- ═══════════════════════════════════════════════════════
-- 7. SEED DATA — Adapter factory consumables & fixtures
-- ═══════════════════════════════════════════════════════

-- Consumables seed
INSERT INTO consumables (item_code, name_zh, name_en, category, tracking_mode, equipment_type, specification, expected_life_count, expected_life_hours, unit, unit_cost, current_stock, min_stock)
VALUES
  ('CZ-NPM-001', 'NPM吸嘴 205', 'NPM Nozzle 205', 'nozzle', 'count', 'mounter', 'Panasonic NPM-D3 205吸嘴', 500000, NULL, 'pcs', 35.00, 24, 10),
  ('CZ-NPM-002', 'NPM吸嘴 110', 'NPM Nozzle 110', 'nozzle', 'count', 'mounter', 'Panasonic NPM-D3 110吸嘴', 500000, NULL, 'pcs', 28.00, 36, 12),
  ('CZ-SCR-001', 'DEK刮刀 300mm', 'DEK Squeegee 300mm', 'squeegee', 'count', 'printer', 'DEK Horizon 300mm金属刮刀', 100000, NULL, 'pcs', 120.00, 6, 2),
  ('CZ-STN-001', 'SMT钢网 AD-01', 'SMT Stencil AD-01', 'stencil', 'count', 'printer', '适配器主板钢网 0.12mm', 50000, NULL, 'pcs', 250.00, 3, 1),
  ('CZ-SP-001', '锡膏 SAC305 T4', 'Solder Paste SAC305 T4', 'solder_paste', 'time', 'printer', 'Alpha SAC305 T4 500g', NULL, 8, 'jar', 85.00, 12, 4),
  ('CZ-FLT-001', '回流焊滤网', 'Reflow Filter', 'filter', 'time', 'reflow', 'BTU回流焊炉滤网', NULL, 2000, 'pcs', 45.00, 8, 3),
  ('CZ-BLT-001', '波峰焊传动皮带', 'Wave Solder Belt', 'belt', 'time', 'wave_solder', '波峰焊钛爪传动皮带', NULL, 3000, 'pcs', 65.00, 4, 2),
  ('CZ-WPR-001', '擦拭纸卷', 'Wiper Paper Roll', 'wiper', 'count', 'printer', 'DEK擦拭纸 100m/卷', 2000, NULL, 'roll', 15.00, 30, 10)
ON CONFLICT (item_code) DO NOTHING;

-- Fixtures seed
INSERT INTO fixtures (fixture_code, name_zh, name_en, fixture_type, product_code, product_name, max_usage_count, cleaning_interval_uses, calibration_interval_days, storage_location, purchase_price)
VALUES
  ('FX-FCT-001', 'FCT治具 AD-65W', 'FCT Jig AD-65W', 'fct_jig', 'AD-65W', '65W适配器', 100000, 500, 90, 'A区-FCT-01', 3500.00),
  ('FX-FCT-002', 'FCT治具 AD-30W', 'FCT Jig AD-30W', 'fct_jig', 'AD-30W', '30W适配器', 100000, 500, 90, 'A区-FCT-02', 2800.00),
  ('FX-ICT-001', 'ICT治具 AD-65W', 'ICT Jig AD-65W', 'ict_jig', 'AD-65W', '65W适配器', 200000, 1000, 180, 'A区-ICT-01', 5200.00),
  ('FX-WVP-001', '波峰焊载具 AD-65W', 'Wave Pallet AD-65W', 'wave_pallet', 'AD-65W', '65W适配器', 50000, 200, NULL, 'B区-WAVE-01', 800.00),
  ('FX-WVP-002', '波峰焊载具 AD-30W', 'Wave Pallet AD-30W', 'wave_pallet', 'AD-30W', '30W适配器', 50000, 200, NULL, 'B区-WAVE-02', 750.00),
  ('FX-BIR-001', '老化架 AD系列', 'Burn-in Rack AD Series', 'burnin_rack', 'AD-SERIES', '适配器系列', NULL, NULL, 365, 'C区-BURNIN-01', 1200.00),
  ('FX-USH-001', '超声波模具 AD-65W', 'Ultrasonic Horn AD-65W', 'ultrasonic_horn', 'AD-65W', '65W适配器', 300000, 1000, 60, 'D区-ULTRA-01', 1500.00)
ON CONFLICT (fixture_code) DO NOTHING;

COMMIT;
