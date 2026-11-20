-- ============================================================
-- MRB v3 增量改造：方案化 + 二维码分摊 + 抄送 + 站内消息
-- 日期：2026-10-19
-- 说明：全部为「新增」，不删列、不改列类型，可重复执行（IF NOT EXISTS）
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. mrb_review 扩展：方案提交时间 + 抄送时间
-- ------------------------------------------------------------
ALTER TABLE mrb_review ADD COLUMN IF NOT EXISTS plan_by   user_profile;
ALTER TABLE mrb_review ADD COLUMN IF NOT EXISTS plan_time timestamptz(3);
ALTER TABLE mrb_review ADD COLUMN IF NOT EXISTS cc_sent_at timestamptz(3);

COMMENT ON COLUMN mrb_review.plan_by   IS 'SQE 提交方案的操作人';
COMMENT ON COLUMN mrb_review.plan_time IS '方案提交时间（评审 SLA 起点）';
COMMENT ON COLUMN mrb_review.cc_sent_at IS '抄送发送时间，防重复推送';

-- ------------------------------------------------------------
-- 2. mrb_disposition_label：按收货二维码分摊的处置明细
--    一箱可拆到多个处置，故只对 (disposition_id, receipt_id) 唯一
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mrb_disposition_label (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mrb_id         uuid NOT NULL,
  disposition_id uuid NOT NULL,
  receipt_id     uuid NOT NULL,
  receipt_no     varchar(50),
  qr_content     text,
  label_no       varchar(100),
  quantity       numeric(18,4) NOT NULL DEFAULT 0,
  _created_at    timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by    user_profile,
  _updated_at    timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by    user_profile
);

CREATE INDEX IF NOT EXISTS idx_mdl_mrb        ON mrb_disposition_label (mrb_id);
CREATE INDEX IF NOT EXISTS idx_mdl_disp       ON mrb_disposition_label (disposition_id);
CREATE INDEX IF NOT EXISTS idx_mdl_receipt    ON mrb_disposition_label (receipt_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_mdl_disp_receipt ON mrb_disposition_label (disposition_id, receipt_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mrb_disposition_label_mrb_id_fkey') THEN
    ALTER TABLE mrb_disposition_label
      ADD CONSTRAINT mrb_disposition_label_mrb_id_fkey
      FOREIGN KEY (mrb_id) REFERENCES mrb_review(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mrb_disposition_label_disp_id_fkey') THEN
    ALTER TABLE mrb_disposition_label
      ADD CONSTRAINT mrb_disposition_label_disp_id_fkey
      FOREIGN KEY (disposition_id) REFERENCES mrb_disposition(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 3. mrb_cc：抄送名单快照（存姓名，人员改名不影响历史单据）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mrb_cc (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mrb_id      uuid NOT NULL,
  user_id     user_profile NOT NULL,
  user_name   varchar(100),
  role_code   varchar(50),
  read_at     timestamptz(3),
  _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_mrb_cc_mrb_user ON mrb_cc (mrb_id, ((user_id).user_id));
CREATE INDEX IF NOT EXISTS idx_mrb_cc_mrb ON mrb_cc (mrb_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mrb_cc_mrb_id_fkey') THEN
    ALTER TABLE mrb_cc
      ADD CONSTRAINT mrb_cc_mrb_id_fkey
      FOREIGN KEY (mrb_id) REFERENCES mrb_review(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 4. sys_notice：轻量站内消息（顶栏铃铛数据源）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sys_notice (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     user_profile NOT NULL,
  title       varchar(200) NOT NULL,
  content     text,
  biz_type    varchar(20) NOT NULL DEFAULT 'mrb',
  biz_id      uuid,
  biz_no      varchar(50),
  is_read     boolean NOT NULL DEFAULT false,
  read_at     timestamptz(3),
  _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile
);

CREATE INDEX IF NOT EXISTS idx_notice_user_time ON sys_notice (((user_id).user_id), is_read, _created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notice_biz ON sys_notice (biz_type, biz_id);

-- ------------------------------------------------------------
-- 5. defective_move_task 扩展：标明来源 MRB 与原因
-- ------------------------------------------------------------
ALTER TABLE defective_move_task ADD COLUMN IF NOT EXISTS mrb_id  uuid;
ALTER TABLE defective_move_task ADD COLUMN IF NOT EXISTS source  varchar(20);
ALTER TABLE defective_move_task ADD COLUMN IF NOT EXISTS reason  text;

CREATE INDEX IF NOT EXISTS idx_dmt_mrb    ON defective_move_task (mrb_id);
CREATE INDEX IF NOT EXISTS idx_dmt_status ON defective_move_task (status);

COMMENT ON COLUMN defective_move_task.source IS '来源：mrb_reject(否决) / mrb_return(退货) / manual(人工)';

-- ------------------------------------------------------------
-- 6. mrb_disposition.exec_status 注释补充 planned 语义
--    枚举值不建约束（现有表为 varchar），仅在服务层校验
-- ------------------------------------------------------------
COMMENT ON COLUMN mrb_disposition.exec_status IS 'planned(方案已定) / pending(待执行) / done(已执行) / cancelled(已取消)';

COMMIT;

-- ============================================================
-- 执行方式：
--   psql -h localhost -U postgres -d wms -f server/database/mrb-v3-20261019.sql
-- 或在迁移脚本中引用
-- ============================================================
