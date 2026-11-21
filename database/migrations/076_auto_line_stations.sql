-- Migration: Add auto line stations (L002)
-- Station codes as specified: auto_aio, auto_ict, auto_fct, auto_depanel, etc.

DO $$
DECLARE
  v_line bigint;
BEGIN
  SELECT id INTO v_line FROM production_lines WHERE internal_code = 'L002';
  IF v_line IS NULL THEN
    RAISE NOTICE 'L002 not found, skipping';
    RETURN;
  END IF;

  -- ── Station Types ─────────────────────────────────────────────────────────

  INSERT INTO station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
  VALUES ('AUTO_AIO', '自动AOI', 'Auto AOI', 'AOI tu dong', 'production', true, true)
  ON CONFLICT (code) DO NOTHING;

  INSERT INTO station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
  VALUES ('AUTO_ICT', '自动ICT', 'Auto ICT', 'ICT tu dong', 'production', true, true)
  ON CONFLICT (code) DO NOTHING;

  INSERT INTO station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
  VALUES ('AUTO_FCT', '自动FCT', 'Auto FCT', 'FCT tu dong', 'production', true, true)
  ON CONFLICT (code) DO NOTHING;

  INSERT INTO station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
  VALUES ('AUTO_DEPANEL', '自动分板', 'Auto Depanel', 'Chia ban tu dong', 'production', true, true)
  ON CONFLICT (code) DO NOTHING;

  INSERT INTO station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
  VALUES ('AUTO_SHELL_BINDING', '外壳绑码', 'Auto Shell Binding', 'Gan ma vo tu dong', 'production', true, true)
  ON CONFLICT (code) DO NOTHING;

  INSERT INTO station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
  VALUES ('AUTO_ASM', '组装ATE', 'Auto Assembly ATE', 'ATE lap rap tu dong', 'production', true, true)
  ON CONFLICT (code) DO NOTHING;

  INSERT INTO station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
  VALUES ('AUTO_USONIC', '超声', 'Auto Ultrasonic', 'Sieu am tu dong', 'production', true, true)
  ON CONFLICT (code) DO NOTHING;

  INSERT INTO station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
  VALUES ('AGING_CAB', '老化柜', 'Aging Cabinet', 'Tu gia hoa', 'production', true, true)
  ON CONFLICT (code) DO NOTHING;

  INSERT INTO station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
  VALUES ('AUTO_HIPOT', '高压ATE', 'Auto Hi-Pot', 'Kiem tra ap luc cao', 'production', true, true)
  ON CONFLICT (code) DO NOTHING;

  INSERT INTO station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
  VALUES ('AUTO_ATE', 'ATE成品检测', 'Auto Final ATE', 'ATE thanh pham', 'production', true, true)
  ON CONFLICT (code) DO NOTHING;

  INSERT INTO station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
  VALUES ('AUTO_PACK', '包装工位', 'Auto Packing', 'Dong goi tu dong', 'production', true, true)
  ON CONFLICT (code) DO NOTHING;

  -- ── Stations ──────────────────────────────────────────────────────────────

  INSERT INTO stations (line_id, code, station_type_id, name_zh, name_en, name_vi, sequence_order, status)
  SELECT v_line, 'auto_aio', id, '自动AOI', 'Auto AOI', 'AOI tu dong', 2, 'idle'
  FROM station_types WHERE code = 'AUTO_AIO'
  ON CONFLICT (line_id, code) DO UPDATE SET name_zh = EXCLUDED.name_zh, name_en = EXCLUDED.name_en, name_vi = EXCLUDED.name_vi;

  INSERT INTO stations (line_id, code, station_type_id, name_zh, name_en, name_vi, sequence_order, status)
  SELECT v_line, 'auto_ict', id, '自动ICT', 'Auto ICT', 'ICT tu dong', 4, 'idle'
  FROM station_types WHERE code = 'AUTO_ICT'
  ON CONFLICT (line_id, code) DO UPDATE SET name_zh = EXCLUDED.name_zh, name_en = EXCLUDED.name_en, name_vi = EXCLUDED.name_vi;

  INSERT INTO stations (line_id, code, station_type_id, name_zh, name_en, name_vi, sequence_order, status)
  SELECT v_line, 'auto_fct', id, '自动FCT', 'Auto FCT', 'FCT tu dong', 5, 'idle'
  FROM station_types WHERE code = 'AUTO_FCT'
  ON CONFLICT (line_id, code) DO UPDATE SET name_zh = EXCLUDED.name_zh, name_en = EXCLUDED.name_en, name_vi = EXCLUDED.name_vi;

  INSERT INTO stations (line_id, code, station_type_id, name_zh, name_en, name_vi, sequence_order, status)
  SELECT v_line, 'auto_depanel', id, '自动分板', 'Auto Depanel', 'Chia ban tu dong', 6, 'idle'
  FROM station_types WHERE code = 'AUTO_DEPANEL'
  ON CONFLICT (line_id, code) DO UPDATE SET name_zh = EXCLUDED.name_zh, name_en = EXCLUDED.name_en, name_vi = EXCLUDED.name_vi;

  INSERT INTO stations (line_id, code, station_type_id, name_zh, name_en, name_vi, sequence_order, status)
  SELECT v_line, 'auto_shellbinding', id, '外壳绑码', 'Auto Shell Binding', 'Gan ma vo tu dong', 7, 'idle'
  FROM station_types WHERE code = 'AUTO_SHELL_BINDING'
  ON CONFLICT (line_id, code) DO UPDATE SET name_zh = EXCLUDED.name_zh, name_en = EXCLUDED.name_en, name_vi = EXCLUDED.name_vi;

  INSERT INTO stations (line_id, code, station_type_id, name_zh, name_en, name_vi, sequence_order, status)
  SELECT v_line, 'auto_assem_ate', id, '组装ATE', 'Auto Assembly ATE', 'ATE lap rap tu dong', 8, 'idle'
  FROM station_types WHERE code = 'AUTO_ASM'
  ON CONFLICT (line_id, code) DO UPDATE SET name_zh = EXCLUDED.name_zh, name_en = EXCLUDED.name_en, name_vi = EXCLUDED.name_vi;

  INSERT INTO stations (line_id, code, station_type_id, name_zh, name_en, name_vi, sequence_order, status)
  SELECT v_line, 'auto_supersonic', id, '超声', 'Auto Ultrasonic', 'Sieu am tu dong', 9, 'idle'
  FROM station_types WHERE code = 'AUTO_USONIC'
  ON CONFLICT (line_id, code) DO UPDATE SET name_zh = EXCLUDED.name_zh, name_en = EXCLUDED.name_en, name_vi = EXCLUDED.name_vi;

  INSERT INTO stations (line_id, code, station_type_id, name_zh, name_en, name_vi, sequence_order, status)
  SELECT v_line, 'auto_agingcab', id, '老化柜', 'Aging Cabinet', 'Tu gia hoa', 10, 'idle'
  FROM station_types WHERE code = 'AGING_CAB'
  ON CONFLICT (line_id, code) DO UPDATE SET name_zh = EXCLUDED.name_zh, name_en = EXCLUDED.name_en, name_vi = EXCLUDED.name_vi;

  INSERT INTO stations (line_id, code, station_type_id, name_zh, name_en, name_vi, sequence_order, status)
  SELECT v_line, 'auto_hivolt_ate', id, '高压ATE', 'Auto Hi-Pot', 'Kiem tra ap luc cao', 11, 'idle'
  FROM station_types WHERE code = 'AUTO_HIPOT'
  ON CONFLICT (line_id, code) DO UPDATE SET name_zh = EXCLUDED.name_zh, name_en = EXCLUDED.name_en, name_vi = EXCLUDED.name_vi;

  INSERT INTO stations (line_id, code, station_type_id, name_zh, name_en, name_vi, sequence_order, status)
  SELECT v_line, 'auto_package_ate', id, 'ATE成品检测', 'Auto Final ATE', 'ATE thanh pham', 12, 'idle'
  FROM station_types WHERE code = 'AUTO_ATE'
  ON CONFLICT (line_id, code) DO UPDATE SET name_zh = EXCLUDED.name_zh, name_en = EXCLUDED.name_en, name_vi = EXCLUDED.name_vi;

  INSERT INTO stations (line_id, code, station_type_id, name_zh, name_en, name_vi, sequence_order, status)
  SELECT v_line, 'auto_pallet_binding', id, '栈板绑码', 'Auto Pallet Binding', 'Gan khay tu dong', 13, 'idle'
  FROM station_types WHERE code = 'AUTO_PACK'
  ON CONFLICT (line_id, code) DO UPDATE SET name_zh = EXCLUDED.name_zh, name_en = EXCLUDED.name_en, name_vi = EXCLUDED.name_vi;

  RAISE NOTICE 'Auto line stations created: auto_aio, auto_ict, auto_fct, auto_depanel, auto_shellbinding, auto_assem_ate, auto_supersonic, auto_agingcab, auto_hivolt_ate, auto_package_ate, auto_pallet_binding';
END $$;
