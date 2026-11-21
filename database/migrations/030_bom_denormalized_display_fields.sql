-- Migration: Add denormalized display columns to bom_lines
-- These allow the BOM UI to show chineseMaterialCode, materialCategory, spec, unit, materialName
-- directly from bom_lines without an extra join to materials (since materials.code is the
-- Chinese code but the BOM import uses Vietnamese codes as primary materialCode).

ALTER TABLE bom_lines
  ADD COLUMN IF NOT EXISTS china_material_code varchar(80),
  ADD COLUMN IF NOT EXISTS material_category   varchar(80),
  ADD COLUMN IF NOT EXISTS spec                 text,
  ADD COLUMN IF NOT EXISTS unit                 varchar(20),
  ADD COLUMN IF NOT EXISTS material_name_zh    varchar(160),
  ADD COLUMN IF NOT EXISTS material_name_en    varchar(160),
  ADD COLUMN IF NOT EXISTS material_name_vi    varchar(160);

COMMENT ON COLUMN bom_lines.china_material_code IS 'Chinese material code (from 物料代码 column in BOM file)';
COMMENT ON COLUMN bom_lines.material_category   IS 'BOM level label: 成品/装配件/初级插件件/初级贴片件/次级插件件/次级贴片件';
COMMENT ON COLUMN bom_lines.spec                IS '规格型号 from BOM file';
COMMENT ON COLUMN bom_lines.unit                IS '单位 from BOM file';
COMMENT ON COLUMN bom_lines.material_name_zh    IS '物料名称 from BOM file (denormalized for display)';
COMMENT ON COLUMN bom_lines.material_name_en    IS 'Material name EN (defaults to material_name_zh)';
COMMENT ON COLUMN bom_lines.material_name_vi    IS 'Material name VI (defaults to material_name_zh)';
