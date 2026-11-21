-- Add the two storage-location columns the WMS location API and UI expect.
--
-- GET /wms/storage-locations (services/api/server.js) selects
-- msd_allowed and max_pallets from storage_locations, and
-- apps/web/src/wms/WmsLocationManagement.tsx reads both off the location
-- record. Neither column existed in any environment, so the endpoint failed
-- with "column sl.msd_allowed does not exist" once the other (zone-level)
-- columns in the same SELECT were corrected.
--
-- The temperature/humidity limits in that same query are NOT location
-- properties -- they belong to the zone (wms_zones) and are read from the
-- zone join there. This migration only adds the two real location columns.

ALTER TABLE public.storage_locations
  ADD COLUMN IF NOT EXISTS msd_allowed boolean;

ALTER TABLE public.storage_locations
  ADD COLUMN IF NOT EXISTS max_pallets integer;

COMMENT ON COLUMN public.storage_locations.msd_allowed IS
  'Whether MSD-controlled materials may be stored at this location';

COMMENT ON COLUMN public.storage_locations.max_pallets IS
  'Maximum number of pallets this location can hold (NULL = unbounded)';
