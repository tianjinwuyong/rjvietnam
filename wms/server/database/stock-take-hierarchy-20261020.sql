-- 盘点单主子结构 + 库位范围（2026-10-20）
-- 背景：一个仓库物料多，按「主盘点单 + 子盘点单（区域/地址码范围）」拆分盘点，
--       子单各自扫码/录入并提交，主单做汇总对比与盈亏确认。
-- 兼容：历史盘点单 order_type 默认 standalone，行为不变。

BEGIN;

ALTER TABLE stock_take_order
  ADD COLUMN IF NOT EXISTS parent_id       uuid,
  ADD COLUMN IF NOT EXISTS order_type      varchar(12) NOT NULL DEFAULT 'standalone',
  ADD COLUMN IF NOT EXISTS scope_area      varchar(50),
  ADD COLUMN IF NOT EXISTS scope_shelf     varchar(50),
  ADD COLUMN IF NOT EXISTS scope_layer     varchar(50),
  ADD COLUMN IF NOT EXISTS scope_loc_from  varchar(100),
  ADD COLUMN IF NOT EXISTS scope_loc_to    varchar(100),
  ADD COLUMN IF NOT EXISTS child_count     integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_sto_parent ON stock_take_order (parent_id);

-- 原唯一约束「同期间同仓库只能一张盘点单」会让子盘点单无法建单：
-- 主单占用该仓库后，同仓库的子单全部冲突。改为只约束主单/单张盘点单，子单不参与。
DROP INDEX IF EXISTS stock_take_order_period_wh_uniq;
CREATE UNIQUE INDEX IF NOT EXISTS stock_take_order_period_wh_uniq
  ON stock_take_order (period_month, warehouse_code)
  WHERE status <> 'cancelled' AND order_type <> 'sub';

COMMIT;
