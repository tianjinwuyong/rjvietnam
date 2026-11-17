-- Migration: 074_factory_production_lines.sql
-- Seeds the 5 production lines and their stations for 瑞晶越南工厂
-- Run after: 073_material_dispatch.sql

-- ── 5 Production Lines ──────────────────────────────────────────────────────────
INSERT INTO production_lines (internal_code, numeric_line_code, name_zh, name_en, name_vi, status)
VALUES
  ('L001', '01', 'SMT产线', 'SMT Line', 'Dây chuyền SMT', 'running'),
  ('L002', '02', '自动线', 'Auto Line', 'Dây chuyền tự động', 'running'),
  ('L003', '03', '包装产线', 'Packaging Line', 'Dây chuyền đóng gói', 'running'),
  ('L004', '04', '手动线', 'Manual Line', 'Dây chuyền thủ công', 'running'),
  ('L005', '05', '回修站', 'Rework Station', 'Trạm sửa chữa', 'running')
ON CONFLICT (internal_code) DO UPDATE SET
  numeric_line_code = EXCLUDED.numeric_line_code,
  name_zh = EXCLUDED.name_zh,
  name_en = EXCLUDED.name_en,
  name_vi = EXCLUDED.name_vi,
  status = EXCLUDED.status;

-- ── Station Types ────────────────────────────────────────────────────────────────
INSERT INTO station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
VALUES
  -- SMT line stations
  ('SMT_LASER',   '镭雕机',        'Laser Marker',        'Máy khắc laze',       'smt',        true,  true),
  ('SMT_AI_INS',  'AI插件机',      'AI Insertion',        'Máy gắn AI',          'smt',        true,  true),
  ('SMT_PRINTER', '印刷机',        'SMT Printer',         'Máy in SMT',          'smt',        true,  true),
  ('SMT_SPI',     'SPI',           'SPI Inspection',      'Kiểm tra SPI',        'smt',        true,  true),
  ('SMT_PNP',     '贴片机',        'Pick & Place',        'Máy đặt linh kiện',  'smt',        true,  true),
  ('SMT_AOI',     'SMT-AOI',       'SMT AOI',             'AOI SMT',              'smt',        true,  true),
  ('SMT_LOAD',     'PD扫码上料',    'PD Scan & Load',      'Quét PD nap liệu',    'smt',        false, true),
  -- Auto line stations
  ('AUTO_LOAD',    '上料扫码',      'Auto Load Scan',      'Quét nạp liệu',       'post_smt',   false, true),
  ('AUTO_AOI',    'AOI质量工位',   'AOI QC Station',      'Trạm AOI QC',         'post_smt',   true,  true),
  ('AUTO_LASER',  '激光打标绑码',  'Laser Mark & Bind',    'Đánh dấu laze',      'post_smt',   true,  true),
  ('AUTO_ICT',    'ICT质量工位',   'ICT QC Station',      'Trạm ICT QC',         'post_smt',   true,  true),
  ('AUTO_FCT',    'FCT',          'FCT',                 'FCT',                  'post_smt',   true,  true),
  ('AUTO_PCBA',   'PCBA分板工位', 'PCBA Routing',        'Trạm chia PCBA',       'post_smt',   true,  true),
  ('AUTO_ASM',    '组装ATE',       'Assembly ATE',         'ATE lắp ráp',         'post_smt',   true,  true),
  ('AUTO_USONIC', '超声',         'Ultrasonic',          'Siêu âm',             'post_smt',   true,  true),
  ('AGING_CAB',    '老化柜',       'Aging Cabinet',       'Tủ gia hoa',          'post_smt',   true,  true),
  ('AUTO_HIPOT',  '高压ATE',      'Hi-Pot Test',         'Kiểm tra ap luc cao',  'post_smt',   true,  true),
  ('AUTO_ATE',    'ATE成品检测',  'Final ATE',          'ATE thành phẩm',      'post_smt',   true,  true),
  ('AUTO_PACK',   '包装工位',     'Packing Station',     'Trạm đóng gói',       'post_smt',   true,  true),
  -- Packaging line stations
  ('PACK_HIPOT',  '高压ATE',      'Packaging Hi-Pot',   'Kiem tra ap luc cao',  'packaging',  true,  true),
  ('PACK_ATE',    '包装ATE',      'Packaging ATE',      'Dong goi ATE',         'packaging',  true,  true),
  ('PACK_SHELL',  '外箱绑码',     'Shell Binding',      'Gan ma hop ngoai',     'packaging',  true,  true),
  ('PACK_PALLET', '栈板绑码',     'Pallet Binding',     'Gan ma khay',          'packaging',  true,  true),
  -- Manual line stations
  ('MAN_PDA',     'PDA扫码上料',  'PDA Scan & Load',    'Quét PDA nap lieu',   'manual',     false, true),
  ('MAN_AOI',     'AOI质量工位',  'Manual AOI',         'AOI thủ công',        'manual',     true,  true),
  ('MAN_ICT',     'ICT',          'Manual ICT',          'ICT thủ công',        'manual',     true,  true),
  ('MAN_FCT',     'FCT',          'Manual FCT',          'FCT thủ công',        'manual',     true,  true),
  ('MAN_PCBA',    'PCBA分板工位', 'Manual PCBA Routing', 'PCBA thủ công',       'manual',     true,  true),
  ('MAN_SHELL',   'PCBA外壳绑码', 'Shell Binding',       'Gan ma vo PCBA',       'manual',     true,  true),
  ('MAN_ASM',     '组装ATE',       'Manual Assembly ATE', 'ATE lap rap thu cong', 'manual',    true,  true),
  ('MAN_USONIC',  '超声',         'Manual Ultrasonic',   'Sieu am thu cong',     'manual',    true,  true),
  ('MAN_AGING',   '成品老化',     'Manual Aging',        'Gia hoa thanh pham',  'manual',    true,  true),
  ('MAN_HIPOT',   '高压ATE',      'Manual Hi-Pot',      'Ap luc cao thu cong',  'manual',    true,  true),
  ('MAN_PACK_ATE','包装ATE',      'Manual Pack ATE',     'Dong goi thu cong',   'manual',    true,  true),
  ('MAN_SHELL_B', '外箱绑码',     'Manual Shell Bind',   'Gan hop ngoai thu cong','manual',    true,  true),
  ('MAN_PALLET_B','栈板绑码',     'Manual Pallet Bind', 'Gan khay thu cong',   'manual',    true,  true),
  -- Rework station
  ('REWORK',      '回修站质量工位','Rework QC Station',  'Trạm SC QC',           'repair',     true,  true)
