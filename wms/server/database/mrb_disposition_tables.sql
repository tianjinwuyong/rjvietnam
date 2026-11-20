-- ============================================================
-- MRB 拆分处置改造：新增表结构 + 单据序列 + P0 配置修正
-- 幂等：可重复执行
-- ============================================================

-- ------------------------------------------------------------
-- 1. MRB 处置明细表
--    一次 MRB 终审可填多行处置：特采 / 退货 / 返工 / 报废
--    约束：Σ(quantity) 必须等于 mrb_review.quantity（服务层校验）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mrb_disposition (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mrb_id uuid NOT NULL,
  disposition_type varchar(20) NOT NULL,
  quantity numeric NOT NULL DEFAULT '0',
  unit varchar(20) NOT NULL DEFAULT 'PCS',
  from_location_id uuid,
  to_location_id uuid,
  exec_status varchar(20) NOT NULL DEFAULT 'pending',
  exec_time timestamptz(3),
  remark text,
  sort_order integer NOT NULL DEFAULT 0,
  _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile,
  _updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile
);
CREATE INDEX IF NOT EXISTS idx_mrb_disp_mrb ON mrb_disposition (mrb_id);
CREATE INDEX IF NOT EXISTS idx_mrb_disp_status ON mrb_disposition (exec_status);

-- ------------------------------------------------------------
-- 2. 供应商退货单（头）
--    终审判退货时生成，状态 pending_out；仓库实际出库才扣库存
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS supplier_return_order (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_no varchar(50) NOT NULL UNIQUE,
  mrb_id uuid,
  disposition_id uuid,
  supplier_id uuid,
  supplier_code varchar(50),
  supplier_name varchar(200),
  batch_no varchar(100),
  status varchar(20) NOT NULL DEFAULT 'pending_out',
  total_qty numeric NOT NULL DEFAULT '0',
  out_qty numeric NOT NULL DEFAULT '0',
  unit varchar(20) NOT NULL DEFAULT 'PCS',
  out_time timestamptz(3),
  out_by user_profile,
  remark text,
  _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile,
  _updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile
);
CREATE INDEX IF NOT EXISTS idx_supplier_return_status ON supplier_return_order (status);
CREATE INDEX IF NOT EXISTS idx_supplier_return_mrb ON supplier_return_order (mrb_id);

-- ------------------------------------------------------------
-- 3. 供应商退货单（明细）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS supplier_return_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  material_id uuid NOT NULL,
  material_code varchar(100),
  material_name varchar(200),
  batch_no varchar(100),
  location_id uuid,
  quantity numeric NOT NULL DEFAULT '0',
  out_qty numeric NOT NULL DEFAULT '0',
  unit varchar(20) NOT NULL DEFAULT 'PCS',
  disposition_id uuid,
  sort_order integer NOT NULL DEFAULT 0,
  _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile,
  _updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile,
  CONSTRAINT supplier_return_item_order_id_fkey
    FOREIGN KEY (order_id) REFERENCES supplier_return_order (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_supplier_return_item_order ON supplier_return_item (order_id);

-- ------------------------------------------------------------
-- 4. 返工单
--    终审判返工生成；返工完成 -> 待重检 -> 重检合格才回良品仓
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rework_order (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rework_no varchar(50) NOT NULL UNIQUE,
  mrb_id uuid,
  disposition_id uuid,
  material_id uuid NOT NULL,
  material_code varchar(100),
  material_name varchar(200),
  supplier_id uuid,
  supplier_code varchar(50),
  supplier_name varchar(200),
  batch_no varchar(100),
  quantity numeric NOT NULL DEFAULT '0',
  unit varchar(20) NOT NULL DEFAULT 'PCS',
  status varchar(20) NOT NULL DEFAULT 'pending',
  source_location_id uuid,
  target_location_id uuid,
  finish_time timestamptz(3),
  finish_by user_profile,
  finish_remark text,
  reinspect_time timestamptz(3),
  reinspect_by user_profile,
  reinspect_result varchar(20),
  reinspect_remark text,
  remark text,
  _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile,
  _updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile
);
CREATE INDEX IF NOT EXISTS idx_rework_status ON rework_order (status);
CREATE INDEX IF NOT EXISTS idx_rework_mrb ON rework_order (mrb_id);

-- ------------------------------------------------------------
-- 5. 特采批次标记（库存表加列）
-- ------------------------------------------------------------
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS is_special_admit boolean NOT NULL DEFAULT false;
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS special_admit_ref varchar(100);
CREATE INDEX IF NOT EXISTS idx_inventory_special_admit ON inventory (is_special_admit);

-- ------------------------------------------------------------
-- 6. 单据序列
-- ------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS seq_supplier_return_no START 1;
CREATE SEQUENCE IF NOT EXISTS seq_rework_no START 1;

-- ------------------------------------------------------------
-- 7. P0 配置修正
--    系统参数指向了不存在的仓库编码（001 / NG001），
--    而 warehouse 表实际为 WL001 / NG01，
--    导致「特采终审」「IQC 不合格流转」直接抛异常。
-- ------------------------------------------------------------
UPDATE sys_param SET param_value = 'WL001' WHERE param_key = 'good_warehouse_code' AND param_value <> 'WL001';
UPDATE sys_param SET param_value = 'NG01' WHERE param_key = 'defective_warehouse_code' AND param_value <> 'NG01';

INSERT INTO sys_param (param_key, param_value, description)
SELECT 'good_warehouse_code', 'WL001', '良品仓库编码'
WHERE NOT EXISTS (SELECT 1 FROM sys_param WHERE param_key = 'good_warehouse_code');

INSERT INTO sys_param (param_key, param_value, description)
SELECT 'defective_warehouse_code', 'NG01', '不良品仓库编码'
WHERE NOT EXISTS (SELECT 1 FROM sys_param WHERE param_key = 'defective_warehouse_code');

-- ------------------------------------------------------------
-- 8. 给不良品仓 NG01 补建库位（原先一个库位都没有）
-- ------------------------------------------------------------
INSERT INTO warehouse_location
  (location_code, warehouse_id, area_code, shelf_code, layer_code, position_code, location_type, status, description)
SELECT v.location_code, w.id, v.area_code, v.shelf_code, v.layer_code, v.position_code, 'defective', 'active', 'MRB 处置自动补建'
FROM warehouse w
CROSS JOIN (VALUES
  ('NG01-A-01-00-0001', 'A', '01', '00', '0001'),
  ('NG01-A-01-00-0002', 'A', '01', '00', '0002')
) AS v(location_code, area_code, shelf_code, layer_code, position_code)
WHERE w.wh_code = 'NG01'
  AND NOT EXISTS (
    SELECT 1 FROM warehouse_location l WHERE l.location_code = v.location_code
  );
ALTER TABLE supplier_return_item ADD COLUMN IF NOT EXISTS inventory_id uuid;
