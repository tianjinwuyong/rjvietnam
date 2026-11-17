-- 256: process-stage classification on BOM lines for line-specific material
-- issue. Each BOM line is tagged with the production stage/domain from the
-- BOM workbook ("工段" column): 贴片段=SMT, 插件段=MANUAL, AI/组装段=AUTO,
-- 包装段=PACKAGING, 辅料=AUX. Collect lists split by domain so the SMT line
-- leader, auto-line leader and manual-line leader each receive their own
-- material issue.

ALTER TABLE bom_lines ADD COLUMN IF NOT EXISTS process_stage VARCHAR(40);
ALTER TABLE bom_lines ADD COLUMN IF NOT EXISTS process_domain VARCHAR(20);
CREATE INDEX IF NOT EXISTS idx_bom_lines_domain ON bom_lines(bom_id, process_domain);

-- Collect orders/lines may carry the domain they were generated for.
ALTER TABLE wms_collect_orders ADD COLUMN IF NOT EXISTS process_domain VARCHAR(20);
ALTER TABLE wms_collect_order_lines ADD COLUMN IF NOT EXISTS process_domain VARCHAR(20);
