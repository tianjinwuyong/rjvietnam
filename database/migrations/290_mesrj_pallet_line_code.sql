-- W12: prd_pallet 补 line_code（源 pallet.py _ensure_pallet_line_col 运行时补列的迁移化）
--
-- 源语义（api/pallet.py）：同一张工单两条产线并行码垛时，A 线的箱不许上 B 线的板，
-- 栈板按「工单 + 产线」隔离。列不存在时源在模块加载时 ALTER TABLE 补，这里迁移化。
CREATE TABLE IF NOT EXISTS prd_pallet (id bigserial PRIMARY KEY);

ALTER TABLE prd_pallet ADD COLUMN IF NOT EXISTS line_code text NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS mesrj_ix_pallet_mo_status ON prd_pallet (mo_no, status);
CREATE INDEX IF NOT EXISTS mesrj_ix_pallet_no ON prd_pallet (pallet_no);
