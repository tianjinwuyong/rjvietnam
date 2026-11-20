-- ============================================================
-- MRB v3「报废：先调拨不良品仓、再销毁」联调用测试数据
-- 用途：造一张已提交方案、处于 pending_final 的 MRB（报废 120 + 退货 80，合计 200），
--       调 /api/mrb/final-approve 后可验证：
--         1) 报废不再当场核销，库存原地 defective + lock_reason = 'MRB-SCRAP:<mrbNo>'
--         2) 同时生成两条不良品调拨任务（mrb_scrap / mrb_return）
--         3) 调拨未完成前 /api/mrb/disposition/:id/destroy 返回 409
-- 用法：psql -d wms -v ON_ERROR_STOP=1 -f server/database/_test-mrbv3-scrap.sql
-- ============================================================
DO $$
DECLARE
  v_supplier uuid;
  v_supplier_code varchar;
  v_material uuid;
  v_material_code varchar;
  v_unit varchar;
  v_loc uuid;
  v_lot uuid;
  v_mrb uuid;
  v_sqe uuid;
  v_reviewer uuid;
  v_receipt1 uuid;
  v_receipt2 uuid;
  v_d1 uuid;
  v_d2 uuid;
  v_batch varchar := 'TEST-MRBV3-SCRAP';
