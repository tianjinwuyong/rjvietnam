-- =============================================================================
-- MRB v2.1 增量（2026-10-18）
--   1) 状态机补全：status_since（巡检唯一时钟基准）+ 作废三字段 + 单人审批代审说明
--   2) 「其他」处置收窄为三类：other_type（customer_return / sample / hold）
--   3) mrb-v2-20261018.sql 的列做兜底（该文件此前未注册进 init-db，新环境可能缺列）
--   4) MRB 处置保留库位 <不良品仓编码>-MRB-RSV-01（v1.0 遗留的**共享**保留位；
--      v2.2 起改为「一张 MRB 一个专属库位」，本段仅作老库升级兼容，随后被 v2.2 停用）
--   5) 巡检 / 待发起相关索引
--
-- 全部语句幂等（可重复执行），末尾带硬断言，失败即中止初始化。
-- ⚠️ 本库所有表都挂了 trg_set_updated_at：回填 status_since 时必须临时禁用该触发器，
--    否则会把存量单的 _updated_at 刷成本次执行时间，破坏「已处理视图」的展示口径。
-- =============================================================================
BEGIN;

-- ---------- 1. mrb_review 新增列（状态机 / 作废 / 单人审批） ----------
ALTER TABLE mrb_review
  ADD COLUMN IF NOT EXISTS status_since      timestamptz(3),
  ADD COLUMN IF NOT EXISTS cancel_reason     text,
  ADD COLUMN IF NOT EXISTS cancel_by         user_profile,
  ADD COLUMN IF NOT EXISTS cancel_time       timestamptz(3),
  ADD COLUMN IF NOT EXISTS separation_remark text;

COMMENT ON COLUMN mrb_review.status_since      IS '进入当前状态的时间；巡检 SLA 唯一基准（不要用 _updated_at）';
COMMENT ON COLUMN mrb_review.cancel_reason     IS '作废原因（作废时必填，≥5 字）';
COMMENT ON COLUMN mrb_review.cancel_by         IS '作废人';
COMMENT ON COLUMN mrb_review.cancel_time       IS '作废时间';
COMMENT ON COLUMN mrb_review.separation_remark IS '预审人与终审人为同一人时的代审说明（2~200 字）';

-- ---------- 2. mrb_disposition 新增列（「其他」处置去向） ----------
ALTER TABLE mrb_disposition
  ADD COLUMN IF NOT EXISTS other_type varchar(20);

COMMENT ON COLUMN mrb_disposition.other_type IS '其他处置去向：customer_return=退回客户 / sample=转留样 / hold=待定暂存';

-- ---------- 3. 兜底 mrb-v2 的列（防止新环境未执行过 mrb-v2-20261018.sql） ----------
ALTER TABLE mrb_review
  ADD COLUMN IF NOT EXISTS completeness_result varchar(20),
  ADD COLUMN IF NOT EXISTS completeness_by     user_profile,
  ADD COLUMN IF NOT EXISTS completeness_time   timestamptz(3),
  ADD COLUMN IF NOT EXISTS completeness_remark text,
  ADD COLUMN IF NOT EXISTS is_urgent           boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS urgent_reason       text;

ALTER TABLE mrb_disposition
  ADD COLUMN IF NOT EXISTS ref_no     varchar(50),
  ADD COLUMN IF NOT EXISTS hold_until date;

-- ---------- 4.「其他」三类的库存落点：MRB 处置保留库位（历史共享库位，已废弃） ----------
-- ⚠️ 口径已变更（v2.2 / 设计 arch.6 §7-5）：保留库位改为「**一张 MRB 一个专属库位**」
--    `<不良品仓编码>-MRB-RSV-<mrbNo>`，`lock_reason = 'MRB-OTHER:<mrbNo>'`（**不带去向**）。
--    本段建的 `<whCode>-MRB-RSV-01` 只是 v1.0 遗留，v2.2 会把它在「无库存行」前提下载
--    `status='disabled'`；服务端不再写入它。保留它仅为「老库升级时该编码可能已被占用」的兼容。
--
--    这里之所以仍保留本段 DDL：v2.1 末尾的硬断言要求它存在（老库升级路径的兼容校验），
--    且新环境建库后由 v2.2 立即停用，不影响任何读取（库位选择器只取 status='active'）。
--
-- location_type 保持 'defective'（不新增枚举值，否则仓库/库位页面与调拨选择器
-- 会出现未知类型）。
INSERT INTO warehouse_location
  (location_code, warehouse_id, area_code, shelf_code, layer_code, position_code,
   location_type, status, description)
SELECT w.wh_code || '-MRB-RSV-01', w.id, 'MRB', 'RSV', '01', '0001',
       'defective', 'active', 'MRB 处置保留位（系统自动维护，禁止手工移库）'
FROM warehouse w
WHERE (
        w.wh_code = (SELECT p.param_value FROM sys_param p WHERE p.param_key = 'defective_warehouse_code')
        OR w.wh_type = 'defective'
      )
  AND NOT EXISTS (
        SELECT 1 FROM warehouse_location l WHERE l.location_code = w.wh_code || '-MRB-RSV-01'
      );

