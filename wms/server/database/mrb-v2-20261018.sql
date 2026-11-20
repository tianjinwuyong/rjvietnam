-- ============================================================
-- MRB v2 迁移（2026-10-18）
-- 落地四项制度决定：
--   1) 新增 pending_approval「齐全性确认」环节所需字段
--   2) 发起时可填「本次评审数量」——quantity 列语义即本单数量，无需改表
--   3) 「其他」处置收窄为 退回客户 / 转留样 / 待定暂存，新增关联单号与复核日期
--   4) 巡检所需的急件标记与按状态+时间索引
-- 全部语句幂等，可重复执行。
-- ============================================================

-- ---------- 1. mrb_review：待审批（齐全性确认）----------
ALTER TABLE mrb_review
  ADD COLUMN IF NOT EXISTS completeness_result varchar(20),
  ADD COLUMN IF NOT EXISTS completeness_by     user_profile,
  ADD COLUMN IF NOT EXISTS completeness_time   timestamptz(3),
  ADD COLUMN IF NOT EXISTS completeness_remark text;

COMMENT ON COLUMN mrb_review.completeness_result IS '齐全性确认结果：complete=齐全 / incomplete=不齐退回';
COMMENT ON COLUMN mrb_review.completeness_by     IS '齐全性确认人（质量主管）';
COMMENT ON COLUMN mrb_review.completeness_time   IS '齐全性确认时间';

-- ---------- 2. mrb_review：急件标记 ----------
ALTER TABLE mrb_review
  ADD COLUMN IF NOT EXISTS is_urgent     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS urgent_reason text;

COMMENT ON COLUMN mrb_review.is_urgent     IS '急件：压缩各环节时限，但不跳过任何签批节点';
COMMENT ON COLUMN mrb_review.urgent_reason IS '急件原因（停线/客户急单等）';

-- ---------- 3. mrb_disposition：「其他」三类的附加信息 ----------
ALTER TABLE mrb_disposition
  ADD COLUMN IF NOT EXISTS ref_no     varchar(50),
  ADD COLUMN IF NOT EXISTS hold_until date;

COMMENT ON COLUMN mrb_disposition.ref_no     IS '退回客户/留样的关联单号或留样编号';
COMMENT ON COLUMN mrb_disposition.hold_until IS '待定暂存复核日期，到期未转正式处置即进巡检清单';

-- ---------- 4. 巡检用索引 ----------
CREATE INDEX IF NOT EXISTS idx_mrb_status_updated ON mrb_review(status, _updated_at);
CREATE INDEX IF NOT EXISTS idx_mrb_disp_hold      ON mrb_disposition(exec_status, hold_until);
CREATE INDEX IF NOT EXISTS idx_mrb_disp_type      ON mrb_disposition(disposition_type);
