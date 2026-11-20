-- Align production `materials.domain_code` with the local/dev schema.
--
-- Both environments declare the column NOT NULL and reference system_domains,
-- but only the dev database carries the 'RAW_MATERIAL' default. Without it,
-- every INSERT that omits domain_code (scripts/etl/rjvn-canonical-import.sql
-- section 2 among them) aborts with a not-null violation, while the same
-- script runs clean locally. Setting the default here removes the drift instead
-- of special-casing the ETL, so the projection behaves identically in both.
--
-- Idempotent: SET DEFAULT simply overwrites the existing default on dev.

ALTER TABLE public.materials
  ALTER COLUMN domain_code SET DEFAULT 'RAW_MATERIAL';
