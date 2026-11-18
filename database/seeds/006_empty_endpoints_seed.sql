-- ============================================================
-- Seed Data for Empty Endpoints
-- ============================================================

-- 1. 库存调拨 (Inventory Transfers) - rjvn_stock_transfer
-- Columns: transfer_no, transfer_date, from_location_id, to_location_id,
--          material_id, batch_no, quantity, unit, operator_id, status, remark
-- Note: operator_id is rjvn_user_profile composite type; no FK constraint,
--       so any UUID works. material lookup by material_code (not 'code').
insert into public.rjvn_stock_transfer (
  id, transfer_no, transfer_date, from_location_id, to_location_id,
  material_id, batch_no, quantity, unit, operator_id, status, remark,
  _created_by, _created_at, _updated_by, _updated_at
)
values
  (
    gen_random_uuid(),
    'ST-20261118-001',
    '2026-11-18',
    (select id from public.rjvn_warehouse_location where location_code = '001-A-0-1' limit 1),
    (select id from public.rjvn_warehouse_location where location_code = 'NG01-A-01-00-0001' limit 1),
    (select id from public.rjvn_material where material_code = '0.01.00.01.0037S-HF' limit 1),
    'BATCH-20261118-001',
    100,
    'PCS',
    null,
    'completed',
    'Sample transfer from 001-A-0-1 to NG01-A-01-00-0001',
    null,
    now(),
    null,
    now()
  ),
  (
    gen_random_uuid(),
    'ST-20261118-002',
    '2026-11-18',
    (select id from public.rjvn_warehouse_location where location_code = 'NG01-A-01-00-0001' limit 1),
    (select id from public.rjvn_warehouse_location where location_code = 'NG01-A-01-00-0002' limit 1),
    (select id from public.rjvn_material where material_code = '0.01.05.00.0234R' limit 1),
    'BATCH-20261118-002',
    50,
    'PCS',
    null,
    'pending',
    'Sample transfer from NG01-A-01-00-0001 to NG01-A-01-00-0002',
    null,
    now(),
    null,
    now()
  )
on conflict (transfer_no) do nothing;

-- 2. 盘点单 (Stock Take Orders) - rjvn_stock_take_order
-- Columns: take_no, period_month, take_type, scope, warehouse_id,
--          warehouse_code, warehouse_name, status, title, operator_name, remark
insert into public.rjvn_stock_take_order (
  id, take_no, period_month, take_type, scope, warehouse_id,
  warehouse_code, warehouse_name, status, title, operator_name, remark,
  _created_by, _created_at, _updated_by, _updated_at
)
values
  (
    gen_random_uuid(),
    'STO-20261118-001',
    '2026-11',
    'monthly',
    'all',
    (select id from public.rjvn_warehouse where wh_code = '001' limit 1),
    '001',
    'WH-01',
    'submitted',
    '月度盘点 - WH-01',
    'Nguyễn Thị Hương',
    '全库房月度盘点',
    null,
    now(),
    null,
    now()
  ),
  (
    gen_random_uuid(),
    'STO-20261118-002',
    '2026-11',
    'quarterly',
    'all',
    (select id from public.rjvn_warehouse where wh_code = 'NG01' limit 1),
    'NG01',
    'WH-02',
    'draft',
    '季度盘点 - WH-02',
    'TRIỆU THỊ NĂM',
    '季度全库房盘点',
    null,
    now(),
    null,
    now()
  )
on conflict (take_no) do nothing;

-- 3. MRB (Material Review Board) - rjvn_mrb_review
-- Columns: mrb_no, lot_id, material_id, supplier_id, batch_no, quantity,
--          unit, fail_reason, status, final_decision, remark
-- Required FKs: lot_id -> rjvn_iqc_lot, material_id -> rjvn_material,
--               supplier_id -> rjvn_supplier
insert into public.rjvn_mrb_review (
  id, mrb_no, lot_id, material_id, supplier_id, batch_no, quantity, unit,
  fail_reason, status, final_decision, remark,
  _created_by, _created_at, _updated_by, _updated_at
)
values
  (
    gen_random_uuid(),
    'MRB-20261118-001',
    (select id from public.rjvn_iqc_lot limit 1),
    (select id from public.rjvn_material where material_code = '0.01.00.01.0037S-HF' limit 1),
    (select id from public.rjvn_supplier limit 1),
    'BATCH-20261118-001',
    15,
    'PCS',
    '偏差超出规格',
    'pending_review',
    null,
    '产品尺寸超出公差',
    null,
    now(),
    null,
    now()
  ),
  (
    gen_random_uuid(),
    'MRB-20261118-002',
    (select id from public.rjvn_iqc_lot limit 1 offset 1),
    (select id from public.rjvn_material where material_code = '0.01.05.00.0234R' limit 1),
    (select id from public.rjvn_supplier limit 1 offset 1),
    'BATCH-20261118-002',
    8,
    'PCS',
    '外观缺陷',
    'reviewing',
    'scrap',
    '表面划痕',
    null,
    now(),
    null,
    now()
  )
on conflict (mrb_no) do nothing;

-- 4. 供应商退货 (Supplier Return) - rjvn_supplier_return_order
-- Columns: return_no, supplier_id, supplier_code, supplier_name, batch_no,
--          status, total_qty, unit, remark
insert into public.rjvn_supplier_return_order (
  id, return_no, supplier_id, supplier_code, supplier_name, batch_no, status,
  total_qty, unit, remark,
  _created_by, _created_at, _updated_by, _updated_at
)
values
  (
    gen_random_uuid(),
    'SR-20261118-001',
    (select id from public.rjvn_supplier limit 1),
    'SUP-001',
    '测试供应商',
    'BATCH-20261118-001',
    'pending_out',
    20,
    'PCS',
    '质量问题',
    null,
    now(),
    null,
    now()
  ),
  (
    gen_random_uuid(),
    'SR-20261118-002',
    (select id from public.rjvn_supplier limit 1 offset 1),
    'SUP-002',
    '供应商B',
    'BATCH-20261118-002',
    'pending_out',
    10,
    'PCS',
    '规格不符',
    null,
    now(),
    null,
    now()
  )
on conflict (return_no) do nothing;

-- 5. 超领 (Over-picking) - rjvn_over_picking_order
-- Columns: order_no, work_order_id, work_order_no, status, total_qty,
--          applicant_name, remark
-- Required FK: work_order_id -> rjvn_work_order
insert into public.rjvn_over_picking_order (
  id, order_no, work_order_id, work_order_no, status, total_qty,
  applicant_name, remark,
  _created_by, _created_at, _updated_by, _updated_at
)
values
  (
    gen_random_uuid(),
    'OP-20261118-001',
    (select id from public.rjvn_work_order limit 1),
    '261110005',
    'pending_approval',
    30,
    '张三',
    '产线急需',
    null,
    now(),
    null,
    now()
  ),
  (
    gen_random_uuid(),
    'OP-20261118-002',
    (select id from public.rjvn_work_order limit 1 offset 1),
    '261110004',
    'pending_approval',
    15,
    '李四',
    '物料短缺',
    null,
    now(),
    null,
    now()
  )
on conflict (order_no) do nothing;
