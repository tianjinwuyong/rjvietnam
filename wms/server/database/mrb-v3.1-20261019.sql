-- ============================================================
-- MRB v3.1 增量：撤回 + 驳回（退回 SQE 改方案）
-- 日期：2026-10-19
-- 说明：全部为「新增」，不删列、不改列类型，可重复执行（IF NOT EXISTS）
--
-- 背景：
--   v3 允许 SQE 在发起后制定方案，但「提交评审」后想改方案没有任何出口
--   （只能整单作废重开），审批节点也只能「否决并全批退货」，不能退回修改。
--   本脚本新增两类流转留痕：
--     1) 撤回（withdraw）：SQE 在评审中把单子拉回「待制定方案」
--     2) 驳回（return）  ：IQC 主管预审 / 质量经理终审把单子退回 SQE 改方案
--   两者都不改变库存，也不生成下游单。
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. mrb_review 扩展：撤回留痕 + 驳回留痕
-- ------------------------------------------------------------
ALTER TABLE mrb_review ADD COLUMN IF NOT EXISTS withdraw_reason text;
ALTER TABLE mrb_review ADD COLUMN IF NOT EXISTS withdraw_by     user_profile;
ALTER TABLE mrb_review ADD COLUMN IF NOT EXISTS withdraw_time   timestamptz(3);

ALTER TABLE mrb_review ADD COLUMN IF NOT EXISTS return_reason   text;
ALTER TABLE mrb_review ADD COLUMN IF NOT EXISTS return_by       user_profile;
ALTER TABLE mrb_review ADD COLUMN IF NOT EXISTS return_time     timestamptz(3);
-- 从哪个审批节点退回：pending_approval（预审）/ pending_final（终审）
ALTER TABLE mrb_review ADD COLUMN IF NOT EXISTS return_from     varchar(20);

COMMENT ON COLUMN mrb_review.withdraw_reason IS 'SQE 撤回方案的原因（评审中 → 待制定方案）';
COMMENT ON COLUMN mrb_review.withdraw_by     IS '撤回操作人';
COMMENT ON COLUMN mrb_review.withdraw_time   IS '撤回时间';
COMMENT ON COLUMN mrb_review.return_reason   IS '审批驳回原因（预审 / 终审退回 SQE 改方案）';
COMMENT ON COLUMN mrb_review.return_by       IS '驳回操作人';
COMMENT ON COLUMN mrb_review.return_time     IS '驳回时间';
COMMENT ON COLUMN mrb_review.return_from     IS '退回来路：pending_approval=预审 / pending_final=终审';

COMMIT;
