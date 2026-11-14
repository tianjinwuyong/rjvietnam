-- 盘点单允许多次盘点（2026-10-20）
-- 背景：业务上同一仓库同一月份可能需要多次盘点（月度盘点 + 临时抽盘 + 复盘）。
-- 原唯一索引 stock_take_order_period_wh_uniq 会直接挡住第二次建单。
-- 改为普通索引：单号仍由 seq_stock_take_no 保证全局唯一，批次用 take_type / title 区分。

BEGIN;

DROP INDEX IF EXISTS stock_take_order_period_wh_uniq;

CREATE INDEX IF NOT EXISTS idx_sto_period_wh
  ON stock_take_order (period_month, warehouse_code);

COMMIT;