ON CONFLICT (code) DO UPDATE SET
  name_zh = EXCLUDED.name_zh,
  name_en = EXCLUDED.name_en,
  name_vi = EXCLUDED.name_vi,
  category = EXCLUDED.category,
  has_hardware = EXCLUDED.has_hardware,
  has_software = EXCLUDED.has_software;

-- ── Station Instances ────────────────────────────────────────────────────────────
do $$
declare
  v_l001 bigint; v_l002 bigint; v_l003 bigint; v_l004 bigint; v_l005 bigint;
  v bigint;
begin
  SELECT id INTO v_l001 FROM production_lines WHERE internal_code = 'L001';
  SELECT id INTO v_l002 FROM production_lines WHERE internal_code = 'L002';
  SELECT id INTO v_l003 FROM production_lines WHERE internal_code = 'L003';
  SELECT id INTO v_l004 FROM production_lines WHERE internal_code = 'L004';
  SELECT id INTO v_l005 FROM production_lines WHERE internal_code = 'L005';

  -- L001: SMT Line (7 stations)
  INSERT INTO stations (line_id, code, station_type_id, name_zh, name_en, name_vi, sequence_order, status)
  SELECT v_l001, 'SMT-LASER-01', id, '镭雕机', 'Laser Marker', 'May khac laze', 1, 'idle'
  FROM station_types WHERE code = 'SMT_LASER'
  ON CONFLICT (line_id, code) DO NOTHING;

  INSERT INTO stations (line_id, code, station_type_id, name_zh, name_en, name_vi, sequence_order, status)
  SELECT v_l001, 'SMT-AI-01', id, 'AI插件机', 'AI Insertion', 'May gan AI', 2, 'idle'
  FROM station_types WHERE code = 'SMT_AI_INS'
  ON CONFLICT (line_id, code) DO NOTHING;

  INSERT INTO stations (line_id, code, station_type_id, name_zh, name_en, name_vi, sequence_order, status)
  SELECT v_l001, 'SMT-PRINT-01', id, '印刷机', 'SMT Printer', 'May in SMT', 3, 'idle'
  FROM station_types WHERE code = 'SMT_PRINTER'
  ON CONFLICT (line_id, code) DO NOTHING;

  INSERT INTO stations (line_id, code, station_type_id, name_zh, name_en, name_vi, sequence_order, status)
  SELECT v_l001, 'SMT-SPI-01', id, 'SPI', 'SPI Inspection', 'Kiem tra SPI', 4, 'idle'
  FROM station_types WHERE code = 'SMT_SPI'
  ON CONFLICT (line_id, code) DO NOTHING;

  INSERT INTO stations (line_id, code, station_type_id, name_zh, name_en, name_vi, sequence_order, status)
  SELECT v_l001, 'SMT-PNP-01', id, '贴片机', 'Pick & Place', 'May dat linh kien', 5, 'idle'
  FROM station_types WHERE code = 'SMT_PNP'
  ON CONFLICT (line_id, code) DO NOTHING;

  INSERT INTO stations (line_id, code, station_type_id, name_zh, name_en, name_vi, sequence_order, status)
  SELECT v_l001, 'SMT-AOI-01', id, 'SMT-AOI', 'SMT AOI', 'AOI SMT', 6, 'idle'
  FROM station_types WHERE code = 'SMT_AOI'
  ON CONFLICT (line_id, code) DO NOTHING;

  INSERT INTO stations (line_id, code, station_type_id, name_zh, name_en, name_vi, sequence_order, status)
  SELECT v_l001, 'SMT-LOAD-01', id, 'PD扫码上料', 'PD Scan & Load', 'Quet PD nap lieu', 7, 'idle'
  FROM station_types WHERE code = 'SMT_LOAD'
  ON CONFLICT (line_id, code) DO NOTHING;

  -- L002: Auto Line (12 stations, IPs .50-.60)
  INSERT INTO stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, sequence_order, status)
  SELECT v_l002, 'AUTO-LOAD-01', id, '上料扫码', 'Auto Load Scan', 'Quet nap lieu', NULL, 1, 'idle'
  FROM station_types WHERE code = 'AUTO_LOAD'
  ON CONFLICT (line_id, code) DO NOTHING;

  INSERT INTO stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, sequence_order, status)
  SELECT v_l002, 'AUTO-AOI-01', id, 'AOI质量工位', 'AOI QC Station', 'Tram AOI QC', '192.168.6.50', 2, 'idle'
  FROM station_types WHERE code = 'AUTO_AOI'
  ON CONFLICT (line_id, code) DO NOTHING;

  INSERT INTO stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, sequence_order, status)
  SELECT v_l002, 'AUTO-LASER-01', id, '激光打标绑码', 'Laser Mark & Bind', 'Danh dau laze', '192.168.6.54', 3, 'idle'
  FROM station_types WHERE code = 'AUTO_LASER'
  ON CONFLICT (line_id, code) DO NOTHING;

  INSERT INTO stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, sequence_order, status)
  SELECT v_l002, 'AUTO-ICT-01', id, 'ICT质量工位', 'ICT QC Station', 'Tram ICT QC', '192.168.3.85', 4, 'running'
  FROM station_types WHERE code = 'AUTO_ICT'
  ON CONFLICT (line_id, code) DO NOTHING;

  INSERT INTO stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, sequence_order, status)
  SELECT v_l002, 'AUTO-FCT-01', id, 'FCT', 'FCT', 'FCT', '192.168.6.52', 5, 'idle'
  FROM station_types WHERE code = 'AUTO_FCT'
  ON CONFLICT (line_id, code) DO NOTHING;

  INSERT INTO stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, sequence_order, status)
  SELECT v_l002, 'AUTO-PCBA-01', id, 'PCBA分板工位', 'PCBA Routing', 'Tram chia PCBA', '192.168.6.53', 6, 'idle'
  FROM station_types WHERE code = 'AUTO_PCBA'
  ON CONFLICT (line_id, code) DO NOTHING;

  INSERT INTO stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, sequence_order, status)
  SELECT v_l002, 'AUTO-ASM-01', id, '组装ATE', 'Assembly ATE', 'ATE lap rap', '192.168.6.55', 7, 'idle'
  FROM station_types WHERE code = 'AUTO_ASM'
  ON CONFLICT (line_id, code) DO NOTHING;

  INSERT INTO stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, sequence_order, status)
  SELECT v_l002, 'AUTO-USONIC-01', id, '超声', 'Ultrasonic', 'Sieu am', '192.168.6.56', 8, 'idle'
  FROM station_types WHERE code = 'AUTO_USONIC'
  ON CONFLICT (line_id, code) DO NOTHING;

  INSERT INTO stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, sequence_order, status)
  SELECT v_l002, 'AGING-CAB-01', id, '老化柜', 'Aging Cabinet', 'Tu gia hoa', '192.168.6.57', 9, 'running'
  FROM station_types WHERE code = 'AGING_CAB'
  ON CONFLICT (line_id, code) DO NOTHING;

  INSERT INTO stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, sequence_order, status)
  SELECT v_l002, 'AUTO-HIPOT-01', id, '高压ATE', 'Hi-Pot Test', 'Kiem tra ap luc cao', '192.168.6.58', 10, 'idle'
  FROM station_types WHERE code = 'AUTO_HIPOT'
  ON CONFLICT (line_id, code) DO NOTHING;

  INSERT INTO stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, sequence_order, status)
  SELECT v_l002, 'AUTO-ATE-01', id, 'ATE成品检测', 'Final ATE', 'ATE thanh pham', '192.168.6.59', 11, 'idle'
  FROM station_types WHERE code = 'AUTO_ATE'
  ON CONFLICT (line_id, code) DO NOTHING;

  INSERT INTO stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, sequence_order, status)
  SELECT v_l002, 'AUTO-PACK-01', id, '包装工位', 'Packing Station', 'Tram dong goi', '192.168.6.60', 12, 'idle'
  FROM station_types WHERE code = 'AUTO_PACK'
  ON CONFLICT (line_id, code) DO NOTHING;

  -- L003: Packaging Line (4 stations)
  INSERT INTO stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, sequence_order, status)
  SELECT v_l003, 'PACK-HIPOT-01', id, '高压ATE', 'Packaging Hi-Pot', 'Kiem tra ap luc cao', '192.168.6.58', 1, 'idle'
  FROM station_types WHERE code = 'PACK_HIPOT'
  ON CONFLICT (line_id, code) DO NOTHING;

  INSERT INTO stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, sequence_order, status)
  SELECT v_l003, 'PACK-ATE-01', id, '包装ATE', 'Packaging ATE', 'Dong goi ATE', '192.168.6.59', 2, 'idle'
  FROM station_types WHERE code = 'PACK_ATE'
  ON CONFLICT (line_id, code) DO NOTHING;

  INSERT INTO stations (line_id, code, station_type_id, name_zh, name_en, name_vi, sequence_order, status)
  SELECT v_l003, 'PACK-SHELL-01', id, '外箱绑码', 'Shell Binding', 'Gan ma hop ngoai', 3, 'idle'
  FROM station_types WHERE code = 'PACK_SHELL'
  ON CONFLICT (line_id, code) DO NOTHING;

  INSERT INTO stations (line_id, code, station_type_id, name_zh, name_en, name_vi, sequence_order, status)
  SELECT v_l003, 'PACK-PALLET-01', id, '栈板绑码', 'Pallet Binding', 'Gan ma khay', 4, 'idle'
  FROM station_types WHERE code = 'PACK_PALLET'
  ON CONFLICT (line_id, code) DO NOTHING;

  -- L004: Manual Line (13 stations)
  INSERT INTO stations (line_id, code, station_type_id, name_zh, name_en, name_vi, sequence_order, status)
  SELECT v_l004, 'MAN-PDA-01', id, 'PDA扫码上料', 'PDA Scan & Load', 'Quet PDA nap lieu', 1, 'idle'
  FROM station_types WHERE code = 'MAN_PDA'
  ON CONFLICT (line_id, code) DO NOTHING;

  INSERT INTO stations (line_id, code, station_type_id, name_zh, name_en, name_vi, sequence_order, status)
  SELECT v_l004, 'MAN-AOI-01', id, 'AOI质量工位', 'Manual AOI', 'AOI thu cong', 2, 'idle'
  FROM station_types WHERE code = 'MAN_AOI'
  ON CONFLICT (line_id, code) DO NOTHING;

  INSERT INTO stations (line_id, code, station_type_id, name_zh, name_en, name_vi, sequence_order, status)
  SELECT v_l004, 'MAN-ICT-01', id, 'ICT', 'Manual ICT', 'ICT thu cong', 3, 'idle'
  FROM station_types WHERE code = 'MAN_ICT'
  ON CONFLICT (line_id, code) DO NOTHING;

  INSERT INTO stations (line_id, code, station_type_id, name_zh, name_en, name_vi, sequence_order, status)
  SELECT v_l004, 'MAN-FCT-01', id, 'FCT', 'Manual FCT', 'FCT thu cong', 4, 'idle'
  FROM station_types WHERE code = 'MAN_FCT'
  ON CONFLICT (line_id, code) DO NOTHING;

  INSERT INTO stations (line_id, code, station_type_id, name_zh, name_en, name_vi, sequence_order, status)
  SELECT v_l004, 'MAN-PCBA-01', id, 'PCBA分板工位', 'Manual PCBA Routing', 'PCBA thu cong', 5, 'idle'
  FROM station_types WHERE code = 'MAN_PCBA'
  ON CONFLICT (line_id, code) DO NOTHING;

  INSERT INTO stations (line_id, code, station_type_id, name_zh, name_en, name_vi, sequence_order, status)
  SELECT v_l004, 'MAN-SHELL-01', id, 'PCBA外壳绑码', 'Shell Binding', 'Gan ma vo PCBA', 6, 'idle'
  FROM station_types WHERE code = 'MAN_SHELL'
  ON CONFLICT (line_id, code) DO NOTHING;

  INSERT INTO stations (line_id, code, station_type_id, name_zh, name_en, name_vi, sequence_order, status)
  SELECT v_l004, 'MAN-ASM-01', id, '组装ATE', 'Manual Assembly ATE', 'ATE lap rap thu cong', 7, 'idle'
  FROM station_types WHERE code = 'MAN_ASM'
  ON CONFLICT (line_id, code) DO NOTHING;

  INSERT INTO stations (line_id, code, station_type_id, name_zh, name_en, name_vi, sequence_order, status)
  SELECT v_l004, 'MAN-USONIC-01', id, '超声', 'Manual Ultrasonic', 'Sieu am thu cong', 8, 'idle'
  FROM station_types WHERE code = 'MAN_USONIC'
  ON CONFLICT (line_id, code) DO NOTHING;

  INSERT INTO stations (line_id, code, station_type_id, name_zh, name_en, name_vi, sequence_order, status)
  SELECT v_l004, 'MAN-AGING-01', id, '成品老化', 'Manual Aging', 'Gia hoa thanh pham', 9, 'idle'
  FROM station_types WHERE code = 'MAN_AGING'
  ON CONFLICT (line_id, code) DO NOTHING;

  INSERT INTO stations (line_id, code, station_type_id, name_zh, name_en, name_vi, sequence_order, status)
  SELECT v_l004, 'MAN-HIPOT-01', id, '高压ATE', 'Manual Hi-Pot', 'Ap luc cao thu cong', 10, 'idle'
  FROM station_types WHERE code = 'MAN_HIPOT'
  ON CONFLICT (line_id, code) DO NOTHING;

  INSERT INTO stations (line_id, code, station_type_id, name_zh, name_en, name_vi, sequence_order, status)
  SELECT v_l004, 'MAN-PACK-ATE-01', id, '包装ATE', 'Manual Pack ATE', 'Dong goi thu cong', 11, 'idle'
  FROM station_types WHERE code = 'MAN_PACK_ATE'
  ON CONFLICT (line_id, code) DO NOTHING;

  INSERT INTO stations (line_id, code, station_type_id, name_zh, name_en, name_vi, sequence_order, status)
  SELECT v_l004, 'MAN-SHELL-B-01', id, '外箱绑码', 'Manual Shell Bind', 'Gan hop ngoai thu cong', 12, 'idle'
  FROM station_types WHERE code = 'MAN_SHELL_B'
  ON CONFLICT (line_id, code) DO NOTHING;

  INSERT INTO stations (line_id, code, station_type_id, name_zh, name_en, name_vi, sequence_order, status)
  SELECT v_l004, 'MAN-PALLET-B-01', id, '栈板绑码', 'Manual Pallet Bind', 'Gan khay thu cong', 13, 'idle'
  FROM station_types WHERE code = 'MAN_PALLET_B'
  ON CONFLICT (line_id, code) DO NOTHING;

  -- L005: Rework Station
  INSERT INTO stations (line_id, code, station_type_id, name_zh, name_en, name_vi, sequence_order, status)
  SELECT v_l005, 'REWORK-01', id, '回修站质量工位', 'Rework QC Station', 'Tram SC QC', 1, 'idle'
  FROM station_types WHERE code = 'REWORK'
  ON CONFLICT (line_id, code) DO NOTHING;

  RAISE NOTICE '074_factory_production_lines: 5 lines + stations seeded';
end $$;
