-- ============================================================
-- B2 库存落点联调数据：造一个「待检库存 + 待审批的 fail 报告」
-- 目的：验证 IQC 判不合格后**不再搬到不良品仓**、二维码不清空。
-- 用法：psql -d wms -f server/database/_test-iqc-b2.sql
-- ============================================================
DO $$
DECLARE
  v_supplier uuid;
  v_supplier_code varchar;
  v_material uuid;
  v_material_code varchar;
  v_unit varchar;
  v_loc uuid;
  v_loc_code varchar;
  v_lot uuid;
  v_receipt uuid;
  v_inspector uuid;
  v_batch varchar := 'TEST-IQC-B2';
BEGIN
  SELECT id, supplier_code INTO v_supplier, v_supplier_code FROM supplier ORDER BY supplier_code LIMIT 1;
  SELECT id, material_code, unit INTO v_material, v_material_code, v_unit FROM material ORDER BY material_code LIMIT 1;
  -- 故意用一个「排序靠后」的专用库位：
  -- 老逻辑会把不合格货搬到 getDefectiveWarehouseLocation()（按 location_code 取第一个），
  -- 只有让两者不同，才能证明「货没被搬走」。
  INSERT INTO warehouse_location (warehouse_id, location_code, location_type, status)
  VALUES ((SELECT id FROM warehouse ORDER BY wh_code LIMIT 1), 'ZZ-TEST-B2-LOC', 'defective', 'active')
  ON CONFLICT DO NOTHING;

  SELECT id, location_code INTO v_loc, v_loc_code
    FROM warehouse_location WHERE location_code = 'ZZ-TEST-B2-LOC';

  SELECT id INTO v_inspector FROM sys_account WHERE role_code = 'iqc_inspector' LIMIT 1;

  IF v_supplier IS NULL OR v_material IS NULL OR v_loc IS NULL THEN
    RAISE EXCEPTION '缺少基础主数据';
  END IF;

  DELETE FROM iqc_report        WHERE lot_id IN (SELECT id FROM iqc_lot WHERE batch_no = v_batch);
  DELETE FROM iqc_inspection_record WHERE lot_id IN (SELECT id FROM iqc_lot WHERE batch_no = v_batch);
  DELETE FROM inventory         WHERE batch_no = v_batch;
  DELETE FROM iqc_lot_receipt   WHERE lot_id IN (SELECT id FROM iqc_lot WHERE batch_no = v_batch);
  DELETE FROM receipt_order     WHERE batch_no = v_batch;
  DELETE FROM iqc_lot           WHERE batch_no = v_batch;

  INSERT INTO receipt_order (receipt_no, receipt_date, supplier_id, material_id, quantity, unit,
                             production_date, batch_no, serial_no, location_id, qr_content, status)
  VALUES ('TEST-B2-RC-001', CURRENT_DATE, v_supplier, v_material, 80, v_unit,
          CURRENT_DATE - 5, v_batch, '001', v_loc,
          v_supplier_code || '*' || v_material_code || '*20261014*80*' || v_batch || '*001', 'pending_iqc')
  RETURNING id INTO v_receipt;

  -- 待检库存：pending_qc，带二维码
  INSERT INTO inventory (material_id, location_id, batch_no, supplier_id, quantity, unit,
                         stock_status, production_date, locked, label_no)
  VALUES (v_material, v_loc, v_batch, v_supplier, 80, v_unit,
          'pending_qc', CURRENT_DATE - 5, false, 'TEST-B2-RC-001');

  INSERT INTO iqc_lot (lot_no, inspection_no, receipt_date, supplier_id, material_id,
                       total_qty, unit, production_date, batch_no, box_count,
                       inspection_result, status, inspector_id, defect_type)
  VALUES ('TEST-B2-LOT', 'TEST-B2-IQC', CURRENT_DATE, v_supplier, v_material,
          80, v_unit, CURRENT_DATE - 5, v_batch, 1, 'fail', 'review_pending',
          ROW(v_inspector)::user_profile, 'appearance')
  RETURNING id INTO v_lot;

  INSERT INTO iqc_lot_receipt (lot_id, receipt_id) VALUES (v_lot, v_receipt);

  INSERT INTO iqc_report (lot_id, report_no, final_result, inspector_id,
                          inspection_time, review_status, judge_mode)
  VALUES (v_lot, 'TEST-B2-RPT', 'fail', ROW(v_inspector)::user_profile,
          CURRENT_TIMESTAMP, 'pending', 'manual')
  RETURNING id INTO v_receipt;  -- 复用变量装报告 id

  RAISE NOTICE 'B2 测试：lot=% 报告=% 库位=%', v_lot, v_receipt, v_loc_code;
END $$;

SELECT r.report_no, r.id AS report_id, r.final_result, r.review_status, l.batch_no, l.id AS lot_id
FROM iqc_report r JOIN iqc_lot l ON l.id = r.lot_id
WHERE l.batch_no = 'TEST-IQC-B2';
