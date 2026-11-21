-- 312: 找回旧 MES 有、新库丢掉的 3 列（审计 P2 #12）
--   prd_shift_report.start_time / end_time —— 报工时长、Excel 报表按这两列算
--   prd_aoi_result.raw_z —— AOI 原始坐标（复判/二次分析用）
-- 源类型：SQLite TEXT / BLOB → PG timestamptz / bytea。

ALTER TABLE prd_shift_report ADD COLUMN IF NOT EXISTS start_time TIMESTAMPTZ;
ALTER TABLE prd_shift_report ADD COLUMN IF NOT EXISTS end_time   TIMESTAMPTZ;
ALTER TABLE prd_aoi_result  ADD COLUMN IF NOT EXISTS raw_z      BYTEA;
