-- =============================================================================
-- 394: supplier_debt 形状收敛 —— FK / source 列 / id 索引（对齐参考 WMS-20261019）
-- =============================================================================
-- 背景（实测，非推断）：
--   参考 supplier_debt_tables.sql 的 supplier_id / material_id / source_id 都是
--   NOT NULL UUID，索引建在 id 列上（idx_supplier_debt_supplier(supplier_id) 等）。
--   SMT 侧（296/297/300/301）用 bigint 规范主键，id 列可空、无 FK、索引仍建在
--   code 列上 —— 形状分叉。本迁移把「关系完整性」补齐，不改变 bigint 规范主键
--   口径（309 的决策：无前缀表是权威，rjvn_* 只是镜像）。
--
-- 为什么 id 列保持可空（不加 NOT NULL）：
--   现存 2 行是测试数据（SUP-TEST / MAT-DEBT-1），其 code 在 suppliers/materials
--   里查无此码 → id 解析为 NULL。真实 MRB/IQC 流的 code 都能解析。强加 NOT NULL
--   会卡死这些历史行与任何 code 未建档的边界场景；参考的 NOT NULL 依赖 uuid 必传，
--   而 SMT 的 createDebt/settleDebtOnReceipt 明确允许「只知 code」的调用方
--   （supplier-debt-hooks.js:60-64 按 code 兜底解析）。故 FK 用「可空 + 有值必真」。
--
-- 内容：
--   ① 四个 FK（supplier_id→suppliers, material_id→materials,
--      iqc_inspection_id→iqc_inspections, mrb_id→mrb_review），guarded 幂等。
--      现存数据无孤儿（实测 0），加 FK 安全；将来写入非法 id 会被拒（这正是收敛目的）。
--   ② id 列索引（对齐参考的索引口径；code 索引保留，list 路由仍按 code/name 过滤）。
--   ③ source_id 索引（参考 idx_supplier_debt_source；按来源单追溯欠料）。
--
-- 归属: 表已归 smt_factory（302），FK/索引随表，无需单独授权。
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_debt_supplier_id_fkey') THEN
    ALTER TABLE supplier_debt ADD CONSTRAINT supplier_debt_supplier_id_fkey
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_debt_material_id_fkey') THEN
    ALTER TABLE supplier_debt ADD CONSTRAINT supplier_debt_material_id_fkey
      FOREIGN KEY (material_id) REFERENCES materials(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_debt_iqc_inspection_id_fkey') THEN
    ALTER TABLE supplier_debt ADD CONSTRAINT supplier_debt_iqc_inspection_id_fkey
      FOREIGN KEY (iqc_inspection_id) REFERENCES iqc_inspections(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_debt_mrb_id_fkey') THEN
    ALTER TABLE supplier_debt ADD CONSTRAINT supplier_debt_mrb_id_fkey
      FOREIGN KEY (mrb_id) REFERENCES mrb_review(id);
  END IF;
END $$;

-- id / source 索引（参考口径；IF NOT EXISTS 幂等）
CREATE INDEX IF NOT EXISTS idx_supplier_debt_supplier_id ON supplier_debt(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_debt_material_id ON supplier_debt(material_id);
CREATE INDEX IF NOT EXISTS idx_supplier_debt_source_id ON supplier_debt(source_id);
CREATE INDEX IF NOT EXISTS idx_supplier_debt_mrb_id ON supplier_debt(mrb_id);
CREATE INDEX IF NOT EXISTS idx_supplier_debt_iqc_inspection_id ON supplier_debt(iqc_inspection_id);