-- ============================================================
-- MRB v3 联调用最小测试数据（可重复执行，按批次号去重）
-- 用法：psql -d wms -f server/database/_test-mrbv3-data.sql
-- 清理：psql -d wms -f server/database/_test-mrbv3-clean.sql
-- ============================================================
DO $$
DECLARE
  v_supplier uuid;
  v_supplier_code varchar;
  v_supplier_name varchar;
  v_material uuid;
  v_material_code varchar;
  v_material_name varchar;
  v_unit varchar;
  v_loc uuid;
  v_lot uuid;
  v_mrb uuid;
  v_sqe uuid;
  v_receipt1 uuid;
  v_receipt2 uuid;
  v_batch varchar := 'TEST-MRBV3-20261019';
BEGIN
  SELECT id, supplier_code, supplier_name INTO v_supplier, v_supplier_code, v_supplier_name
    FROM supplier ORDER BY supplier_code LIMIT 1;
  SELECT id, material_code, material_name, unit INTO v_material, v_material_code, v_material_name, v_unit
    FROM material ORDER BY material_code LIMIT 1;
  SELECT id INTO v_loc FROM warehouse_location ORDER BY location_code LIMIT 1;
  SELECT id INTO v_sqe FROM sys_account WHERE role_code = 'sqe' LIMIT 1;

  IF v_supplier IS NULL OR v_material IS NULL OR v_loc IS NULL THEN
    RAISE EXCEPTION '缺少基础主数据（supplier/material/location）';
  END IF;

  -- 幂等：已存在则先清掉本轮测试数据
  DELETE FROM mrb_disposition_label WHERE mrb_id IN (SELECT id FROM mrb_review WHERE batch_no = v_batch);
  DELETE FROM mrb_disposition       WHERE mrb_id IN (SELECT id FROM mrb_review WHERE batch_no = v_batch);
  DELETE FROM mrb_reviewer          WHERE mrb_id IN (SELECT id FROM mrb_review WHERE batch_no = v_batch);
  DELETE FROM mrb_review            WHERE batch_no = v_batch;
  DELETE FROM inventory             WHERE batch_no = v_batch;
  DELETE FROM iqc_lot_receipt       WHERE lot_id IN (SELECT id FROM iqc_lot WHERE batch_no = v_batch);
  DELETE FROM receipt_order         WHERE batch_no = v_batch;
  DELETE FROM iqc_lot               WHERE batch_no = v_batch;

  -- 两箱收货
  INSERT INTO receipt_order (receipt_no, receipt_date, supplier_id, material_id, quantity, unit,
                             production_date, batch_no, serial_no, location_id, qr_content, status)
  VALUES ('TEST-RC-001', CURRENT_DATE, v_supplier, v_material, 100, v_unit,
          CURRENT_DATE - 10, v_batch, '001', v_loc,
          v_supplier_code || '*' || v_material_code || '*20261009*100*' || v_batch || '*001', 'pending_iqc')
  RETURNING id INTO v_receipt1;

  INSERT INTO receipt_order (receipt_no, receipt_date, supplier_id, material_id, quantity, unit,
                             production_date, batch_no, serial_no, location_id, qr_content, status)
  VALUES ('TEST-RC-002', CURRENT_DATE, v_supplier, v_material, 100, v_unit,
          CURRENT_DATE - 10, v_batch, '002', v_loc,
          v_supplier_code || '*' || v_material_code || '*20261009*100*' || v_batch || '*002', 'pending_iqc')
  RETURNING id INTO v_receipt2;

  -- IQC 批次（判不合格）
  INSERT INTO iqc_lot (lot_no, inspection_no, receipt_date, supplier_id, material_id,
                       total_qty, unit, production_date, batch_no, box_count,
                       inspection_result, status)
  VALUES ('TEST-LOT-001', 'TEST-IQC-001', CURRENT_DATE, v_supplier, v_material,
          200, v_unit, CURRENT_DATE - 10, v_batch, 2, 'fail', 'review_pending')
  RETURNING id INTO v_lot;

  INSERT INTO iqc_lot_receipt (lot_id, receipt_id) VALUES (v_lot, v_receipt1);
  INSERT INTO iqc_lot_receipt (lot_id, receipt_id) VALUES (v_lot, v_receipt2);

  -- 库存：良品仓锁定（MRB v3 定稿口径）
  INSERT INTO inventory (material_id, location_id, batch_no, supplier_id, quantity, unit,
                         stock_status, production_date, locked, lock_reason, label_no)
  VALUES (v_material, v_loc, v_batch, v_supplier, 200, v_unit,
          'defective', CURRENT_DATE - 10, true, 'IQC不合格待MRB(TEST-LOT-001)', 'TEST-RC-001');

  -- MRB 单：待制定方案
  INSERT INTO mrb_review (mrb_no, lot_id, material_id, supplier_id, batch_no, quantity, unit,
                          fail_reason, status, sqe_id)
  VALUES ('TEST-MRB-001', v_lot, v_material, v_supplier, v_batch, 200, v_unit,
          '测试：外观不良', 'pending_review', ROW(v_sqe)::user_profile)
  RETURNING id INTO v_mrb;

  RAISE NOTICE 'MRB 测试单已生成：% (lot=%)', v_mrb, v_lot;
END $$;

SELECT mrb_no, id, status, quantity, batch_no FROM mrb_review WHERE batch_no = 'TEST-MRBV3-20261019';
