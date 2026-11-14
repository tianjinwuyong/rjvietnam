-- ============================================================
-- WMS 缺陷修复 · 数据库层约束补强
-- 对应报告：WMS-测试报告与修复方案.md
-- 生成日期：2026-10-08
-- 说明：应用层判断会被并发绕过，数据库唯一约束是最后一道防线。
-- ============================================================

-- ------------------------------------------------------------
-- BUG-002：供应商欠料冲减幂等 —— 同一条欠料 + 同一张收料单只允许冲减一次
-- 防止 IQC 重复审批导致债务被重复扣减
-- ------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS supplier_debt_settlement_debt_receipt_uniq
  ON supplier_debt_settlement (debt_id, receipt_id);

-- ------------------------------------------------------------
-- BUG-019 已撤销：同一仓库同一期间允许多次盘点（月度 + 临时抽盘 + 复盘）
-- 唯一索引改为普通查询索引；单号由序列保证唯一，批次靠 take_type / title 区分
-- ------------------------------------------------------------
DROP INDEX IF EXISTS stock_take_order_period_wh_uniq;
CREATE INDEX IF NOT EXISTS idx_sto_period_wh
  ON stock_take_order (period_month, warehouse_code);

-- ------------------------------------------------------------
-- BUG-004：物料需求单同一工单同一工段唯一 —— 防止重复生成需求单
-- 注意：仅对未取消的需求单生效
-- ------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS material_requirement_wo_section_uniq
  ON material_requirement (work_order_id, work_section)
  WHERE status <> 'cancelled';

-- ------------------------------------------------------------
-- BUG-001：标签号不再全局唯一（方案 B：改为服务端全局重编）
-- 原有两个唯一索引（inventory_label_no_unique / idx_inventory_label_no）制约了
-- 供应商复用流水号的正常场景，导致合法收料 500。此处移除，
-- 改为普通索引（保留按标签号检索能力），唯一性由服务端生成的 label_no 保证。
-- ------------------------------------------------------------
-- 注意：inventory_label_no_unique 是由表级约束承载的，必须用 ALTER TABLE 删除约束
ALTER TABLE public.inventory DROP CONSTRAINT IF EXISTS inventory_label_no_unique;
DROP INDEX IF EXISTS idx_inventory_label_no;
CREATE INDEX IF NOT EXISTS idx_inventory_label_no ON public.inventory USING btree (label_no);

-- 全局唯一标签号序列（收料入库时生成 LBL{YYMMDD}{6位序号}）
CREATE SEQUENCE IF NOT EXISTS seq_inventory_label_no START 1;
