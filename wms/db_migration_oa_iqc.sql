-- ============================================================
-- OA 接管 IQC 检验 —— WMS 侧增量迁移（P1）
--
-- 设计依据：deliverables/IQC搬OA-P1详细设计-2026-10-22.md
-- 原则：
--   · 只增列/增表，**不改任何既有列与约束** → 回滚只需 DROP 这些新增对象
--   · 不触碰库存/严格度/MRB 逻辑（这些继续由 reviewReport 原链路完成）
--
-- 字段说明：
--   oa_claimed_by  当前由 OA 认领该批次的检验员（OA 侧账号或工号）
--   oa_claimed_at  认领时间；用于「双入口防冲突」与 4 小时超时释放
--   oa_source      该批次的检验来源：oa / wms / null（历史数据）
--                  用途：对账与审计（哪边录的），不参与业务判定
-- ============================================================

ALTER TABLE iqc_lot ADD COLUMN IF NOT EXISTS oa_claimed_by VARCHAR(100);
ALTER TABLE iqc_lot ADD COLUMN IF NOT EXISTS oa_claimed_at TIMESTAMPTZ;
ALTER TABLE iqc_lot ADD COLUMN IF NOT EXISTS oa_source     VARCHAR(10);

COMMENT ON COLUMN iqc_lot.oa_claimed_by IS 'OA 认领检验人（双入口防冲突；4h 未提交由 OA 释放）';
COMMENT ON COLUMN iqc_lot.oa_claimed_at IS 'OA 认领时间';
COMMENT ON COLUMN iqc_lot.oa_source     IS '检验来源：oa / wms / NULL(历史)';

-- 便于按认领状态筛查（WMS 录入页要判断"是否已被 OA 认领"）
CREATE INDEX IF NOT EXISTS idx_iqc_lot_oa_claim ON iqc_lot(oa_claimed_at) WHERE oa_claimed_at IS NOT NULL;
