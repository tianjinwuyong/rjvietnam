-- Compatibility columns for the MySQL-era WMS receiving/IQC routes.
--
-- services/api/src/routes/wms-receiving-iqc.js was written against a MySQL
-- schema and now runs on the SMT PostgreSQL database. Two of its queries are
-- still shaped around columns this schema never had:
--
--   * iqc_inspections.batch_size and the per-class acceptance numbers
--     (ac_critical / re_critical / ac_major / re_major / ac_minor / re_minor)
--     -- written when an inspection is created, and read back when the AQL
--     verdict is computed in the /complete route.
--   * iqc_defect_records.defect_count and .photo_url -- the defect capture
--     route writes both; the canonical table stores the same fact as
--     quantity_defect and has no evidence URL.
--   * wms_incoming_records.iqc_status -- the receiving list filters on it and
--     both the create and complete routes update it. The canonical column is
--     inspection_status, but the filter/patch are issued by name throughout
--     this file.
--
-- These are additive and nullable, so existing rows and the canonical columns
-- keep working untouched. They exist to keep one legacy API contract alive
-- without rewriting its ~100 placeholders and every column reference.

ALTER TABLE public.iqc_inspections
  ADD COLUMN IF NOT EXISTS batch_size    numeric,
  ADD COLUMN IF NOT EXISTS ac_critical   integer,
  ADD COLUMN IF NOT EXISTS re_critical   integer,
  ADD COLUMN IF NOT EXISTS ac_major      integer,
  ADD COLUMN IF NOT EXISTS re_major      integer,
  ADD COLUMN IF NOT EXISTS ac_minor      integer,
  ADD COLUMN IF NOT EXISTS re_minor      integer;

ALTER TABLE public.iqc_defect_records
  ADD COLUMN IF NOT EXISTS defect_count integer,
  ADD COLUMN IF NOT EXISTS photo_url    text;

ALTER TABLE public.wms_incoming_records
  ADD COLUMN IF NOT EXISTS iqc_status character varying;