BEGIN
  SELECT id, supplier_code INTO v_supplier, v_supplier_code
    FROM supplier ORDER BY supplier_code LIMIT 1;
  SELECT id, material_code, unit INTO v_material, v_material_code, v_unit
    FROM material ORDER BY material_code LIMIT 1;
  -- 故意挑一个**非不良品仓**的库位，才能验证「先调拨」
  IF v_supplier IS NULL OR v_material IS NULL THEN
    RAISE EXCEPTION '缺少基础主数据（supplier/material）';
  END IF;

  -- 测试环境只有 NG01（不良品仓）。要验证「先调拨再销毁」必须有非不良品库位，
  -- 这里补一个测试良品仓 + 库位（幂等，名字带 TEST- 前缀便于清理）。
  INSERT INTO warehouse (wh_code, wh_name_zh, wh_name_vi, wh_name_en, wh_type, status)
  VALUES ('TEST-WH-GOOD', '测试良品仓', 'Kho tot test', 'Test Good WH', 'normal', 'active')
  ON CONFLICT (wh_code) DO NOTHING;

  INSERT INTO warehouse_location (warehouse_id, location_code, location_type, status)
  SELECT w.id, 'TEST-GOOD-LOC', 'storage', 'active'
    FROM warehouse w WHERE w.wh_code = 'TEST-WH-GOOD'
  ON CONFLICT DO NOTHING;

  SELECT l.id INTO v_loc
    FROM warehouse_location l JOIN warehouse w ON w.id = l.warehouse_id
   WHERE w.wh_code = 'TEST-WH-GOOD'
   ORDER BY l.location_code LIMIT 1;
  SELECT id INTO v_sqe FROM sys_account WHERE role_code = 'sqe' LIMIT 1;
  SELECT id INTO v_reviewer FROM sys_account WHERE role_code = 'iqc_manager' LIMIT 1;

  IF v_loc IS NULL OR v_sqe IS NULL THEN
    RAISE EXCEPTION '缺少测试仓 / SQE 账号，无法继续';
  END IF;

  -- 幂等清理（先清子表再清主表）
  DELETE FROM sys_notice WHERE biz_no = 'TEST-MRB-SCRAP';
  DELETE FROM inventory_transaction WHERE tx_no = 'TEST-MRB-SCRAP';
  DELETE FROM defective_move_task WHERE mrb_id IN (SELECT id FROM mrb_review WHERE batch_no = v_batch);
  DELETE FROM supplier_return_item WHERE order_id IN (
    SELECT id FROM supplier_return_order WHERE mrb_id IN (SELECT id FROM mrb_review WHERE batch_no = v_batch));
  DELETE FROM supplier_return_order WHERE mrb_id IN (SELECT id FROM mrb_review WHERE batch_no = v_batch);
  DELETE FROM supplier_debt_settlement WHERE debt_id IN (
    SELECT id FROM supplier_debt WHERE source_no = 'TEST-MRB-SCRAP');
  DELETE FROM supplier_debt WHERE source_no = 'TEST-MRB-SCRAP';
  DELETE FROM mrb_cc        WHERE mrb_id IN (SELECT id FROM mrb_review WHERE batch_no = v_batch);
  DELETE FROM mrb_disposition_label WHERE mrb_id IN (SELECT id FROM mrb_review WHERE batch_no = v_batch);
  DELETE FROM mrb_disposition       WHERE mrb_id IN (SELECT id FROM mrb_review WHERE batch_no = v_batch);
  DELETE FROM mrb_reviewer          WHERE mrb_id IN (SELECT id FROM mrb_review WHERE batch_no = v_batch);
  DELETE FROM mrb_review            WHERE batch_no = v_batch;
  DELETE FROM inventory             WHERE batch_no = v_batch;
  DELETE FROM iqc_lot_receipt       WHERE lot_id IN (SELECT id FROM iqc_lot WHERE batch_no = v_batch);
  DELETE FROM receipt_order         WHERE batch_no = v_batch;
  DELETE FROM iqc_lot               WHERE batch_no = v_batch;

  INSERT INTO receipt_order (receipt_no, receipt_date, supplier_id, material_id, quantity, unit,
                             production_date, batch_no, serial_no, location_id, qr_content, status)
  VALUES ('TEST-SC-RC-001', CURRENT_DATE, v_supplier, v_material, 100, v_unit,
          CURRENT_DATE - 10, v_batch, '001', v_loc,
          v_supplier_code || '*' || v_material_code || '*20261009*100*' || v_batch || '*001', 'iqc_fail')
  RETURNING id INTO v_receipt1;

  INSERT INTO receipt_order (receipt_no, receipt_date, supplier_id, material_id, quantity, unit,
                             production_date, batch_no, serial_no, location_id, qr_content, status)
  VALUES ('TEST-SC-RC-002', CURRENT_DATE, v_supplier, v_material, 100, v_unit,
          CURRENT_DATE - 10, v_batch, '002', v_loc,
          v_supplier_code || '*' || v_material_code || '*20261009*100*' || v_batch || '*002', 'iqc_fail')
  RETURNING id INTO v_receipt2;

  INSERT INTO iqc_lot (lot_no, inspection_no, receipt_date, supplier_id, material_id,
                       total_qty, unit, production_date, batch_no, box_count,
                       inspection_result, status, inspector_id)
  VALUES ('TEST-SC-LOT', 'TEST-SC-IQC', CURRENT_DATE, v_supplier, v_material,
          200, v_unit, CURRENT_DATE - 10, v_batch, 2, 'fail', 'review_pending',
          ROW(v_reviewer)::user_profile)
  RETURNING id INTO v_lot;

  INSERT INTO iqc_lot_receipt (lot_id, receipt_id) VALUES (v_lot, v_receipt1);
  INSERT INTO iqc_lot_receipt (lot_id, receipt_id) VALUES (v_lot, v_receipt2);

  -- IQC fail 原地锁定（v3 口径：不搬库、label_no 保留）
  INSERT INTO inventory (material_id, location_id, batch_no, supplier_id, quantity, unit,
                         stock_status, production_date, locked, lock_reason, label_no)
  VALUES (v_material, v_loc, v_batch, v_supplier, 200, v_unit,
          'defective', CURRENT_DATE - 10, true, 'IQC不合格待MRB(TEST-SC-LOT)', 'TEST-SC-RC-001');

  INSERT INTO mrb_review (mrb_no, lot_id, material_id, supplier_id, batch_no, quantity, unit,
                          fail_reason, status, sqe_id, plan_by, plan_time)
  VALUES ('TEST-MRB-SCRAP', v_lot, v_material, v_supplier, v_batch, 200, v_unit,
          '测试：功能性失效无法返修', 'pending_final', ROW(v_sqe)::user_profile,
          ROW(v_sqe)::user_profile, CURRENT_TIMESTAMP)
  RETURNING id INTO v_mrb;

  -- 方案：报废 120 + 退货 80
  INSERT INTO mrb_disposition (mrb_id, disposition_type, quantity, unit, exec_status, sort_order, remark)
  VALUES (v_mrb, 'scrap', 120, v_unit, 'planned', 0, '功能失效，整箱报废')
  RETURNING id INTO v_d1;

  INSERT INTO mrb_disposition (mrb_id, disposition_type, quantity, unit, exec_status, sort_order, remark)
  VALUES (v_mrb, 'return', 80, v_unit, 'planned', 1, '余量退回供应商')
  RETURNING id INTO v_d2;

  INSERT INTO mrb_disposition_label (mrb_id, disposition_id, receipt_id, receipt_no, qr_content, label_no, quantity)
  VALUES (v_mrb, v_d1, v_receipt1, 'TEST-SC-RC-001',
          v_supplier_code || '*' || v_material_code || '*20261009*70*' || v_batch || '*001', 'TEST-SC-RC-001', 70),
         (v_mrb, v_d1, v_receipt2, 'TEST-SC-RC-002',
          v_supplier_code || '*' || v_material_code || '*20261009*50*' || v_batch || '*002', 'TEST-SC-RC-002', 50),
         (v_mrb, v_d2, v_receipt1, 'TEST-SC-RC-001',
          v_supplier_code || '*' || v_material_code || '*20261009*30*' || v_batch || '*001', 'TEST-SC-RC-001', 30),
         (v_mrb, v_d2, v_receipt2, 'TEST-SC-RC-002',
          v_supplier_code || '*' || v_material_code || '*20261009*50*' || v_batch || '*002', 'TEST-SC-RC-002', 50);

  INSERT INTO mrb_reviewer (mrb_id, reviewer_id, reviewer_role, review_result, review_opinion, review_time, sort_order)
  VALUES (v_mrb, ROW(v_reviewer)::user_profile, 'iqc_manager', 'agree', '同意报废，无法返修', CURRENT_TIMESTAMP, 0);

  RAISE NOTICE '报废联调 MRB 已生成：% (lot=%)', v_mrb, v_lot;
END $$;

SELECT r.mrb_no, r.id, r.status, r.quantity,
       (SELECT COUNT(*) FROM mrb_disposition d WHERE d.mrb_id = r.id) AS dispositions
FROM mrb_review r WHERE r.batch_no = 'TEST-MRBV3-SCRAP';
