-- ============================================================================
-- 不良品调拨单 v2（2026-10-19）
--
-- 背景：
--   1. MRB 判退货 / 报废 / 否决后生成的调拨任务，原来可以在 PC 端「选一个
--      不良品仓库位」直接点完成 —— 没有任何实物校验，仓管员搬错货也能点完成。
--      现在统一改为「扫码作业」：必须扫货物标签 + 扫目标库位码，服务端复核。
--   2. 良品仓库存也可能在生产过程中发现不良，需要仓管员手工制单：
--      制单 → 仓库主管确认生效 → 仓管员扫码执行。
--      因此本表从「MRB 派生任务」升级为「统一的不良品调拨单」。
--
-- 变更：
--   - lot_id / supplier_id 放开非空（手工单没有来料批次，生产退料可能没有供应商）
--   - 新增单号、制单人、确认人、来源库存行、扫码凭据等字段
--   - status 取值扩展：pending_confirm(待确认) / pending(已生效待执行)
--                       / completed(已完成) / cancelled(已取消)
-- ============================================================================

BEGIN;

ALTER TABLE defective_move_task ALTER COLUMN lot_id DROP NOT NULL;
ALTER TABLE defective_move_task ALTER COLUMN supplier_id DROP NOT NULL;

ALTER TABLE defective_move_task ADD COLUMN IF NOT EXISTS move_no varchar(50);
ALTER TABLE defective_move_task ADD COLUMN IF NOT EXISTS inventory_id uuid;
ALTER TABLE defective_move_task ADD COLUMN IF NOT EXISTS from_stock_status varchar(20);

ALTER TABLE defective_move_task ADD COLUMN IF NOT EXISTS created_by user_profile;
ALTER TABLE defective_move_task ADD COLUMN IF NOT EXISTS confirmed_by user_profile;
ALTER TABLE defective_move_task ADD COLUMN IF NOT EXISTS confirmed_at timestamptz(3);
ALTER TABLE defective_move_task ADD COLUMN IF NOT EXISTS confirm_remark text;

-- 扫码凭据：扫到的货物标签原文（JSON 数组）与目标库位码，用于事后追溯搬的是哪几箱
ALTER TABLE defective_move_task ADD COLUMN IF NOT EXISTS scan_codes text;
ALTER TABLE defective_move_task ADD COLUMN IF NOT EXISTS scan_to_code varchar(100);
ALTER TABLE defective_move_task ADD COLUMN IF NOT EXISTS scan_at timestamptz(3);

COMMENT ON COLUMN defective_move_task.move_no IS '调拨单号（DMT+日期-流水）';
COMMENT ON COLUMN defective_move_task.inventory_id IS '制单时锁定的来源库存行（手工单执行时按此精确扣减）';
COMMENT ON COLUMN defective_move_task.from_stock_status IS '来源库存状态：good=良品手工调拨，defective/scrapped=MRB 冻结行';
COMMENT ON COLUMN defective_move_task.status IS 'pending_confirm=待主管确认 / pending=待执行 / completed / cancelled';

-- 历史行补单号：日期 + 行号，保证唯一
WITH t AS (
  SELECT id, row_number() OVER (ORDER BY _created_at, id) AS rn
  FROM defective_move_task
  WHERE move_no IS NULL
)
UPDATE defective_move_task d
SET move_no = 'DMT' || to_char(d._created_at, 'YYYYMMDD') || lpad(t.rn::text, 4, '0')
FROM t
WHERE d.id = t.id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_dmt_move_no ON defective_move_task (move_no);
CREATE INDEX IF NOT EXISTS idx_dmt_inventory ON defective_move_task (inventory_id);
CREATE INDEX IF NOT EXISTS idx_dmt_source_status ON defective_move_task (source, status);

-- 调拨单号流水（`nextDefectiveMoveNo` 依赖）。该序列原本由 sync-schema-20261016.sql 创建，
-- 但生产库若没执行过那份脚本，终审生成调拨任务会在这里 42P01 直接回滚掉整笔 MRB 终审，
-- 因此本迁移自行兜底建一次。
CREATE SEQUENCE IF NOT EXISTS seq_adjust_tx_no START 1;

COMMIT;
