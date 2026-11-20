-- 领料签收（2026-10-20）
-- 发料完成后由领料方（生产线物料员）确认实收数量；差异记录在明细上。
-- 状态：pending_approval → approved → issued（待签收）→ received（已签收）

BEGIN;

ALTER TABLE picking_order
  ADD COLUMN IF NOT EXISTS received_by   user_profile,
  ADD COLUMN IF NOT EXISTS received_time timestamptz(3),
  ADD COLUMN IF NOT EXISTS receive_remark text;

ALTER TABLE picking_order_item
  ADD COLUMN IF NOT EXISTS received_qty   numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS receive_remark text;

-- 历史「completed」单据视为已签收，避免列表出现既非 issued 又非 received 的状态
UPDATE picking_order
   SET received_time = COALESCE(received_time, pick_time)
 WHERE status = 'completed' AND received_time IS NULL;

COMMIT;
