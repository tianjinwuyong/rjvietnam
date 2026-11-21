-- Laser marking was removed from the active application on 2026-07-11.
--
-- Production migrations must not destroy historical manufacturing records.
-- Keep this migration as a compatibility marker; application/API retirement is
-- independent from physical retention and later archival of the table.
DO $$ BEGIN
  RAISE NOTICE '085: laser-marking application retired; historical table retained';
END $$;
