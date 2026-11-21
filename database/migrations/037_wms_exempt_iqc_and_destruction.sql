-- 037_wms_exempt_iqc_and_destruction.sql
-- 免检产品管理 + 销毁执行记录
-- 用法: psql -h localhost -U postgres -d smt_factory -f 037_wms_exempt_iqc_and_destruction.sql

-- ── 1. materials: 免检标志 ───────────────────────────────────────────────
ALTER TABLE materials ADD COLUMN IF NOT EXISTS iqc_required BOOLEAN NOT NULL DEFAULT TRUE;
COMMENT ON COLUMN materials.iqc_required IS 'true=必须IQC检验，false=免检直接入库';

-- ── 2. material_lots: 采购日期 + 有效期 ───────────────────────────────────
ALTER TABLE material_lots ADD COLUMN IF NOT EXISTS po_date DATE;
COMMENT ON COLUMN material_lots.po_date IS '采购日期/PO日期 — IQC和免检均需记录';

ALTER TABLE material_lots ADD COLUMN IF NOT EXISTS expiry_date DATE;
COMMENT ON COLUMN material_lots.expiry_date IS '有效期（由 received_at+shelf_life_days 计算，或手动覆盖）';

-- 触发器：新建批次时自动算 expiry_date（仅当 expiry_date 未指定时）
CREATE OR REPLACE FUNCTION set_expiry_from_material()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.expiry_date IS NULL THEN
    SELECT (NEW.created_at::DATE + make_interval(days => m.shelf_life_days::int))::DATE
    INTO NEW.expiry_date
    FROM materials m WHERE m.id = NEW.material_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_material_lots_expiry ON material_lots;
CREATE TRIGGER trg_material_lots_expiry
  BEFORE INSERT ON material_lots
  FOR EACH ROW EXECUTE FUNCTION set_expiry_from_material();

-- ── 3. material_scrapping: 销毁执行字段 ───────────────────────────────────
ALTER TABLE material_scrapping ADD COLUMN IF NOT EXISTS destroyed_qty NUMERIC(15, 3);
COMMENT ON COLUMN material_scrapping.destroyed_qty IS '实际销毁数量';

ALTER TABLE material_scrapping ADD COLUMN IF NOT EXISTS destruction_at TIMESTAMPTZ;
COMMENT ON COLUMN material_scrapping.destruction_at IS '销毁执行时间';

ALTER TABLE material_scrapping ADD COLUMN IF NOT EXISTS destruction_supervisor_id BIGINT REFERENCES hr_employees(id);
COMMENT ON COLUMN material_scrapping.destruction_supervisor_id IS '监督人 — 见证销毁过程';

ALTER TABLE material_scrapping ADD COLUMN IF NOT EXISTS destruction_doc_url VARCHAR(500);
COMMENT ON COLUMN material_scrapping.destruction_doc_url IS '销毁证明文档URL或文件路径';

-- ── 4. 修改 IQC 豁免逻辑：免检物料新建批次时直接 released ──────────────────
-- 现有 INSERT 时默认 iqc_status='pending'，通过 API 层或规则引擎处理：
--   IF materials.iqc_required = false → 新建批次 iqc_status = 'released'
-- 以下视图供 API 层快速查询免检物料：
CREATE OR REPLACE VIEW v_exempt_iqc_materials AS
SELECT m.id, m.code, m.name_zh, m.name_en, m.name_vi, m.shelf_life_days
FROM materials m
WHERE m.iqc_required = FALSE AND m.status = 'active';

-- ── 5. 免检批次视图 ────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW v_material_lots_exempt AS
SELECT
  ml.id, ml.lot_no, ml.received_qty, ml.iqc_status,
  ml.po_date, ml.expiry_date,
  m.code AS material_code, m.name_zh AS material_name_zh,
  s.code AS supplier_code,
  sl.code AS location_code,
  CASE
    WHEN ml.expiry_date < CURRENT_DATE THEN 'EXPIRED'
    WHEN ml.expiry_date <= CURRENT_DATE + INTERVAL '30 days' THEN 'RED_L3'
    WHEN ml.expiry_date <= CURRENT_DATE + INTERVAL '90 days' THEN 'BLUE_L2'
    WHEN ml.expiry_date <= CURRENT_DATE + INTERVAL '180 days' THEN 'YELLOW_L1'
    ELSE 'NORMAL'
  END AS alert_level
FROM material_lots ml
JOIN materials m ON m.id = ml.material_id
JOIN suppliers s ON s.id = ml.supplier_id
LEFT JOIN storage_locations sl ON sl.id = ml.storage_location_id
WHERE m.iqc_required = FALSE
  AND ml.lot_status = 'open';

-- ── 6. 销毁记录完整视图（包含监督人姓名） ──────────────────────────────────
CREATE OR REPLACE VIEW v_material_destruction_records AS
SELECT
  ms.id, ms.request_no, ms.scrap_qty, ms.destroyed_qty,
  ms.destruction_at, ms.destruction_doc_url,
  ms.scrap_reason, ms.disposal_method, ms.isolation_status, ms.status,
  ms.created_at,
  ml.lot_no, m.code AS material_code, m.name_zh AS material_name_zh,
  a.name_zh AS applicant_name,
  w.name_zh AS warehouse_approver,
  q.name_zh AS quality_approver,
  d.name_zh AS destruction_supervisor
FROM material_scrapping ms
JOIN material_lots ml ON ml.id = ms.material_lot_id
JOIN materials m ON m.id = ml.material_id
LEFT JOIN hr_employees a ON a.id = ms.applicant_id
LEFT JOIN hr_employees w ON w.id = ms.warehouse_approved_by
LEFT JOIN hr_employees q ON q.id = ms.quality_approved_by
LEFT JOIN hr_employees d ON d.id = ms.destruction_supervisor_id
WHERE ms.status = 'APPROVED';
