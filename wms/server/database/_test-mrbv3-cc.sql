-- ============================================================
-- MRB v3「终审抄送」联调用测试数据（可重复执行，按批次号去重）
-- 用途：造一张已提交方案、处于 pending_final 的 MRB，
--       直接调 /api/mrb/final-approve 即可验证 mrb_cc + sys_notice 是否落库。
-- 用法：psql -d wms -f server/database/_test-mrbv3-cc.sql
-- ============================================================
DO $$
DECLARE
  v_supplier uuid;
  v_supplier_code varchar;
  v_supplier_name varchar;
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
  v_batch varchar := 'TEST-MRBV3-CC';
BEGIN
  SELECT id, supplier_code, supplier_name INTO v_supplier, v_supplier_code, v_supplier_name
    FROM supplier ORDER BY supplier_code LIMIT 1;
  SELECT id, material_code, unit INTO v_material, v_material_code, v_unit
    FROM material ORDER BY material_code LIMIT 1;
  SELECT id INTO v_loc FROM warehouse_location ORDER BY location_code LIMIT 1;
  SELECT id INTO v_sqe FROM sys_account WHERE role_code = 'sqe' LIMIT 1;
  SELECT id INTO v_reviewer FROM sys_account WHERE role_code = 'iqc_manager' LIMIT 1;

  IF v_supplier IS NULL OR v_material IS NULL OR v_loc IS NULL OR v_sqe IS NULL THEN
    RAISE EXCEPTION '缺少基础主数据（supplier/material/location/sqe）';
  END IF;

  -- 幂等清理
  DELETE FROM sys_notice    WHERE biz_no LIKE 'TEST-MRB-CC%';
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
  VALUES ('TEST-CC-RC-001', CURRENT_DATE, v_supplier, v_material, 100, v_unit,
          CURRENT_DATE - 10, v_batch, '001', v_loc,
          v_supplier_code || '*' || v_material_code || '*20261009*100*' || v_batch || '*001', 'iqc_fail')
  RETURNING id INTO v_receipt1;

  INSERT INTO receipt_order (receipt_no, receipt_date, supplier_id, material_id, quantity, unit,
                             production_date, batch_no, serial_no, location_id, qr_content, status)
  VALUES ('TEST-CC-RC-002', CURRENT_DATE, v_supplier, v_material, 100, v_unit,
          CURRENT_DATE - 10, v_batch, '002', v_loc,
          v_supplier_code || '*' || v_material_code || '*20261009*100*' || v_batch || '*002', 'iqc_fail')
  RETURNING id INTO v_receipt2;

  INSERT INTO iqc_lot (lot_no, inspection_no, receipt_date, supplier_id, material_id,
                       total_qty, unit, production_date, batch_no, box_count,
                       inspection_result, status, inspector_id)
  VALUES ('TEST-CC-LOT', 'TEST-CC-IQC', CURRENT_DATE, v_supplier, v_material,
          200, v_unit, CURRENT_DATE - 10, v_batch, 2, 'fail', 'review_pending',
          ROW(v_reviewer)::user_profile)
  RETURNING id INTO v_lot;

  INSERT INTO iqc_lot_receipt (lot_id, receipt_id) VALUES (v_lot, v_receipt1);
  INSERT INTO iqc_lot_receipt (lot_id, receipt_id) VALUES (v_lot, v_receipt2);

  -- 良品仓锁定（IQC fail 原地锁定的新口径）
  INSERT INTO inventory (material_id, location_id, batch_no, supplier_id, quantity, unit,
                         stock_status, production_date, locked, lock_reason, label_no)
  VALUES (v_material, v_loc, v_batch, v_supplier, 200, v_unit,
          'defective', CURRENT_DATE - 10, true, 'IQC不合格待MRB(TEST-CC-LOT)', 'TEST-CC-RC-001');

  INSERT INTO mrb_review (mrb_no, lot_id, material_id, supplier_id, batch_no, quantity, unit,
                          fail_reason, status, sqe_id, plan_by, plan_time)
  VALUES ('TEST-MRB-CC', v_lot, v_material, v_supplier, v_batch, 200, v_unit,
          '测试：终端客户投诉外观划伤', 'pending_final', ROW(v_sqe)::user_profile,
          ROW(v_sqe)::user_profile, CURRENT_TIMESTAMP)
  RETURNING id INTO v_mrb;

  -- 方案：特采 100 + 退货 100，各按箱分摊
  INSERT INTO mrb_disposition (mrb_id, disposition_type, quantity, unit, exec_status, sort_order, remark)
  VALUES (v_mrb, 'special_admit', 100, v_unit, 'planned', 0, '外观可接受，特采放行')
  RETURNING id INTO v_d1;

  INSERT INTO mrb_disposition (mrb_id, disposition_type, quantity, unit, exec_status, sort_order, remark)
  VALUES (v_mrb, 'return', 100, v_unit, 'planned', 1, '同批次余量退回供应商')
  RETURNING id INTO v_d2;

  INSERT INTO mrb_disposition_label (mrb_id, disposition_id, receipt_id, receipt_no, qr_content, label_no, quantity)
  VALUES (v_mrb, v_d1, v_receipt1, 'TEST-CC-RC-001',
          v_supplier_code || '*' || v_material_code || '*20261009*50*' || v_batch || '*001', 'TEST-CC-RC-001', 50),
         (v_mrb, v_d1, v_receipt2, 'TEST-CC-RC-002',
          v_supplier_code || '*' || v_material_code || '*20261009*50*' || v_batch || '*002', 'TEST-CC-RC-002', 50),
         (v_mrb, v_d2, v_receipt1, 'TEST-CC-RC-001',
          v_supplier_code || '*' || v_material_code || '*20261009*50*' || v_batch || '*001', 'TEST-CC-RC-001', 50),
         (v_mrb, v_d2, v_receipt2, 'TEST-CC-RC-002',
          v_supplier_code || '*' || v_material_code || '*20261009*50*' || v_batch || '*002', 'TEST-CC-RC-002', 50);

  -- 评审员已表态（一人同意）
  INSERT INTO mrb_reviewer (mrb_id, reviewer_id, reviewer_role, review_result, review_opinion, review_time, sort_order)
  VALUES (v_mrb, ROW(v_reviewer)::user_profile, 'iqc_manager', 'agree', '方案合理，同意', CURRENT_TIMESTAMP, 0);

  RAISE NOTICE '抄送测试用 MRB 已生成：% (lot=%)', v_mrb, v_lot;
END $$;

SELECT r.mrb_no, r.id, r.status, r.quantity,
       (SELECT COUNT(*) FROM mrb_disposition d WHERE d.mrb_id = r.id) AS dispositions
FROM mrb_review r WHERE r.batch_no = 'TEST-MRBV3-CC';
