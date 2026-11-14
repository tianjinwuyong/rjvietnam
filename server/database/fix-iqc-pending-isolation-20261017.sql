-- ============================================================
-- F-11 (2026-10-17): IQC pending isolation + F-10 arbiter fix
--
-- Design (candidate A'): pending-inspection stock uses a dedicated
-- stock_status='pending_qc'. inventory unique index
-- (material_id, location_id, batch_no, stock_status) is NOT changed --
-- isolation comes from the status dimension naturally.
--
-- Idempotent: safe to run on every startup via server/scripts/init-db.ts
-- (single sql.unsafe() with BEGIN/COMMIT, max:1 connection).
-- ASCII identifiers only (psql/UTF8 note from project convention).
-- ============================================================
BEGIN;

-- ---------- 1. drop stale UNCONDITIONAL unique index (F-10 root cause) ----------
-- schema.ts already declares idx_iqc_lot_merge_key as a PLAIN index, but a legacy
-- DB still carries a UNIQUE version; init-db skips drizzle-kit push on non-empty
-- DB so it never self-heals. This causes the active-lot ON CONFLICT to be absorbed
-- by the unconditional unique index (insert 0 rows) -> new lot swallowed -> 409.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND indexname = 'idx_iqc_lot_merge_key'
       AND indexdef LIKE 'CREATE UNIQUE INDEX%'
  ) THEN
    DROP INDEX public.idx_iqc_lot_merge_key;
    RAISE NOTICE 'F-11: dropped stale UNIQUE idx_iqc_lot_merge_key';
  END IF;
END $$;

-- keep it as a plain (non-unique) index, aligned with schema.ts
CREATE INDEX IF NOT EXISTS idx_iqc_lot_merge_key
  ON public.iqc_lot USING btree (receipt_date, supplier_id, material_id, production_date, batch_no);

-- ---------- 2. rebuild active-dedup unique index (4 cols, NULLS NOT DISTINCT) ----------
-- Drop the obsolete 5-col / predicate-narrowed index if present, so we can create
-- the new 4-col NULLS NOT DISTINCT version under the same name.
DO $$
DECLARE def text;
BEGIN
  SELECT indexdef INTO def FROM pg_indexes
   WHERE schemaname = 'public' AND indexname = 'iqc_lot_active_dedup_uniq';
  IF def IS NOT NULL THEN
    -- keep only if already the desired 4-col form; otherwise drop for rebuild
    IF def NOT LIKE '%(supplier_id, material_id, production_date, batch_no)%' THEN
      DROP INDEX public.iqc_lot_active_dedup_uniq;
      RAISE NOTICE 'F-11: dropped obsolete iqc_lot_active_dedup_uniq';
    END IF;
  END IF;
END $$;

-- 2.1 merge historical duplicate ACTIVE lots (4-key). repoint children first.
--     Partition key = supplier_id, material_id, production_date, batch_no.
WITH ranked AS (
  SELECT id,
         first_value(id) OVER w AS keep_id,
         row_number()     OVER w AS rn
    FROM public.iqc_lot
   WHERE status IN ('pending','inspecting','review_pending','rejected')
  WINDOW w AS (PARTITION BY supplier_id, material_id, production_date, batch_no
               ORDER BY _created_at ASC, id)
)
UPDATE public.iqc_lot_receipt lr
   SET lot_id = r.keep_id
  FROM ranked r
 WHERE lr.lot_id = r.id AND r.rn > 1
   AND NOT EXISTS (SELECT 1 FROM public.iqc_lot_receipt x
                    WHERE x.lot_id = r.keep_id AND x.receipt_id = lr.receipt_id);

WITH ranked AS (
  SELECT id, first_value(id) OVER w AS keep_id, row_number() OVER w AS rn
    FROM public.iqc_lot
   WHERE status IN ('pending','inspecting','review_pending','rejected')
  WINDOW w AS (PARTITION BY supplier_id, material_id, production_date, batch_no
               ORDER BY _created_at ASC, id)
)
UPDATE public.iqc_inspection_record rec
   SET lot_id = r.keep_id
  FROM ranked r
 WHERE rec.lot_id = r.id AND r.rn > 1;

-- iqc_report has UNIQUE(lot_id): repoint only when keeper has none
WITH ranked AS (
  SELECT id, first_value(id) OVER w AS keep_id, row_number() OVER w AS rn
    FROM public.iqc_lot
   WHERE status IN ('pending','inspecting','review_pending','rejected')
  WINDOW w AS (PARTITION BY supplier_id, material_id, production_date, batch_no
               ORDER BY _created_at ASC, id)
)
UPDATE public.iqc_report rp
   SET lot_id = r.keep_id
  FROM ranked r
 WHERE rp.lot_id = r.id AND r.rn > 1
   AND NOT EXISTS (SELECT 1 FROM public.iqc_report x WHERE x.lot_id = r.keep_id);

