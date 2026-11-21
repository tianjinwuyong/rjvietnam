-- rjvn BOM -> canonical boms / bom_lines (2026-11-18)
-- Atomic single transaction, idempotent via rjvn_external_id_map guards.
-- Depends on rjvn-canonical-import.sql (materials + mapping table must exist).
--
-- Facts discovered:
--   * rjvn_bom_item.material_id is NULL for ALL 461 rows -> join by material_code.
--   * 252/461 codes exist in rjvn_material; 209 are missing from master data.
--     -> create those 209 materials so the BOM is complete.
--   * product_code: 1 exact (EPS48R1-36), 1 prefix (EPS18R1G-36 -> EPS18R1G),
--     1 missing (NBC56B120460VU AF39a) -> create that product.

BEGIN;

-- ── 1. product for the unmatched BOM ────────────────────────────────────
INSERT INTO public.products (code, name_zh, name_en, name_vi, revision)
SELECT b.product_code, coalesce(nullif(b.product_name, ''), b.bom_code),
       coalesce(nullif(b.product_name, ''), b.bom_code),
       coalesce(nullif(b.product_name, ''), b.bom_code), 'V1.0'
FROM public.rjvn_bom b
WHERE NOT EXISTS (
  SELECT 1 FROM public.products p
  WHERE b.product_code = p.code OR b.product_code LIKE p.code || '%');

-- ── 2. materials missing from BOM item codes (209) ──────────────────────
INSERT INTO public.materials
  (code, name_zh, name_en, name_vi, uom, material_type, status)
SELECT DISTINCT bi.material_code, bi.material_name, bi.material_name, bi.material_name,
       coalesce(nullif(bi.unit, ''), 'PCS'), 'unknown', 'active'
FROM public.rjvn_bom_item bi
WHERE NOT EXISTS (SELECT 1 FROM public.materials m WHERE m.code = bi.material_code);

-- ── 3. BOM headers (3, as NEW revisions; existing V0.5/V1.5/V1.8 untouched) ──
INSERT INTO public.boms (product_id, revision, status, source_file_name, created_at)
SELECT p.id, b.version, 'draft', 'rjvn:' || b.bom_code, now()
FROM public.rjvn_bom b
JOIN public.products p
  ON b.product_code = p.code OR b.product_code LIKE p.code || '%'
WHERE NOT EXISTS (
  SELECT 1 FROM public.boms bo WHERE bo.product_id = p.id AND bo.revision = b.version);

INSERT INTO public.rjvn_external_id_map (entity, rjvn_id, canonical_id, code)
SELECT 'bom', b.id, bo.id, b.bom_code
FROM public.rjvn_bom b
JOIN public.products p
  ON b.product_code = p.code OR b.product_code LIKE p.code || '%'
JOIN public.boms bo ON bo.product_id = p.id AND bo.revision = b.version
WHERE NOT EXISTS (
  SELECT 1 FROM public.rjvn_external_id_map m
  WHERE m.entity = 'bom' AND m.rjvn_id = b.id);

-- ── 4. BOM lines (461) ──────────────────────────────────────────────────
INSERT INTO public.bom_lines
  (bom_id, material_id, qty_per, material_naming_version, unit,
   material_name_zh, material_name_en, material_name_vi, process_stage, created_at)
SELECT bm.canonical_id, m.id, bi.quantity, 1, bi.unit,
       bi.material_name, bi.material_name, bi.material_name, bi.work_section, now()
FROM public.rjvn_bom_item bi
JOIN public.rjvn_external_id_map bm ON bm.entity = 'bom' AND bm.rjvn_id = bi.bom_id
JOIN public.materials m ON m.code = bi.material_code
WHERE NOT EXISTS (
  SELECT 1 FROM public.rjvn_external_id_map ml
  WHERE ml.entity = 'bom_item' AND ml.rjvn_id = bi.id);

-- DISTINCT ON: one rjvn_bom_item can map to multiple bom_lines when the same
-- (bom_id, material_code) appears twice in the source; keep one mapping row.
INSERT INTO public.rjvn_external_id_map (entity, rjvn_id, canonical_id, code)
SELECT DISTINCT ON (bi.id) 'bom_item', bi.id, bl.id, bi.material_code
FROM public.rjvn_bom_item bi
JOIN public.rjvn_external_id_map bm ON bm.entity = 'bom' AND bm.rjvn_id = bi.bom_id
JOIN public.materials m ON m.code = bi.material_code
JOIN public.bom_lines bl ON bl.bom_id = bm.canonical_id AND bl.material_id = m.id
WHERE NOT EXISTS (
  SELECT 1 FROM public.rjvn_external_id_map ml
  WHERE ml.entity = 'bom_item' AND ml.rjvn_id = bi.id)
ORDER BY bi.id, bl.id;

-- ── verify ──────────────────────────────────────────────────────────────
DO $$
DECLARE mismatch text := '';
BEGIN
  IF (SELECT count(*) FROM public.rjvn_external_id_map WHERE entity='bom') < 3
    THEN mismatch := mismatch || ' bom'; END IF;
  -- 460 mapping rows: one source (bom_id, material_code) pair is duplicated.
  IF (SELECT count(*) FROM public.rjvn_external_id_map WHERE entity='bom_item') < 460
    THEN mismatch := mismatch || ' bom_item'; END IF;
  IF mismatch <> '' THEN
    RAISE EXCEPTION 'BOM IMPORT COUNT MISMATCH:%', mismatch;
  END IF;
END $$;

COMMIT;
