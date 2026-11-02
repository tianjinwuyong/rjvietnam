-- ============================================================
-- IQC 人工判定留痕（2026-10-18）
--
-- 背景：IQC 批次结论默认必须由「检验小项」推导（每个小项合格 → pass，
-- 任一 NG → fail），但存在特殊情况需要主管直接维护 pass/fail。
-- 此前 judgeLot 对任何登录用户开放、不记录判定人与原因，导致库里出现
-- 5 份「零小项但判定 pass 且已审批」的报告，事后无法追溯是谁放的。
--
-- 本迁移只加留痕字段，不改任何业务结论：
--   judge_mode   判定方式：inspection(按小项推导) / manual(人工判定)
--   judge_reason 人工判定的原因（manual 时必填，服务端强制）
--   judged_by    人工判定的操作人
--   judged_at    人工判定的操作时间
--
-- 回填规则：
--   有小项记录 → inspection
--   零小项     → manual，并写入「历史数据」原因，便于质量审核区分
-- ============================================================

SET client_encoding = 'UTF8';

ALTER TABLE iqc_report
  ADD COLUMN IF NOT EXISTS judge_mode   varchar(20) NOT NULL DEFAULT 'inspection',
  ADD COLUMN IF NOT EXISTS judge_reason text,
  ADD COLUMN IF NOT EXISTS judged_by    user_profile,
  ADD COLUMN IF NOT EXISTS judged_at    timestamptz(3);

COMMENT ON COLUMN iqc_report.judge_mode   IS '判定方式：inspection=按检验小项推导；manual=主管人工判定';
COMMENT ON COLUMN iqc_report.judge_reason IS '人工判定原因（judge_mode=manual 时必填）';
COMMENT ON COLUMN iqc_report.judged_by    IS '人工判定操作人';
COMMENT ON COLUMN iqc_report.judged_at    IS '人工判定操作时间';

CREATE INDEX IF NOT EXISTS idx_iqc_rpt_judge_mode ON iqc_report (judge_mode);

-- 1) 有检验小项：属于正常检验流程推导
UPDATE iqc_report r
SET judge_mode = 'inspection'
WHERE EXISTS (
  SELECT 1 FROM iqc_inspection_record q WHERE q.lot_id = r.lot_id
);

-- 2) 零小项却有结论：属于人工/直接判定，标记出来
UPDATE iqc_report r
SET judge_mode   = 'manual',
    judge_reason = COALESCE(
      NULLIF(btrim(r.judge_reason), ''),
      '历史数据：判定时未录入检验小项，判定人与原因不可考（2026-10-18 迁移标记）'
    ),
    judged_at    = COALESCE(r.judged_at, r.inspection_time, r._created_at)
WHERE NOT EXISTS (
  SELECT 1 FROM iqc_inspection_record q WHERE q.lot_id = r.lot_id
);

-- 3) 校验：不允许存在「零小项 + inspection」的矛盾数据
DO $$
DECLARE
  bad int;
BEGIN
  SELECT count(*) INTO bad
  FROM iqc_report r
  WHERE r.judge_mode = 'inspection'
    AND NOT EXISTS (SELECT 1 FROM iqc_inspection_record q WHERE q.lot_id = r.lot_id);
  IF bad > 0 THEN
    RAISE EXCEPTION '迁移校验失败：仍有 % 份零小项报告被标记为 inspection', bad;
  END IF;
END $$;
