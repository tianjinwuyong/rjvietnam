-- ============================================================================
-- IQC 检验严格度：由「物料 + 检验类型」两条账合并为「物料」一条账
--
-- 背景（2026-10-19 定稿）：不良批数只看每份检验报告的最终判定，
-- 不按 NG 出在哪个工段拆分。原来 appearance / dimensional 各自维护一套状态，
-- 同一份报告会被两个账本各记一次，页面也要按检验类型筛选，与实际口径不符。
--
-- 本脚本做三件事：
--   1. 每个物料按「就严」原则合并出一条 inspection_type='material' 的账；
--   2. 计数台账只保留一条（保留 appearance 的历史序列，删除 dimensional 重复行）；
--   3. 删除旧的 appearance / dimensional 状态行。
-- 历史转移日志（iqc_strictness_transfer_log）不删除，保留审计痕迹。
--
-- 幂等：可重复执行。
-- ============================================================================

BEGIN;

-- 1) 合并物料级状态：suspended > tightened > 全免检 > normal > reduced
INSERT INTO iqc_inspection_strictness (
  material_id,
  inspection_type,
  strictness,
  inspection_level,
  aql
)
SELECT
  material_id,
  'material',
  CASE
    WHEN bool_or(strictness = 'suspended') THEN 'suspended'
    WHEN bool_or(strictness = 'tightened') THEN 'tightened'
    WHEN bool_and(strictness = 'exempt') THEN 'exempt'
    WHEN bool_or(strictness = 'normal') THEN 'normal'
    WHEN bool_or(strictness = 'reduced') THEN 'reduced'
    ELSE 'normal'
  END,
  COALESCE(MAX(inspection_level) FILTER (WHERE inspection_type = 'appearance'), 'II'),
  COALESCE(MAX(aql) FILTER (WHERE inspection_type = 'appearance'), '0.40')
FROM iqc_inspection_strictness
WHERE inspection_type IN ('appearance', 'dimensional')
GROUP BY material_id
ON CONFLICT (material_id, inspection_type) DO NOTHING;

-- 2) 计数台账归一：先删 dimensional，避免与 appearance 重命名后撞唯一键
DELETE FROM iqc_lot_strictness_count WHERE inspection_type = 'dimensional';
UPDATE iqc_lot_strictness_count
   SET inspection_type = 'material'
 WHERE inspection_type = 'appearance';

-- 3) 删除旧的类型级状态行
DELETE FROM iqc_inspection_strictness
 WHERE inspection_type IN ('appearance', 'dimensional');

COMMIT;

-- 校验：每个物料应只有一条（inspection_type='material'）
-- SELECT material_id, COUNT(*) FROM iqc_inspection_strictness GROUP BY 1 HAVING COUNT(*) > 1;
