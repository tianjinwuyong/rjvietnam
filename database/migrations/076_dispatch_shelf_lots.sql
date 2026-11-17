-- Retired migration.
-- The original file inserted demonstration lots and shelf assignments for
-- dispatch sessions 4/5/6. Production WMS migrations must never generate
-- synthetic inventory, so this migration intentionally performs no writes.
DO $$ BEGIN
  RAISE NOTICE '076_dispatch_shelf_lots retired: no demo inventory inserted';
END $$;
