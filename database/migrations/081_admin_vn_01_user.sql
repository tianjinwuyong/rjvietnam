-- Retired data migration.
-- Demo users belong in database/seeds and must never be created by a
-- production schema upgrade.
DO $$ BEGIN
  RAISE NOTICE '081: demo administrator moved to optional seed 085_admin_vn_01_demo_seed.sql';
END $$;
