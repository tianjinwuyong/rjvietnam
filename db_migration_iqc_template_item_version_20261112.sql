-- ============================================================
-- 检验模板项目「版本化 + 归档」改造
-- 日期：2026-11-12
-- 背景：原 saveItems 采用「整表删除后重建」，当 iqc_inspection_record
--       已引用 iqc_template_item 时，删除触发外键 23503，保存直接失败。
-- 方案：给 iqc_template_item 增加 deleted_at（归档时间）。
--       保存时改为 diff（更新 / 新增 / 归档），旧行保留供历史报告追溯，
--       查询一律过滤 deleted_at IS NULL，界面上只看到最新版本。
-- 影响：纯新增列（可空），不修改任何既有行，不改约束，安全可回滚。
-- 回滚：ALTER TABLE iqc_template_item DROP COLUMN deleted_at;
-- ============================================================

ALTER TABLE iqc_template_item
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz(3);

COMMENT ON COLUMN iqc_template_item.deleted_at IS
  '归档时间：保存新版本时被移除的项目行只做逻辑归档，保留 id 供历史检验记录引用';

-- 部分索引：只索引仍生效的项目行，供模板加载与预览使用
CREATE INDEX IF NOT EXISTS idx_iqc_tpl_item_active
  ON iqc_template_item (template_id)
  WHERE deleted_at IS NULL;
