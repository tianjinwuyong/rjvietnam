-- Migration: Add nam-fct station for manual line FCT
-- Run: psql -h 127.0.0.1 -U postgres -d smt_factory -f this_file.sql

DO $$
DECLARE
  v_line bigint;
  v_stype bigint;
BEGIN
  -- Get L004 (Manual Line)
  SELECT id INTO v_line FROM production_lines WHERE internal_code = 'L004';

  -- Get or create MAN_FCT station type
  SELECT id INTO v_stype FROM station_types WHERE code = 'MAN_FCT';
  IF v_stype IS NULL THEN
    INSERT INTO station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
    VALUES ('MAN_FCT', '手动FCT', 'Manual FCT', 'FCT thu cong', 'production', true, true)
    ON CONFLICT (code) DO UPDATE SET name_zh = EXCLUDED.name_zh
    RETURNING id INTO v_stype;
  END IF;

  -- Insert nam-fct station
  INSERT INTO stations (line_id, code, station_type_id, name_zh, name_en, name_vi, sequence_order, status)
  VALUES (v_line, 'nam-fct', v_stype, '手动FCT', 'Manual FCT', 'FCT thu cong', 4, 'idle')
  ON CONFLICT (line_id, code) DO UPDATE
    SET station_type_id = EXCLUDED.station_type_id,
        name_zh = EXCLUDED.name_zh,
        name_en = EXCLUDED.name_en,
        name_vi = EXCLUDED.name_vi;

  RAISE NOTICE 'nam-fct station created/updated';
END $$;
