-- ============================================================
-- 回归修复（2026-10-08，第二轮）
-- 补上「收料六段码唯一」的数据库兜底约束。
--
-- 背景：
--   原 BUG-005 修复依赖 `idx_receipt_qr_content_unique` 兜底并发重复插入，
--   但该索引在 DB 中**从未创建**（schema.ts 里 qrContent 也不是 unique）。
--   同时 `SELECT ... FOR UPDATE` 在「0 行结果」时不加任何行锁，
--   导致 10 路并发同码扫码会全部通过校验 → 重复插入（实测落 8 行）。
--   重复行进而让 getReceiptDetail 在同一事务内自锁 → 连接池耗尽 → 服务整体 hang。
--
-- 处理：
--   1) 清理历史重复行（按 _created_at 保留最早一条）
--   2) 建**部分唯一索引**（允许 qr_content 为 NULL 的历史/特殊单据）
-- 注意：psql 传中文会报 UTF8 错误，本文件只用英文
-- ============================================================

BEGIN;

-- 1) 清理重复：每个 qr_content 只保留最早创建的一条
DELETE FROM receipt_order
WHERE qr_content IS NOT NULL
  AND id NOT IN (
    SELECT DISTINCT ON (qr_content) id
    FROM receipt_order
    WHERE qr_content IS NOT NULL
    ORDER BY qr_content, _created_at ASC NULLS FIRST, id
  );

-- 2) 建部分唯一索引（与 receipt.service.ts 的 ON CONFLICT 语义一致）
CREATE UNIQUE INDEX IF NOT EXISTS idx_receipt_qr_content_unique
  ON public.receipt_order USING btree (qr_content)
  WHERE qr_content IS NOT NULL;

COMMIT;

SELECT 'DUP_GROUPS|' || count(*) FROM (
  SELECT qr_content FROM receipt_order
  WHERE qr_content IS NOT NULL
  GROUP BY qr_content HAVING count(*) > 1
) t;

SELECT 'IDX|' || indexdef FROM pg_indexes
WHERE tablename = 'receipt_order' AND indexname = 'idx_receipt_qr_content_unique';
