-- Canonical WMS mapping for the raw-material warehouse 3D rack plan.
-- Physical plan: A=14 positions/layer, B=18, C=18, D=16; two levels = 132 cells.

INSERT INTO wms_warehouses (code, name_zh, name_en, name_vi, warehouse_type, site_code, status)
VALUES ('VN-RAW-01', '越南工厂原材料仓库', 'Vietnam Raw Material Warehouse', 'Kho nguyên vật liệu Việt Nam', 'RAW_MATERIAL', 'VN-01', 'ACTIVE')
ON CONFLICT (code) DO UPDATE SET warehouse_type='RAW_MATERIAL', status='ACTIVE', updated_at=now();

DO $$
DECLARE
  warehouse_key bigint;
  zone_key bigint;
  location_key bigint;
  zone_code text;
  position_count integer;
  level_no integer;
  position_no integer;
  rack_code text;
  cell_no text;
  location_code text;
BEGIN
  SELECT id INTO warehouse_key FROM wms_warehouses WHERE code='VN-RAW-01';
  FOREACH zone_code IN ARRAY ARRAY['A','B','C','D'] LOOP
    position_count := CASE zone_code WHEN 'A' THEN 14 WHEN 'B' THEN 18 WHEN 'C' THEN 18 ELSE 16 END;
    INSERT INTO wms_zones (warehouse_id, code, name_zh, name_en, name_vi, zone_type, status)
    VALUES (warehouse_key, 'RAW-' || zone_code, '原材料' || zone_code || '区', 'Raw Material Zone ' || zone_code, 'Khu nguyên liệu ' || zone_code, 'STORAGE', 'ACTIVE')
    ON CONFLICT (warehouse_id, code) DO UPDATE SET status='ACTIVE', updated_at=now()
    RETURNING id INTO zone_key;
    rack_code := 'RAW-' || zone_code;
    FOR level_no IN 1..2 LOOP
      FOR position_no IN 1..position_count LOOP
        cell_no := level_no::text || '-' || position_no::text;
        location_code := rack_code || cell_no;
        INSERT INTO storage_locations (code, area, name_zh, name_en, name_vi, status, location_type, shelf_code, cell_number, warehouse_id, zone_id)
        VALUES (location_code, 'RAW-' || zone_code, '原材料仓位' || zone_code || cell_no, 'Raw material bin ' || zone_code || cell_no, 'Vị trí nguyên liệu ' || zone_code || cell_no, 'active', 'shelf_cell', rack_code, cell_no, warehouse_key, zone_key)
        ON CONFLICT (code) DO UPDATE SET status='active', location_type='shelf_cell', shelf_code=rack_code, cell_number=cell_no, warehouse_id=warehouse_key, zone_id=zone_key
        RETURNING id INTO location_key;
        INSERT INTO shelf_cells (shelf_code, cell_number, storage_location_id, cell_status)
        VALUES (rack_code, cell_no, location_key, 'empty')
        ON CONFLICT (shelf_code, cell_number) DO UPDATE SET storage_location_id=EXCLUDED.storage_location_id;
      END LOOP;
    END LOOP;
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS idx_raw_warehouse_cells_lookup
  ON shelf_cells (shelf_code, cell_number, cell_status)
  WHERE shelf_code IN ('RAW-A','RAW-B','RAW-C','RAW-D');
