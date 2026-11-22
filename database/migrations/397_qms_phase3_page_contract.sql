-- =============================================================================
-- 396: QMS Phase-3 页面契约补齐（文件/审核/客诉/供应商评价/质量成本）
-- =============================================================================
-- 背景：server.js 的 QMS Phase 3 块是从 MySQL 参考系统直译的，列名与 203 的
-- Postgres schema 对不上（documents/audits/complaints/supplier-evaluations/
-- quality-costs 全部 500）。表当前均为空；五个页面（QmsDocuments/QmsAudits/
-- QmsComplaints/QmsSupplierEval/QmsQualityCosts.tsx）的字段契约是唯一消费方。
-- 本迁移按页面契约补齐缺失列，其余差异（title/doc_title、cost_type/cost_category
-- 等）由 SELECT 别名映射，不改既有列名、不删列。全部 IF NOT EXISTS，可重复执行。

BEGIN;

-- ISO 文件：页面显示 uploader_name（旧代码 join uploaded_by）；203 没有作者 id 列。
-- approved_by 是 VARCHAR(100)，新代码写入 user id 的文本形式，读取时正则守卫再转 bigint。
ALTER TABLE qms_documents
  ADD COLUMN IF NOT EXISTS uploaded_by  BIGINT,
  ADD COLUMN IF NOT EXISTS approved_at  TIMESTAMPTZ;

-- 审核：页面显示 assignee_name；203 只有 lead_auditor（文本）。auditor 以
-- display_name 存于 lead_auditor，assignee 用新列 + join。
ALTER TABLE qms_audits
  ADD COLUMN IF NOT EXISTS auditor_id    BIGINT,
  ADD COLUMN IF NOT EXISTS assignee_id   BIGINT,
  ADD COLUMN IF NOT EXISTS started_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at  TIMESTAMPTZ;

-- 审核不符合项（页面叫 findings，表是 qms_audit_nc）：记录提出人。
-- 页面的 description/category/resolution 由 finding/clause/corrective_action 别名映射。
ALTER TABLE qms_audit_nc
  ADD COLUMN IF NOT EXISTS raised_by  BIGINT;

-- 客诉：页面需要 root_cause/corrective_action/preventive_action（8D 之外的快速
-- 闭环字段）、defect_images、created_by（页面显示 creator_name）。
-- 页面的 priority 复用 severity 列（critical/major/minor），不另加列。
ALTER TABLE qms_complaints
  ADD COLUMN IF NOT EXISTS root_cause         TEXT,
  ADD COLUMN IF NOT EXISTS corrective_action  TEXT,
  ADD COLUMN IF NOT EXISTS preventive_action  TEXT,
  ADD COLUMN IF NOT EXISTS defect_images      TEXT,
  ADD COLUMN IF NOT EXISTS created_by         BIGINT;

-- 客诉回复：旧代码引用了这张表但 203 从未建表（GET/PUT responses 必 500）。
CREATE TABLE IF NOT EXISTS qms_complaint_responses (
    id              BIGSERIAL PRIMARY KEY,
    complaint_id    BIGINT       NOT NULL REFERENCES qms_complaints(id) ON DELETE CASCADE,
    respondent_id   BIGINT,
    response_text   TEXT         NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_qcr_complaint ON qms_complaint_responses(complaint_id, created_at);

-- 供应商评价：页面按 supplier_id + 四维评分 + overall_score 工作；203 只有
-- supplier_code + iqc/oqc/delivery 比率。补页面契约列；旧列保留，新行两边都写。
ALTER TABLE qms_supplier_eval
  ADD COLUMN IF NOT EXISTS supplier_id          BIGINT,
  ADD COLUMN IF NOT EXISTS supplier_name        VARCHAR(200),
  ADD COLUMN IF NOT EXISTS evaluation_date      DATE,
  ADD COLUMN IF NOT EXISTS quality_score        NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS delivery_score       NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS service_score        NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS communication_score  NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS overall_score        NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS remarks              TEXT,
  ADD COLUMN IF NOT EXISTS evaluated_by         BIGINT;
CREATE INDEX IF NOT EXISTS idx_qse_supplier_date ON qms_supplier_eval(supplier_id, evaluation_date DESC);

-- 质量成本：页面按 cost_date 过滤/排序、按 recorder_name 显示、按 cost_type
-- （prevention/appraisal/…）分组 —— 那个值实际落在 203 的 cost_category 列，
-- 由查询别名映射；这里只补日期与记录人。
ALTER TABLE qms_quality_costs
  ADD COLUMN IF NOT EXISTS cost_date    DATE,
  ADD COLUMN IF NOT EXISTS recorded_by  BIGINT;

COMMIT;
