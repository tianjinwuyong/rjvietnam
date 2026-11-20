-- ============================================================================
-- MRB v2.2（BUG-MRB-001 修复）—— 保留库位的库存口径回正 + lock_reason 索引
--
-- 背景（BUG-MRB-001 P0 数据错账）：
--   同一张 MRB 单内的两条「其他」明细（如 退回客户 50 + 留样 50）在 `inventory`
--   被合并成 1 行 qty=100，且 `lock_reason` 被后写覆盖 → confirm-out 匹配到错的
--   去向、按整行归零核销，出现「正向虚增 50 / 反向吞掉留样 50」。
--
-- 落地方案（设计 v2.1-arch.1 §7-5，**不改 `inventory` 唯一键**）：
--   1. 隔离靠「**一张 MRB 一个专属保留库位**」`<不良品仓编码>-MRB-RSV-<mrbNo>`：
--      4 列唯一键 `(material_id, location_id, batch_no, stock_status)` 里含 location_id，
--      跨 MRB 天然隔离；同 MRB 内多条明细合并成一行（数量累加）是**预期行为**；
--   2. 核销按 `mrb_disposition.quantity` 逐条扣减（见 mrb.service.confirmOut），
--      不再整行归零/删除；
--   3. `lock_reason` 统一为 `MRB-OTHER:<mrbNo>`（不带去向），去向只认 mrb_disposition。
--
-- 为什么**放弃**「把 lock_reason 纳入唯一键」的方案（本文件初版曾这么做，已撤销）：
--   那需要把 4 列唯一索引改成部分索引。全仓 20+ 处 `onConflictDoUpdate` 都依赖这条
--   唯一索引；任何一处调用方忘记同步 `targetWhere` 就会在运行时抛 42P10，直接打断
--   收料 / IQC / 发料 / 调拨 / 退料主链路。风险与收益不成比例。
--
-- 本文件做三件事（全部幂等，可反复执行）：
--   A. 防御性合并历史同键重复行（当前库实测 0 组，作为其它环境的兜底）；
--   B. 把 `inventory` 唯一索引**恢复为普通 4 列唯一索引**（撤销初版的部分索引），
--      并补一条 `lock_reason` 普通索引（confirm-out 按占用标记定位保留行）；
--   C. 把历史遗留的共享保留库位 `<不良品仓编码>-MRB-RSV-01` 停用（有库存则保留 active）：
--      它不再被任何代码写入，但会永远出现在库位下拉里且永远空着。
-- ============================================================================

BEGIN;

-- ---------- A. 前置校验：同键重复行必须人工处理（本迁移**绝不**自动删库存行） ----------
-- 历史「部分索引」窗口期可能写进过 4 列同键的多行，这种行会让下面的
-- `CREATE UNIQUE INDEX` 直接失败。**本迁移不做合并/删除**：
--  - 合并只把数量求和、删掉多余行，却没有 inventory_transaction 记账 → 绕过账本，
--    事后无法审计「哪一批货被并掉了」，比建不起索引更糟；
--  - 库存行是实物账，删行属于业务动作，必须由人确认（谁、为什么、依据哪张单）。
-- 因此这里只做**检测 + 报错 + 给出待处理清单**，由人工按下面的方式收口后再重跑 init-db：
--   ```sql
--   -- 1) 查清单（把 <...> 换成下面 RAISE 输出里的值）
--   SELECT id, quantity, lock_reason, _updated_at FROM inventory
--    WHERE material_id='<mat>' AND location_id='<loc>'
--      AND coalesce(batch_no,'')='<batch>' AND stock_status='<status>'
--    ORDER BY _updated_at DESC;
--   -- 2) 人工决定：把多余行的数量并入保留行，并**手工补一条 inventory_transaction 调账流水**
--   --    （tx_type='manual_merge'，qty=并入量，balance_after=合并后余额，remark 写清依据），
--   --    再删除多余行。
--   ```
DO $$
DECLARE
  v_groups int;
  v_detail text;
