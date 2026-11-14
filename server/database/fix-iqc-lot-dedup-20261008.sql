-- ============================================================
-- 回归修复（2026-10-08，第三轮）
-- 收料 → 提交 IQC：并发下重复建批的兜底约束
--
-- 背景：
--   submitIqc() 的分组 UPSERT 是「先 SELECT 找进行中批次 → 没有则 INSERT」，
--   但该 SELECT **没有加锁**。10 路并发 submit-iqc 时全部读到「无进行中批次」，
--   于是各自 INSERT，同一批次被建成 2~N 个 IQC 批次（实测同一批次出现 2 条
--   lot，totalQty 各 60，累加虚增到 120）。
--
-- 处理：
--   为「同一收货日期+供应商+物料+生产日期+批次号」建立**部分**唯一索引，
--   仅约束「进行中」状态的批次（终态批次允许与新到货并存，与业务一致）。
--   状态集合与 receipt.service.ts 中 inArray(iqcLot.status, [...]) 保持一致：
--     pending / inspecting / review_pending / rejected
-- 注意：psql 传中文会报 UTF8 错误，本文件只用英文
-- ============================================================

BEGIN;

-- 先清理历史重复的「进行中」批次：保留每组最早的一条，把重复行的收货单改挂到保留行
WITH ranked AS (
  SELECT id, lot_no,
         first_value(id) OVER (
           PARTITION BY receipt_date, supplier_id, material_id, production_date, batch_no
           ORDER BY _created_at ASC, id
         ) AS keep_id,
         row_number() OVER (
           PARTITION BY receipt_date, supplier_id, material_id, production_date, batch_no
           ORDER BY _created_at ASC, id
         ) AS rn
  FROM iqc_lot
  WHERE status IN ('pending', 'inspecting', 'review_pending', 'rejected')
    AND batch_no IS NOT NULL
    AND receipt_date IS NOT NULL
)
UPDATE iqc_lot_receipt lr
SET lot_id = r.keep_id
FROM ranked r
WHERE lr.lot_id = r.id AND r.rn > 1
  AND NOT EXISTS (
    SELECT 1 FROM iqc_lot_receipt x
    WHERE x.lot_id = r.keep_id AND x.receipt_id = lr.receipt_id
  );

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY receipt_date, supplier_id, material_id, production_date, batch_no
           ORDER BY _created_at ASC, id
         ) AS rn
  FROM iqc_lot
  WHERE status IN ('pending', 'inspecting', 'review_pending', 'rejected')
    AND batch_no IS NOT NULL
    AND receipt_date IS NOT NULL
)
DELETE FROM iqc_lot
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- 建部分唯一索引
CREATE UNIQUE INDEX IF NOT EXISTS iqc_lot_active_dedup_uniq
  ON public.iqc_lot USING btree (receipt_date, supplier_id, material_id, production_date, batch_no)
  WHERE status IN ('pending', 'inspecting', 'review_pending', 'rejected')
    AND batch_no IS NOT NULL
    AND receipt_date IS NOT NULL;

COMMIT;

SELECT 'DUP_ACTIVE_LOTS|' || count(*) FROM (
  SELECT receipt_date, supplier_id, material_id, production_date, batch_no
  FROM iqc_lot
  WHERE status IN ('pending','inspecting','review_pending','rejected') AND batch_no IS NOT NULL
  GROUP BY 1,2,3,4,5 HAVING count(*) > 1
) t;

SELECT 'IDX|' || indexdef FROM pg_indexes
WHERE tablename = 'iqc_lot' AND indexname = 'iqc_lot_active_dedup_uniq';
