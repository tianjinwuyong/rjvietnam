-- ============================================================================
-- 历史收货数据回填库存流水（幂等，可重复执行）
--
-- 背景：
--   原系统的采购收货、IQC 放行只写 inventory（库存表），不写
--   inventory_transaction（异动流水表），导致「物料追溯管理」查不到收货入库记录。
--   新代码已补齐流水（receipt_in / iqc_release_in），但只对今后新发生的收货生效。
--   本脚本用于把既有历史收货单回填成 receipt_in 流水，让追溯能查到历史入库。
--
-- 幂等规则：
--   以 (tx_type='receipt_in', tx_no=receipt_no) 为键，已存在则跳过。
--
-- 字段映射：
--   receipt_order.status = 'iqc_pass'   → stock_status = 'good'      （已检验放行）
--   receipt_order.status = 'pending_iqc'→ stock_status = 'pending_qc'（待检）
--   balance_after 取该 物料+库位+批次+状态 在 inventory 的当前数量，
--   库存行已不存在（被消耗）时退回本次入库量。
-- ============================================================================

INSERT INTO inventory_transaction (
  id,
  material_id,
  location_id,
  batch_no,
  label_no,
  stock_status,
  tx_type,
  tx_no,
  qty,
  balance_after,
  unit,
  reference_no,
  remark,
  _created_at,
  _updated_at
)
SELECT
  gen_random_uuid(),
  r.material_id,
  r.location_id,
  r.batch_no,
  r.serial_no,
  CASE r.status WHEN 'iqc_pass' THEN 'good' ELSE 'pending_qc' END,
  'receipt_in',
  r.receipt_no,
  r.quantity,
  COALESCE(inv.quantity, r.quantity),
  COALESCE(NULLIF(r.unit, ''), 'PCS'),
  r.receipt_no,
  CASE r.status
    WHEN 'iqc_pass' THEN '采购收货入库（历史数据回填，已检验放行）'
    ELSE '采购收货入库（历史数据回填，待检）'
  END,
  r._created_at,
  r._created_at
FROM receipt_order r
LEFT JOIN LATERAL (
  SELECT i.quantity
  FROM inventory i
  WHERE i.material_id = r.material_id
    AND i.location_id = r.location_id
    AND i.batch_no = COALESCE(r.batch_no, '')
    AND i.stock_status = CASE r.status WHEN 'iqc_pass' THEN 'good' ELSE 'pending_qc' END
  ORDER BY i._created_at DESC
  LIMIT 1
) inv ON true
WHERE NOT EXISTS (
  SELECT 1
  FROM inventory_transaction t
  WHERE t.tx_type = 'receipt_in'
    AND t.tx_no = r.receipt_no
);
