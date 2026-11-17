-- 264: warehouse-map coordinates for every storage location.
-- Route planning (auto line distribution across collectors) needs spatial
-- positions, not just location codes. All 210 locations carry a QR but zero
-- coordinates today; assign a deterministic WAREHOUSE_MAP grid:
--   y = area band  (areas ordered by their first appearance -> one band each)
--   x = cell aisle position inside the area (every ~2 map units)
-- Same-area cells stay contiguous; different areas are far apart. Later a
-- survey can overwrite x/y with measured values without changing the schema.

ALTER TABLE storage_locations ADD COLUMN IF NOT EXISTS x_coord numeric(12,3);
ALTER TABLE storage_locations ADD COLUMN IF NOT EXISTS y_coord numeric(12,3);
ALTER TABLE storage_locations ADD COLUMN IF NOT EXISTS coordinate_system varchar(40) DEFAULT 'WAREHOUSE_MAP';

WITH ranked AS (
  SELECT code,
         dense_rank() OVER (ORDER BY area)      AS area_rank,
         row_number() OVER (PARTITION BY area ORDER BY code) AS cell_seq
    FROM storage_locations
)
UPDATE storage_locations sl
   SET x_coord = (r.area_rank - 1) * 200 + (r.cell_seq - 1) * 2,
       y_coord = r.area_rank * 10,
       coordinate_system = COALESCE(coordinate_system, 'WAREHOUSE_MAP')
  FROM ranked r
 WHERE r.code = sl.code;

-- New shelf cells created later default onto the same grid via trigger-less
-- convention in application inserts; existing rows are now fully positioned.