-- ---------- 5. status_since 回填 ----------
-- 规则：终态单回填 _updated_at（历史值，SLA 不计算）；进行中单回填 NOW()
--       —— 若把进行中单回填成 _updated_at，上线当天所有存量单会立刻变红，
--          掩盖真实滞留，也会让第一周的巡检数据不可信。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_set_updated_at' AND tgrelid = 'mrb_review'::regclass
  ) THEN
    -- plpgsql 里不能直接写 ALTER TABLE（工具类语句必须走 EXECUTE）
    EXECUTE 'ALTER TABLE mrb_review DISABLE TRIGGER trg_set_updated_at';
  END IF;
END $$;

UPDATE mrb_review
   SET status_since = CASE
         WHEN status IN ('approved', 'closed', 'rejected', 'cancelled')
           THEN COALESCE(_updated_at, _created_at, NOW())
         ELSE NOW()
       END
 WHERE status_since IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_set_updated_at' AND tgrelid = 'mrb_review'::regclass
  ) THEN
    EXECUTE 'ALTER TABLE mrb_review ENABLE TRIGGER trg_set_updated_at';
  END IF;
END $$;

-- 回填完成后收紧为 NOT NULL + DEFAULT now()：
--   DEFAULT 是「忘写 status_since 就自动取当前时刻」的兜底；
--   NOT NULL 让巡检 SQL 不必到处写 COALESCE。
ALTER TABLE mrb_review ALTER COLUMN status_since SET DEFAULT NOW();
ALTER TABLE mrb_review ALTER COLUMN status_since SET NOT NULL;

-- ---------- 6. 索引 ----------
-- 巡检：按 status + status_since 扫描（warn/overdue 计数、仅看超时筛选）
CREATE INDEX IF NOT EXISTS idx_mrb_status_since ON mrb_review (status, status_since);
-- 待发起：activeMrbSql / mrbCountSql 都是 WHERE lot_id=? AND status ...（idx_mrb_lot 只有 lot_id 单列）
CREATE INDEX IF NOT EXISTS idx_mrb_lot_status   ON mrb_review (lot_id, status);
-- 可评审量 / 终审候选池：全部按 (material, supplier, batch) 过滤
CREATE INDEX IF NOT EXISTS idx_inventory_mrb_lookup
  ON inventory (material_id, supplier_id, batch_no)
  WHERE quantity > 0;
-- 其他处置到期巡检（hold_until 已在 mrb-v2 建过 idx_mrb_disp_hold）
CREATE INDEX IF NOT EXISTS idx_mrb_disp_other
  ON mrb_disposition (other_type, hold_until)
  WHERE other_type IS NOT NULL;

-- ---------- 7. 幂等断言 ----------
DO $$
DECLARE
  miss text;
  rsv  text;
BEGIN
  SELECT string_agg(t.f, ',') INTO miss
  FROM (VALUES
    ('mrb_review.status_since'), ('mrb_review.cancel_reason'), ('mrb_review.cancel_by'),
    ('mrb_review.cancel_time'),  ('mrb_review.separation_remark'),
    ('mrb_review.completeness_result'), ('mrb_review.completeness_by'),
    ('mrb_review.completeness_time'), ('mrb_review.completeness_remark'),
    ('mrb_review.is_urgent'), ('mrb_review.urgent_reason'),
    ('mrb_disposition.other_type'), ('mrb_disposition.ref_no'), ('mrb_disposition.hold_until')
  ) AS t(f)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name  = split_part(t.f, '.', 1)
      AND column_name = split_part(t.f, '.', 2)
  );
  IF miss IS NOT NULL THEN
    RAISE EXCEPTION 'MRB v2.1 迁移失败，缺少列：%', miss;
  END IF;

  IF EXISTS (SELECT 1 FROM mrb_review WHERE status_since IS NULL) THEN
    RAISE EXCEPTION 'MRB v2.1 迁移失败：mrb_review.status_since 仍有 NULL 行';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_mrb_status_since'
  ) THEN
    RAISE EXCEPTION 'MRB v2.1 迁移失败：索引 idx_mrb_status_since 未创建';
  END IF;

  -- 保留库位必须存在，否则「其他」处置插入 inventory 会撞 location 外键
  SELECT string_agg(w.wh_code || '-MRB-RSV-01', ',') INTO rsv
  FROM warehouse w
  WHERE (w.wh_code = (SELECT p.param_value FROM sys_param p WHERE p.param_key = 'defective_warehouse_code')
         OR w.wh_type = 'defective')
    AND NOT EXISTS (
      SELECT 1 FROM warehouse_location l WHERE l.location_code = w.wh_code || '-MRB-RSV-01'
    );
  IF rsv IS NOT NULL THEN
    RAISE EXCEPTION 'MRB v2.1 迁移失败：MRB 处置保留库位缺失：%', rsv;
  END IF;
END $$;

COMMIT;
