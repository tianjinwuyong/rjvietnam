-- Migration: Add manual line stations (L004)
-- Station codes as specified by user

DO $$
DECLARE
  v_line bigint;
BEGIN
  SELECT id INTO v_line FROM production_lines WHERE internal_code = 'L004';
  IF v_line IS NULL THEN
    RAISE NOTICE 'L004 not found, skipping';
    RETURN;
  END IF;

  -- ── Station Types ─────────────────────────────────────────────────────────

  INSERT INTO station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
  VALUES ('MAN_AIO', '手动AOI', 'Manual AOI', 'AOI thu cong', 'production', true, true)
  ON CONFLICT (code) DO NOTHING;

  INSERT INTO station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
  VALUES ('MAN_ICT', '手动ICT', 'Manual ICT', 'ICT thu cong', 'production', true, true)
  ON CONFLICT (code) DO NOTHING;

  INSERT INTO station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
  VALUES ('MAN_FCT', '手动FCT', 'Manual FCT', 'FCT thu cong', 'production', true, true)
  ON CONFLICT (code) DO NOTHING;

  INSERT INTO station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
  VALUES ('MAN_DEPANEL', '手动分板', 'Manual Depanel', 'Chia ban thu cong', 'production', true, true)
  ON CONFLICT (code) DO NOTHING;

  INSERT INTO station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
  VALUES ('MAN_SHELL_BINDING', '外壳绑码', 'Shell Binding', 'Gan ma vo', 'production', true, true)
  ON CONFLICT (code) DO NOTHING;

  -- ── Stations ──────────────────────────────────────────────────────────────

  INSERT INTO stations (line_id, code, station_type_id, name_zh, name_en, name_vi, sequence_order, status)
  SELECT v_line, 'manu_aio', id, '手动AOI', 'Manual AOI', 'AOI thu cong', 2, 'idle'
  FROM station_types WHERE code = 'MAN_AIO'
  ON CONFLICT (line_id, code) DO UPDATE SET name_zh = EXCLUDED.name_zh, name_en = EXCLUDED.name_en, name_vi = EXCLUDED.name_vi;

  INSERT INTO stations (line_id, code, station_type_id, name_zh, name_en, name_vi, sequence_order, status)
  SELECT v_line, 'manu_ict', id, '手动ICT', 'Manual ICT', 'ICT thu cong', 3, 'idle'
  FROM station_types WHERE code = 'MAN_ICT'
  ON CONFLICT (line_id, code) DO UPDATE SET name_zh = EXCLUDED.name_zh, name_en = EXCLUDED.name_en, name_vi = EXCLUDED.name_vi;

  INSERT INTO stations (line_id, code, station_type_id, name_zh, name_en, name_vi, sequence_order, status)
  SELECT v_line, 'manu_fct', id, '手动FCT', 'Manual FCT', 'FCT thu cong', 4, 'idle'
  FROM station_types WHERE code = 'MAN_FCT'
  ON CONFLICT (line_id, code) DO UPDATE SET name_zh = EXCLUDED.name_zh, name_en = EXCLUDED.name_en, name_vi = EXCLUDED.name_vi;

  INSERT INTO stations (line_id, code, station_type_id, name_zh, name_en, name_vi, sequence_order, status)
  SELECT v_line, 'manu_depanel', id, '手动分板', 'Manual Depanel', 'Chia ban thu cong', 5, 'idle'
  FROM station_types WHERE code = 'MAN_DEPANEL'
  ON CONFLICT (line_id, code) DO UPDATE SET name_zh = EXCLUDED.name_zh, name_en = EXCLUDED.name_en, name_vi = EXCLUDED.name_vi;

  INSERT INTO stations (line_id, code, station_type_id, name_zh, name_en, name_vi, sequence_order, status)
  SELECT v_line, 'manu_shellbinding', id, '外壳绑码', 'Shell Binding', 'Gan ma vo', 6, 'idle'
  FROM station_types WHERE code = 'MAN_SHELL_BINDING'
  ON CONFLICT (line_id, code) DO UPDATE SET name_zh = EXCLUDED.name_zh, name_en = EXCLUDED.name_en, name_vi = EXCLUDED.name_vi;

  INSERT INTO stations (line_id, code, station_type_id, name_zh, name_en, name_vi, sequence_order, status)
  SELECT v_line, 'manu_assem_ate', id, '组装ATE', 'Assembly ATE', 'ATE lap rap thu cong', 7, 'idle'
  FROM station_types WHERE code = 'MAN_ASM'
  ON CONFLICT (line_id, code) DO UPDATE SET name_zh = EXCLUDED.name_zh, name_en = EXCLUDED.name_en, name_vi = EXCLUDED.name_vi;

  INSERT INTO stations (line_id, code, station_type_id, name_zh, name_en, name_vi, sequence_order, status)
  SELECT v_line, 'manu_supersonic', id, '超声', 'Manual Ultrasonic', 'Sieu am thu cong', 8, 'idle'
  FROM station_types WHERE code = 'MAN_USONIC'
  ON CONFLICT (line_id, code) DO UPDATE SET name_zh = EXCLUDED.name_zh, name_en = EXCLUDED.name_en, name_vi = EXCLUDED.name_vi;

  INSERT INTO stations (line_id, code, station_type_id, name_zh, name_en, name_vi, sequence_order, status)
  SELECT v_line, 'manu_agingcab', id, '老化柜', 'Aging Cabinet', 'Tu gia hoa', 9, 'idle'
  FROM station_types WHERE code = 'MAN_AGING'
  ON CONFLICT (line_id, code) DO UPDATE SET name_zh = EXCLUDED.name_zh, name_en = EXCLUDED.name_en, name_vi = EXCLUDED.name_vi;

  INSERT INTO stations (line_id, code, station_type_id, name_zh, name_en, name_vi, sequence_order, status)
  SELECT v_line, 'manu_hivolt_ate', id, '高压ATE', 'Hi-Pot Test', 'Kiem tra ap luc cao', 10, 'idle'
  FROM station_types WHERE code = 'MAN_HIPOT'
  ON CONFLICT (line_id, code) DO UPDATE SET name_zh = EXCLUDED.name_zh, name_en = EXCLUDED.name_en, name_vi = EXCLUDED.name_vi;

  INSERT INTO stations (line_id, code, station_type_id, name_zh, name_en, name_vi, sequence_order, status)
  SELECT v_line, 'manu_package_ate', id, '包装ATE', 'Packaging ATE', 'Dong goi ATE', 11, 'idle'
  FROM station_types WHERE code = 'MAN_PACK_ATE'
  ON CONFLICT (line_id, code) DO UPDATE SET name_zh = EXCLUDED.name_zh, name_en = EXCLUDED.name_en, name_vi = EXCLUDED.name_vi;

  INSERT INTO stations (line_id, code, station_type_id, name_zh, name_en, name_vi, sequence_order, status)
  SELECT v_line, 'manu_case_binding', id, '外箱绑码', 'Case Binding', 'Gan hop ngoai', 12, 'idle'
  FROM station_types WHERE code = 'MAN_SHELL_B'
  ON CONFLICT (line_id, code) DO UPDATE SET name_zh = EXCLUDED.name_zh, name_en = EXCLUDED.name_en, name_vi = EXCLUDED.name_vi;

  INSERT INTO stations (line_id, code, station_type_id, name_zh, name_en, name_vi, sequence_order, status)
  SELECT v_line, 'manu_pallet_binding', id, '栈板绑码', 'Pallet Binding', 'Gan khay', 13, 'idle'
  FROM station_types WHERE code = 'MAN_PALLET_B'
  ON CONFLICT (line_id, code) DO UPDATE SET name_zh = EXCLUDED.name_zh, name_en = EXCLUDED.name_en, name_vi = EXCLUDED.name_vi;

  RAISE NOTICE 'Manual line stations created: manu_aio, manu_ict, manu_fct, manu_depanel, manu_shellbinding, manu_assem_ate, manu_supersonic, manu_agingcab, manu_hivolt_ate, manu_package_ate, manu_case_binding, manu_pallet_binding';
END $$;