BEGIN
  SELECT count(*) INTO v_groups FROM (
    SELECT 1 FROM inventory
    GROUP BY material_id, location_id, batch_no, stock_status
    HAVING count(*) > 1
  ) t;

  IF v_groups > 0 THEN
    SELECT string_agg(
             format('mat=%s loc=%s batch=%s status=%s rows=%s qty_sum=%s',
                    material_id, location_id, coalesce(batch_no, '<null>'),
                    stock_status, cnt, qty_sum),
             ' | ')
      INTO v_detail
    FROM (
      SELECT material_id, location_id, batch_no, stock_status,
             count(*) AS cnt, sum(quantity) AS qty_sum
      FROM inventory
      GROUP BY material_id, location_id, batch_no, stock_status
      HAVING count(*) > 1
    ) d;

    RAISE EXCEPTION
      'MRB v2.2 迁移中止：inventory 存在 % 组 4 列同键重复行，重建唯一索引会失败。'
      '本迁移不会自动删库存行（那会绕过账本），请按文件头 A 段的步骤人工核账合并后重跑。明细：%',
      v_groups, v_detail;
  END IF;
END $$;

-- ---------- B1. 撤销初版「部分索引 / 保留行 5 列索引」 ----------
DROP INDEX IF EXISTS inventory_mrb_other_reserve_key;
DROP INDEX IF EXISTS inventory_material_id_location_id_batch_no_stock_status_key;

-- Drizzle 早期用 ALTER TABLE ADD CONSTRAINT 生成的同名唯一约束也要清掉，
-- 否则同名索引无法以「普通唯一索引」形式重建。
ALTER TABLE inventory
  DROP CONSTRAINT IF EXISTS inventory_material_id_location_id_batch_no_stock_status_key;

-- ---------- B2. 恢复普通 4 列唯一索引（与 schema.ts 完全一致，不带 WHERE 谓词） ----------
CREATE UNIQUE INDEX IF NOT EXISTS inventory_material_id_location_id_batch_no_stock_status_key
  ON inventory (material_id, location_id, batch_no, stock_status);

-- ---------- B3. lock_reason 普通索引（confirm-out 按占用标记定位保留行，避免全表扫） ----------
CREATE INDEX IF NOT EXISTS idx_inv_lock_reason
  ON inventory (lock_reason)
  WHERE lock_reason IS NOT NULL;

-- ---------- C. 停用历史遗留的共享保留库位 ----------
-- 规则：编码形如 `<不良品仓编码>-MRB-RSV-01`（不含具体 MRB 单号）且**没有库存行**。
-- 只在 status='active' 时改，不动用户可能手工改过的状态；**不删除**（避免删到别人的数据）。
UPDATE warehouse_location
   SET status = 'disabled',
       description = COALESCE(description, '') ||
         '｜已停用：MRB 保留位自 v2.1-arch.1 起改为「一张 MRB 一个库位」，本库位不再使用'
 WHERE location_code LIKE '%-MRB-RSV-%'
   AND location_code NOT LIKE '%-MRB-RSV-MRB%'
   AND status = 'active'
   AND NOT EXISTS (SELECT 1 FROM inventory i WHERE i.location_id = warehouse_location.id);

-- ---------- 硬断言：索引必须存在、且**不是**部分索引 ----------
DO $$
DECLARE
  v_def   text;
BEGIN
  SELECT indexdef INTO v_def
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND tablename = 'inventory'
    AND indexname = 'inventory_material_id_location_id_batch_no_stock_status_key';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'MRB v2.2 迁移失败：inventory 唯一索引 inventory_material_id_location_id_batch_no_stock_status_key 不存在';
  END IF;

  IF v_def LIKE '%WHERE%' THEN
    RAISE EXCEPTION 'MRB v2.2 迁移失败：inventory 唯一索引仍是部分索引（带 WHERE 谓词），全仓 ON CONFLICT 会抛 42P10。定义=%', v_def;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'inventory' AND indexname = 'idx_inv_lock_reason'
  ) THEN
    RAISE EXCEPTION 'MRB v2.2 迁移失败：索引 idx_inv_lock_reason 未创建';
  END IF;
END $$;

COMMIT;
