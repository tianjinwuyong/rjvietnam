-- 262: test-mark flag on storage_locations (TEST areas must be flaggable too).

ALTER TABLE storage_locations
  ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT false;