-- delete duplicate ACTIVE lots that no longer have any hard reference
WITH ranked AS (
  SELECT id, row_number() OVER w AS rn
    FROM public.iqc_lot
   WHERE status IN ('pending','inspecting','review_pending','rejected')
  WINDOW w AS (PARTITION BY supplier_id, material_id, production_date, batch_no
               ORDER BY _created_at ASC, id)
)
DELETE FROM public.iqc_lot l
 USING ranked r
 WHERE l.id = r.id AND r.rn > 1
   AND NOT EXISTS (SELECT 1 FROM public.iqc_report            x WHERE x.lot_id = l.id)
   AND NOT EXISTS (SELECT 1 FROM public.iqc_inspection_record  x WHERE x.lot_id = l.id)
   AND NOT EXISTS (SELECT 1 FROM public.mrb_review             x WHERE x.lot_id = l.id);

-- 2.2 create the new active-dedup unique index (version-aware for NULLS NOT DISTINCT)
DO $$
DECLARE ver int := current_setting('server_version_num')::int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname='public' AND indexname='iqc_lot_active_dedup_uniq'
       AND indexdef LIKE '%(supplier_id, material_id, production_date, batch_no)%'
  ) THEN
    IF ver >= 150000 THEN
      EXECUTE 'CREATE UNIQUE INDEX iqc_lot_active_dedup_uniq ON public.iqc_lot USING btree (supplier_id, material_id, production_date, batch_no) NULLS NOT DISTINCT WHERE (status IN (''pending'',''inspecting'',''review_pending'',''rejected''))';
    ELSE
      RAISE WARNING 'F-11: PostgreSQL % < 15 -> creating iqc_lot_active_dedup_uniq WITHOUT NULLS NOT DISTINCT (NULL batch_no may still escape uniqueness)', ver;
      EXECUTE 'CREATE UNIQUE INDEX iqc_lot_active_dedup_uniq ON public.iqc_lot USING btree (supplier_id, material_id, production_date, batch_no) WHERE (status IN (''pending'',''inspecting'',''review_pending'',''rejected''))';
    END IF;
    RAISE NOTICE 'F-11: created iqc_lot_active_dedup_uniq (4 cols)';
  END IF;
END $$;

-- ---------- 3. iqc_lot.last_receipt_date ----------
ALTER TABLE public.iqc_lot ADD COLUMN IF NOT EXISTS last_receipt_date date;
UPDATE public.iqc_lot SET last_receipt_date = receipt_date WHERE last_receipt_date IS NULL;

-- ---------- 4. inventory.batch_no NOT NULL (kill NULL-escape on unique index) ----------
UPDATE public.inventory SET batch_no = '' WHERE batch_no IS NULL;
ALTER TABLE public.inventory ALTER COLUMN batch_no SET DEFAULT '';
ALTER TABLE public.inventory ALTER COLUMN batch_no SET NOT NULL;

-- ---------- 5. backfill: good + locked + lock_reason='IQC待检' -> pending_qc ----------
-- Exact lock_reason match: do NOT touch 超期复检中 / 返工 / 退货 / 手工锁定 / IQC检验不合格.
-- Only rows that belong to an ACTIVE iqc_lot (physical batch, strip -Rxx suffix).
-- Skip if a pending_qc row already exists for the same (material, location, batch)
-- so the UPDATE can never violate the inventory unique index on re-run.
UPDATE public.inventory i
   SET stock_status = 'pending_qc',
       locked       = true,
       lock_reason  = 'IQC待检'
 WHERE i.stock_status = 'good'
   AND i.locked = true
   AND i.lock_reason = 'IQC待检'
   AND EXISTS (
     SELECT 1 FROM public.iqc_lot l
      WHERE l.material_id = i.material_id
        AND COALESCE(regexp_replace(l.batch_no, '-R[0-9]+$', ''), '') = i.batch_no
        AND l.status IN ('pending','inspecting','review_pending','rejected')
   )
   AND NOT EXISTS (
     SELECT 1 FROM public.inventory p
      WHERE p.material_id = i.material_id
        AND p.location_id = i.location_id
        AND p.batch_no = i.batch_no
        AND p.stock_status = 'pending_qc'
   );

-- ---------- 6. helper index for release lookup ----------
CREATE INDEX IF NOT EXISTS idx_inv_pending_qc
  ON public.inventory (material_id, batch_no) WHERE stock_status = 'pending_qc';

COMMIT;

-- ---------- 7. self-check output ----------
SELECT 'F11_MERGE_IDX|' || indexdef FROM pg_indexes
 WHERE schemaname='public' AND indexname='idx_iqc_lot_merge_key';
SELECT 'F11_ACTIVE_IDX|' || indexdef FROM pg_indexes
 WHERE schemaname='public' AND indexname='iqc_lot_active_dedup_uniq';
SELECT 'F11_PENDING_ROWS|' || count(*) FROM public.inventory WHERE stock_status='pending_qc';
