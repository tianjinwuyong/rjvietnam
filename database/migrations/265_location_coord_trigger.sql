-- 265: every new storage location must carry warehouse-map coordinates.
-- Application inserts may omit x/y (QR + code only); the trigger assigns the
-- next grid slot so route planning always has spatial positions:
--   new cell in an EXISTING area -> same band (y), next aisle slot (x+2)
--   new area                   -> fresh band below everything (y = max+10)
-- Explicit x/y on INSERT is always respected.

CREATE OR REPLACE FUNCTION storage_locations_ensure_coords() RETURNS trigger AS $$
DECLARE
  band_y numeric;
  next_x numeric;
BEGIN
  IF NEW.x_coord IS NULL OR NEW.y_coord IS NULL THEN
    SELECT MAX(y_coord) INTO band_y FROM storage_locations WHERE area = NEW.area AND y_coord IS NOT NULL;
    IF band_y IS NULL THEN
      SELECT MAX(y_coord) + 10 INTO band_y FROM storage_locations;
      IF band_y IS NULL THEN band_y := 10; END IF;
    END IF;
    SELECT MAX(x_coord) + 2 INTO next_x FROM storage_locations WHERE area = NEW.area AND x_coord IS NOT NULL;
    IF next_x IS NULL THEN next_x := 0; END IF;
    NEW.y_coord := band_y;
    NEW.x_coord := next_x;
    NEW.coordinate_system := COALESCE(NEW.coordinate_system, 'WAREHOUSE_MAP');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_storage_locations_ensure_coords ON storage_locations;
CREATE TRIGGER trg_storage_locations_ensure_coords
  BEFORE INSERT ON storage_locations
  FOR EACH ROW EXECUTE FUNCTION storage_locations_ensure_coords();
