-- Add missing station types and station instances for factory stations
-- Corrects schema to match actual station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
-- and stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)

do $$
declare
  v_line_auto int;
  v_line_manual int;
  v_sttype_aging int;
  v_sttype_pack_ate int;
  v_sttype_shell_bind int;
  v_sttype_pallet_bind int;
  v_sttype_asm_ate int;
  v_sttype_mat_load int;
  v_sttype_hipot int;
begin
  SELECT id INTO v_line_auto FROM production_lines WHERE internal_code = 'L002';
  SELECT id INTO v_line_manual FROM production_lines WHERE internal_code = 'L004';

  IF v_line_auto IS NULL OR v_line_manual IS NULL THEN
    RAISE EXCEPTION 'Canonical production lines L002/L004 must exist before station creation';
  END IF;

  -- Station types (code must be unique globally)
  INSERT INTO station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
  VALUES ('AGING', '老化', 'Aging', 'Gia hoa', 'production', true, false)
  ON CONFLICT (code) DO NOTHING;
  SELECT id INTO v_sttype_aging FROM station_types WHERE code = 'AGING';

  INSERT INTO station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
  VALUES ('PACK-ATE', '包装ATE', 'Packaging ATE', 'Dong goi ATE', 'production', true, true)
  ON CONFLICT (code) DO NOTHING;
  SELECT id INTO v_sttype_pack_ate FROM station_types WHERE code = 'PACK-ATE';

  INSERT INTO station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
  VALUES ('SHELL-BIND', '外箱绑码', 'Shell Binding', 'Gan ma hop ngoai', 'production', true, true)
  ON CONFLICT (code) DO NOTHING;
  SELECT id INTO v_sttype_shell_bind FROM station_types WHERE code = 'SHELL-BIND';

  INSERT INTO station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
  VALUES ('PALLET-BIND', '栈板绑码', 'Pallet Binding', 'Gan ma khay', 'production', true, true)
  ON CONFLICT (code) DO NOTHING;
  SELECT id INTO v_sttype_pallet_bind FROM station_types WHERE code = 'PALLET-BIND';

  INSERT INTO station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
  VALUES ('ASM-ATE', '组装ATE', 'Assembly ATE', 'ATE Lap rap', 'production', true, true)
  ON CONFLICT (code) DO NOTHING;
  SELECT id INTO v_sttype_asm_ate FROM station_types WHERE code = 'ASM-ATE';

  INSERT INTO station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
  VALUES ('MAT-LOAD', '投料', 'Material Loading', 'Nap lieu', 'production', false, true)
  ON CONFLICT (code) DO NOTHING;
  SELECT id INTO v_sttype_mat_load FROM station_types WHERE code = 'MAT-LOAD';

  INSERT INTO station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
  VALUES ('HIPOT', '高压ATE', 'High-voltage ATE', 'ATE cao áp', 'production', true, true)
  ON CONFLICT (code) DO NOTHING;
  SELECT id INTO v_sttype_hipot FROM station_types WHERE code = 'HIPOT';

  -- Stations (unique by line_id + code)
  INSERT INTO stations (line_id, code, station_type_id, name_zh, name_en, name_vi, status)
  VALUES (v_line_auto, 'AGING-CAB-01', v_sttype_aging, '老化柜', 'Aging Cabinet', 'Tu gia hoa', 'idle')
  ON CONFLICT (line_id, code) DO NOTHING;

  INSERT INTO stations (line_id, code, station_type_id, name_zh, name_en, name_vi, status)
  VALUES (v_line_auto, 'MAT-LOAD-01', v_sttype_mat_load, '投料', 'Material Loading', 'Nap lieu', 'idle')
  ON CONFLICT (line_id, code) DO NOTHING;

  INSERT INTO stations (line_id, code, station_type_id, name_zh, name_en, name_vi, status)
  VALUES (v_line_manual, 'HIPOT-01', v_sttype_hipot, '高压ATE', 'Hi-pot Test', 'Kiem tra ap luc cao', 'idle')
  ON CONFLICT (line_id, code) DO NOTHING;

  INSERT INTO stations (line_id, code, station_type_id, name_zh, name_en, name_vi, status)
  VALUES (v_line_manual, 'PACK-ATE-01', v_sttype_pack_ate, '包装ATE', 'Packaging ATE', 'Dong goi ATE', 'idle')
  ON CONFLICT (line_id, code) DO NOTHING;

  INSERT INTO stations (line_id, code, station_type_id, name_zh, name_en, name_vi, status)
  VALUES (v_line_manual, 'ASM-ATE1-01', v_sttype_asm_ate, '组装ATE', 'Assembly ATE', 'ATE Lap rap', 'idle')
  ON CONFLICT (line_id, code) DO NOTHING;

  INSERT INTO stations (line_id, code, station_type_id, name_zh, name_en, name_vi, status)
  VALUES (v_line_manual, 'SHELL-BIND-01', v_sttype_shell_bind, '外箱绑码', 'Shell Binding', 'Gan ma hop ngoai', 'idle')
  ON CONFLICT (line_id, code) DO NOTHING;

  INSERT INTO stations (line_id, code, station_type_id, name_zh, name_en, name_vi, status)
  VALUES (v_line_manual, 'PALLET-BIND-01', v_sttype_pallet_bind, '栈板绑码', 'Pallet Binding', 'Gan ma khay', 'idle')
  ON CONFLICT (line_id, code) DO NOTHING;

  RAISE NOTICE 'Done: station types and stations added';
end $$;
