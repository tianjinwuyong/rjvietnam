-- 物料包装类型：用于识别盘装料（Reel）
-- normal=普通包装（按数量发料）  reel=盘装料（必须扫盘号发料/退料，进盘台账）
BEGIN;
ALTER TABLE material ADD COLUMN IF NOT EXISTS packaging_type varchar(20) NOT NULL DEFAULT 'normal';
CREATE INDEX IF NOT EXISTS idx_material_packaging ON material (packaging_type);
COMMIT;
