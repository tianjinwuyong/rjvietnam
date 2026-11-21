-- Virtual-employee reporting system (编制 / KPI / 四力 / 审批吞吐).
-- Everything here is derived from existing runtime tables; no new write path
-- for business data. Source of truth for the roster remains registry.js;
-- ve_reporting_lines is the relational mirror used by reports and gates.

CREATE TABLE IF NOT EXISTS ve_reporting_lines (
  employee_id   VARCHAR(80) PRIMARY KEY,
  name_zh       VARCHAR(120) NOT NULL,
  department    VARCHAR(8) NOT NULL,
  reports_to    VARCHAR(80),
  owns_loop     VARCHAR(120),
  staffing      VARCHAR(8) NOT NULL CHECK (staffing IN ('指挥','主管','专职','占位')),
  enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE ve_reporting_lines IS
  'Mirror of FACTORY_VIRTUAL_EMPLOYEES reporting lines. HUMAN is the only non-virtual parent.';

INSERT INTO ve_reporting_lines(employee_id, name_zh, department, reports_to, owns_loop, staffing, enabled) VALUES
('OPS-SUPERVISOR-VIRTUAL-01','全厂运营虚拟总监','CMD','HUMAN','派工与仲裁','指挥',TRUE),

('WMS-SUPERVISOR-VIRTUAL-01','来料与仓储主管','D1','OPS-SUPERVISOR-VIRTUAL-01',NULL,'主管',TRUE),
('WMS-RECEIVING-VIRTUAL-01','收料核验','D1','WMS-SUPERVISOR-VIRTUAL-01','收料核验','专职',TRUE),
('WMS-IQC-HANDOFF-VIRTUAL-01','来料交接','D1','WMS-SUPERVISOR-VIRTUAL-01','来料交接','专职',TRUE),
('WMS-INVENTORY-VIRTUAL-01','上架与库位','D1','WMS-SUPERVISOR-VIRTUAL-01','上架与库位','专职',TRUE),
('WMS-COUNT-VIRTUAL-01','循环盘点','D1','WMS-SUPERVISOR-VIRTUAL-01','循环盘点','专职',TRUE),
('WMS-ISSUE-VIRTUAL-01','发料与线边配送','D1','WMS-SUPERVISOR-VIRTUAL-01','发料与配送','专职',TRUE),
('MSD-CONTROL-VIRTUAL-01','湿敏管控','D1','WMS-SUPERVISOR-VIRTUAL-01','湿敏管控','专职',TRUE),

('PMC-VIRTUAL-01','计划与采购主管','D2','OPS-SUPERVISOR-VIRTUAL-01','MPS/MRP','主管',TRUE),
('PURCHASING-VIRTUAL-01','PO·ASN·ETA 跟单','D2','PMC-VIRTUAL-01','PO 跟单','专职',TRUE),
('SUPPLIER-COLLAB-VIRTUAL-01','供应商协同与退货','D2','PMC-VIRTUAL-01','门户协同','专职',TRUE),
('SUPPLIER-CLAIM-VIRTUAL-01','退货与索赔','D2','PMC-VIRTUAL-01','退货索赔','占位',FALSE),

('MES-VIRTUAL-01','制造执行主管','D3','OPS-SUPERVISOR-VIRTUAL-01','工单·路线·过站','主管',TRUE),
('SMT-LOOP-VIRTUAL-01','SMT 上料与料盘消耗','D3','MES-VIRTUAL-01','上料消耗','专职',TRUE),
('ANDON-VIRTUAL-01','安灯与换线','D3','MES-VIRTUAL-01','安灯升级','专职',TRUE),
('PACK-VIRTUAL-01','包装与出货','D3','MES-VIRTUAL-01','包装出货','专职',TRUE),
('LINE-CADENCE-VIRTUAL-01','自动线与手动线节拍','D3','MES-VIRTUAL-01','线体节拍','占位',FALSE),

('QUALITY-VIRTUAL-01','品质主管','D4','OPS-SUPERVISOR-VIRTUAL-01','NCR/CAPA/MRB','主管',TRUE),
('IQC-VIRTUAL-01','来料检验','D4','QUALITY-VIRTUAL-01','IQC 判定','专职',TRUE),
('OQC-VIRTUAL-01','出货检验','D4','QUALITY-VIRTUAL-01','OQC/AQL','专职',TRUE),
('TRACE-VIRTUAL-01','追溯与 ECN','D4','QUALITY-VIRTUAL-01','追溯召回','专职',TRUE),
('MRB-VIRTUAL-01','报废评审','D4','QUALITY-VIRTUAL-01','MRB 评审','占位',FALSE),

('MAINTENANCE-VIRTUAL-01','设备与工程主管','D5','OPS-SUPERVISOR-VIRTUAL-01','PM 与备件','主管',TRUE),
('STATION-EQUIP-VIRTUAL-01','站机群','D5','MAINTENANCE-VIRTUAL-01','站机一致性','专职',TRUE),
('REPAIR-VIRTUAL-01','维修与返工','D5','MAINTENANCE-VIRTUAL-01','返工处置','专职',TRUE),
('SPARE-PARTS-VIRTUAL-01','备件','D5','MAINTENANCE-VIRTUAL-01','备件','占位',FALSE),

('FINANCE-VIRTUAL-01','商务与财务主管','D6','OPS-SUPERVISOR-VIRTUAL-01','三单匹配与欠款','主管',TRUE),
('SALES-VIRTUAL-01','销售订单与交期','D6','FINANCE-VIRTUAL-01','交期回复','专职',TRUE),
('E-INVOICE-VIRTUAL-01','电子发票','D6','FINANCE-VIRTUAL-01','开票合规','专职',TRUE),
('SUPPLIER-DEBT-VIRTUAL-01','供应商欠款','D6','FINANCE-VIRTUAL-01','欠款账龄','占位',FALSE),

('HR-VIRTUAL-01','行政与人事主管','D7','OPS-SUPERVISOR-VIRTUAL-01','主数据与考勤','主管',TRUE),
('OA-DOCUMENT-CONTROL-VIRTUAL-01','文控协调','D7','HR-VIRTUAL-01','审批包协调','专职',TRUE),
('SAFETY-VIRTUAL-01','安全','D7','HR-VIRTUAL-01','隐患闭环','专职',TRUE),

('APP-OPS-VIRTUAL-01','平台与 IT 主管','D8','OPS-SUPERVISOR-VIRTUAL-01','应用运维','主管',TRUE),
('INFRA-VIRTUAL-01','基础设施','D8','APP-OPS-VIRTUAL-01','主机与网络','专职',TRUE),
('DATABASE-VIRTUAL-01','数据库','D8','APP-OPS-VIRTUAL-01','模式与迁移','专职',TRUE),
('INTEGRATION-VIRTUAL-01','系统集成与数据质量','D8','APP-OPS-VIRTUAL-01','契约与比对','专职',TRUE),
('SECURITY-VIRTUAL-01','账号与密钥安全','D8','APP-OPS-VIRTUAL-01','访问审计','专职',TRUE),
('PDA-FLEET-VIRTUAL-01','PDA 设备群','D8','APP-OPS-VIRTUAL-01','设备心跳','专职',TRUE),
('BACKUP-VIRTUAL-01','备份与恢复','D8','APP-OPS-VIRTUAL-01','备份校验','专职',TRUE),
('RELEASE-VIRTUAL-01','发布与 UI 回归','D8','APP-OPS-VIRTUAL-01','发布判定','专职',TRUE),
('REPORTS-VIRTUAL-01','指标与看板','D8','APP-OPS-VIRTUAL-01','指标字典','专职',TRUE),
('DATA-QUALITY-VIRTUAL-01','数据质量','D8','APP-OPS-VIRTUAL-01','数据体检','占位',FALSE),
('UI-DESIGN-QA-VIRTUAL-01','UI 设计与测试','D8','APP-OPS-VIRTUAL-01','UI 回归','占位',FALSE)
ON CONFLICT (employee_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS ve_kpi_daily (
  employee_id                  VARCHAR(80) NOT NULL,
  day                          DATE NOT NULL,
  tasks_created                INTEGER NOT NULL DEFAULT 0,
  tasks_completed              INTEGER NOT NULL DEFAULT 0,
  tasks_rejected               INTEGER NOT NULL DEFAULT 0,
  tasks_rework                 INTEGER NOT NULL DEFAULT 0,
  awaiting_approval            INTEGER NOT NULL DEFAULT 0,
  approval_granted             INTEGER NOT NULL DEFAULT 0,
  approval_denied              INTEGER NOT NULL DEFAULT 0,
  approval_wait_p50_ms         BIGINT,
  approval_wait_p90_ms         BIGINT,
  events                       INTEGER NOT NULL DEFAULT 0,
  training_cases               INTEGER NOT NULL DEFAULT 0,
  training_runs_passed         INTEGER NOT NULL DEFAULT 0,
  evaluations                  INTEGER NOT NULL DEFAULT 0,
  computed_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (employee_id, day)
);

CREATE TABLE IF NOT EXISTS ve_competency_snapshots (
  id             BIGSERIAL PRIMARY KEY,
  employee_id    VARCHAR(80) NOT NULL,
  period_start   DATE NOT NULL,
  period_end     DATE NOT NULL,
  force          VARCHAR(24) NOT NULL CHECK (force IN ('SELF_LEARNING','KNOWLEDGE_ACCUMULATION','SMART_JUDGMENT','LOGICAL_REASONING')),
  level          INTEGER NOT NULL CHECK (level BETWEEN 0 AND 4),
  metric         JSONB NOT NULL DEFAULT '{}'::jsonb,
  evidence       JSONB NOT NULL DEFAULT '{}'::jsonb,
  assessed_by    VARCHAR(120) NOT NULL,
  assessed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (employee_id, period_start, period_end, force)
);

CREATE OR REPLACE VIEW ve_v_roster AS
SELECT l.employee_id, l.name_zh, l.department, l.reports_to, p.name_zh AS reports_to_name,
       l.staffing, l.owns_loop, l.enabled,
       CASE WHEN l.reports_to = 'HUMAN' THEN 'HUMAN' ELSE p.staffing END AS parent_staffing
FROM ve_reporting_lines l
LEFT JOIN ve_reporting_lines p ON p.employee_id = l.reports_to;

CREATE OR REPLACE VIEW ve_v_line_integrity AS
SELECT l.employee_id, l.reports_to,
       CASE
         WHEN l.reports_to IS NULL THEN 'NO_PARENT'
         WHEN l.employee_id = l.reports_to THEN 'SELF_LOOP'
         WHEN l.reports_to = 'HUMAN' AND l.staffing <> '指挥' THEN 'NON_VIRTUAL_PARENT'
         WHEN l.reports_to <> 'HUMAN' AND p.employee_id IS NULL THEN 'DANGLING_PARENT'
         WHEN l.reports_to <> 'HUMAN' AND p.staffing NOT IN ('主管','指挥') THEN 'PARENT_NOT_SUPERVISOR'
         ELSE 'OK'
       END AS verdict
FROM ve_reporting_lines l
LEFT JOIN ve_reporting_lines p ON p.employee_id = l.reports_to
WHERE l.enabled;

CREATE OR REPLACE VIEW ve_v_department_load AS
SELECT l.department,
       COUNT(*) FILTER (WHERE l.enabled) AS enabled_positions,
       COUNT(*) FILTER (WHERE NOT l.enabled) AS placeholders,
       COUNT(*) FILTER (WHERE l.enabled AND l.staffing = '主管') AS supervisors,
       COALESCE(SUM(x.tasks_7d), 0)::BIGINT AS tasks_7d
FROM ve_reporting_lines l
LEFT JOIN (
  SELECT employee_id, COUNT(*) AS tasks_7d
  FROM factory_virtual_employee_tasks
  WHERE created_at >= NOW() - INTERVAL '7 days'
  GROUP BY employee_id
) x ON x.employee_id = l.employee_id
WHERE l.enabled
GROUP BY l.department;

CREATE OR REPLACE VIEW ve_v_approval_throughput AS
SELECT date_trunc('day', t.created_at)::DATE AS day,
       t.human_gate,
       t.employee_id,
       COUNT(*) FILTER (WHERE t.requires_human) AS gated_tasks,
       COUNT(*) FILTER (WHERE t.approved_by IS NOT NULL) AS approved,
       COUNT(*) FILTER (WHERE t.status IN ('REJECTED','WAITING_APPROVAL')) AS blocked,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (t.completed_at - t.created_at)) * 1000)
         FILTER (WHERE t.approved_by IS NOT NULL AND t.completed_at IS NOT NULL)::BIGINT AS p50_wait_ms,
       percentile_cont(0.9) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (t.completed_at - t.created_at)) * 1000)
         FILTER (WHERE t.approved_by IS NOT NULL AND t.completed_at IS NOT NULL)::BIGINT AS p90_wait_ms
