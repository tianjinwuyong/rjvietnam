-- ============================================================================
-- 277 · MES-ruijing 移植 W2 补充：pln_schedule.process 列
-- 源 api/basic.py 引用（工序改名联动、工序引用计数），源库经未入库的修复脚本
-- 加列；此处补齐。
-- ============================================================================

ALTER TABLE pln_schedule ADD COLUMN IF NOT EXISTS process TEXT NOT NULL DEFAULT '';