FROM factory_virtual_employee_tasks t
GROUP BY 1, 2, 3;

CREATE OR REPLACE VIEW ve_v_kpi_latest AS
SELECT DISTINCT ON (employee_id) employee_id, day, tasks_created, tasks_completed,
       tasks_rejected, tasks_rework, awaiting_approval, approval_granted, approval_denied,
       approval_wait_p50_ms, approval_wait_p90_ms, events, training_cases,
       training_runs_passed, evaluations, computed_at
FROM ve_kpi_daily
ORDER BY employee_id, day DESC;

CREATE OR REPLACE VIEW ve_v_competency_matrix AS
SELECT l.employee_id, l.department, l.staffing,
       COUNT(c.force) AS forces_assessed,
       MIN(c.level) AS min_level,
       MAX(c.assessed_at) AS last_assessed_at
FROM ve_reporting_lines l
LEFT JOIN ve_competency_snapshots c ON c.employee_id = l.employee_id
WHERE l.enabled
GROUP BY l.employee_id, l.department, l.staffing;

CREATE OR REPLACE VIEW ve_v_coverage AS
SELECT l.employee_id, l.name_zh, l.department, l.staffing, l.enabled,
       (SELECT COUNT(*) FROM factory_virtual_employee_tasks t WHERE t.employee_id = l.employee_id) AS tasks,
       (SELECT COUNT(*) FROM factory_virtual_employee_events e WHERE e.employee_id = l.employee_id) AS events,
       (SELECT COUNT(*) FROM factory_virtual_employee_training_cases c WHERE c.employee_id = l.employee_id) AS training_cases,
       (SELECT COUNT(*) FROM factory_virtual_employee_evaluations v WHERE v.employee_id = l.employee_id) AS evaluations
FROM ve_reporting_lines l;

CREATE OR REPLACE VIEW ve_v_report_catalog AS
SELECT * FROM (VALUES
  ('roster'::TEXT, '在岗花名册与汇报线'::TEXT, '实时'::TEXT, '厂长 / 主管'::TEXT, 've_v_roster'::TEXT),
  ('integrity'::TEXT, '汇报线完整性'::TEXT, '实时', '厂长 / 发布门', 've_v_line_integrity'),
  ('load'::TEXT, '部门负载'::TEXT, '每日', '总监 / 主管', 've_v_department_load'),
  ('throughput'::TEXT, '人工审批吞吐'::TEXT, '每日', '厂长 / 班组长', 've_v_approval_throughput'),
  ('competency'::TEXT, '四力档案矩阵'::TEXT, '每周期', '厂长 / 人事', 've_v_competency_matrix'),
  ('coverage'::TEXT, '岗位落地覆盖'::TEXT, '每周', '总监 / 平台主管', 've_v_coverage'),
  ('kpi'::TEXT, '岗位日指标'::TEXT, '每日', '主管 / 岗位本人', 've_v_kpi_latest')
) AS v(report_id, title, cadence, audience, source_view);
