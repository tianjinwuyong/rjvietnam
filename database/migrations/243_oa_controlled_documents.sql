CREATE TABLE IF NOT EXISTS oa_controlled_documents (
  id bigserial PRIMARY KEY,
  document_no varchar(80) NOT NULL,
  title varchar(240) NOT NULL,
  category varchar(80) NOT NULL,
  source_type varchar(30) NOT NULL DEFAULT 'INTERNAL',
  source_url text,
  license_status varchar(30) NOT NULL DEFAULT 'INTERNAL',
  version_no varchar(40) NOT NULL,
  file_name varchar(260) NOT NULL,
  mime_type varchar(120) NOT NULL,
  file_size bigint NOT NULL,
  checksum_sha256 varchar(64) NOT NULL,
  file_content bytea NOT NULL,
  applicable_employees jsonb NOT NULL DEFAULT '[]'::jsonb,
  status varchar(30) NOT NULL DEFAULT 'DRAFT',
  current_step integer NOT NULL DEFAULT 0,
  total_steps integer NOT NULL DEFAULT 0,
  effective_from date,
  review_due_at date,
  notes text,
  created_by varchar(120) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  voided_at timestamptz,
  UNIQUE(document_no, version_no),
  CHECK (status IN ('DRAFT','PENDING_APPROVAL','APPROVED','PUBLISHED','REJECTED','SUPERSEDED','VOIDED')),
  CHECK (source_type IN ('INTERNAL','EXTERNAL_STANDARD','REGULATION','CUSTOMER','SUPPLIER')),
  CHECK (license_status IN ('INTERNAL','PUBLIC','LICENSE_REQUIRED','LICENSED','LINK_ONLY'))
);

CREATE TABLE IF NOT EXISTS oa_document_approval_steps (
  id bigserial PRIMARY KEY,
  document_id bigint NOT NULL REFERENCES oa_controlled_documents(id),
  step_no integer NOT NULL,
  step_name varchar(120) NOT NULL,
  approver_role varchar(100) NOT NULL,
  required boolean NOT NULL DEFAULT true,
  status varchar(30) NOT NULL DEFAULT 'WAITING',
  sla_hours integer NOT NULL DEFAULT 24,
  started_at timestamptz,
  due_at timestamptz,
  reminder_count integer NOT NULL DEFAULT 0,
  last_reminded_at timestamptz,
  escalated_at timestamptz,
  escalation_role varchar(100),
  decided_by varchar(120),
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(document_id, step_no),
  CHECK (status IN ('WAITING','PENDING','APPROVED','REJECTED','SKIPPED','OVERDUE')),
  CHECK (sla_hours > 0)
);

CREATE TABLE IF NOT EXISTS oa_document_route_templates (
  id bigserial PRIMARY KEY,
  route_code varchar(80) NOT NULL UNIQUE,
  document_category varchar(80) NOT NULL UNIQUE,
  route_name varchar(180) NOT NULL,
  steps jsonb NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO oa_document_route_templates(route_code,document_category,route_name,steps) VALUES
('OA-ROUTE-PROC-01','PROCUREMENT','采购与合同审批','[{"name":"采购主管审核","role":"purchasing_supervisor","slaHours":8},{"name":"财务审核","role":"finance_manager","slaHours":16},{"name":"厂长批准","role":"plant_director","slaHours":24},{"name":"文控外发检查","role":"oa_document_controller","slaHours":4}]'),
('OA-ROUTE-WMS-01','WMS','WMS 与库存作业文件审批','[{"name":"仓库主管审核","role":"warehouse_manager","slaHours":8},{"name":"质量审核","role":"quality_manager","slaHours":16},{"name":"运营批准","role":"operations_manager","slaHours":24},{"name":"文控发布检查","role":"oa_document_controller","slaHours":4}]'),
('OA-ROUTE-QUALITY-01','QUALITY','IQC、SMT 与质量标准审批','[{"name":"质量工程师审核","role":"quality_engineer","slaHours":8},{"name":"质量经理审核","role":"quality_manager","slaHours":16},{"name":"厂长批准","role":"plant_director","slaHours":24},{"name":"文控发布检查","role":"oa_document_controller","slaHours":4}]'),
('OA-ROUTE-EHS-01','EHS','EHS 与法规文件审批','[{"name":"EHS 主管审核","role":"ehs_manager","slaHours":8},{"name":"合规审核","role":"compliance_manager","slaHours":16},{"name":"厂长批准","role":"plant_director","slaHours":24},{"name":"文控外发检查","role":"oa_document_controller","slaHours":4}]'),
('OA-ROUTE-FIN-01','FINANCE','财务与税务制度审批','[{"name":"财务经理审核","role":"finance_manager","slaHours":8},{"name":"法务/合规审核","role":"compliance_manager","slaHours":16},{"name":"厂长批准","role":"plant_director","slaHours":24},{"name":"文控发布检查","role":"oa_document_controller","slaHours":4}]'),
('OA-ROUTE-HR-01','HR','人力资源制度审批','[{"name":"HR 主管审核","role":"hr_manager","slaHours":8},{"name":"合规审核","role":"compliance_manager","slaHours":16},{"name":"厂长批准","role":"plant_director","slaHours":24},{"name":"文控发布检查","role":"oa_document_controller","slaHours":4}]'),
('OA-ROUTE-AI-01','AI_GOVERNANCE','虚拟员工行为规则审批','[{"name":"流程责任人审核","role":"process_owner","slaHours":8},{"name":"IT/安全审核","role":"security_manager","slaHours":16},{"name":"厂长批准","role":"plant_director","slaHours":24},{"name":"文控发布检查","role":"oa_document_controller","slaHours":4}]'),
('OA-ROUTE-GENERAL-01','GENERAL','通用受控文件审批','[{"name":"部门负责人审核","role":"department_manager","slaHours":8},{"name":"流程责任人审核","role":"process_owner","slaHours":16},{"name":"质量/合规审核","role":"compliance_manager","slaHours":24},{"name":"文控发布检查","role":"oa_document_controller","slaHours":4}]')
ON CONFLICT(route_code) DO UPDATE SET route_name=EXCLUDED.route_name,steps=EXCLUDED.steps,active=true,updated_at=now();

CREATE TABLE IF NOT EXISTS oa_document_audit_events (
  id bigserial PRIMARY KEY,
  document_id bigint NOT NULL REFERENCES oa_controlled_documents(id),
  action varchar(50) NOT NULL,
  actor varchar(120) NOT NULL,
  from_status varchar(30),
  to_status varchar(30),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS oa_document_notifications (
  id bigserial PRIMARY KEY,
  document_id bigint NOT NULL REFERENCES oa_controlled_documents(id),
  approval_step_id bigint REFERENCES oa_document_approval_steps(id),
  notification_type varchar(40) NOT NULL,
  severity varchar(20) NOT NULL,
  recipient_role varchar(100) NOT NULL,
  recipient_user_id bigint REFERENCES users(id),
  channel varchar(30) NOT NULL,
  subject varchar(240) NOT NULL,
  message text NOT NULL,
  delivery_status varchar(30) NOT NULL DEFAULT 'PENDING',
  attempt_count integer NOT NULL DEFAULT 0,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (severity IN ('INFO','WARNING','CRITICAL')),
  CHECK (delivery_status IN ('PENDING','SENT','FAILED','NOT_CONFIGURED'))
);

CREATE TABLE IF NOT EXISTS oa_document_distributions (
  id bigserial PRIMARY KEY,
  document_id bigint NOT NULL REFERENCES oa_controlled_documents(id),
  recipient_type varchar(30) NOT NULL,
  recipient_ref varchar(120) NOT NULL,
  channel varchar(30) NOT NULL,
  status varchar(30) NOT NULL DEFAULT 'PENDING',
  distributed_at timestamptz,
  acknowledged_at timestamptz,
  acknowledged_by varchar(120),
  delivery_detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(document_id, recipient_type, recipient_ref, channel),
  CHECK (status IN ('PENDING','DELIVERED','ACKNOWLEDGED','FAILED','NOT_CONFIGURED'))
);

CREATE TABLE IF NOT EXISTS oa_document_evidence_files (
  id bigserial PRIMARY KEY,
  document_id bigint NOT NULL REFERENCES oa_controlled_documents(id),
  approval_step_id bigint REFERENCES oa_document_approval_steps(id),
  evidence_type varchar(40) NOT NULL,
  file_name varchar(260) NOT NULL,
  mime_type varchar(120) NOT NULL,
  file_size bigint NOT NULL,
  checksum_sha256 varchar(64) NOT NULL,
  file_content bytea NOT NULL,
  notes text,
  captured_at timestamptz,
  uploaded_by varchar(120) NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  status varchar(20) NOT NULL DEFAULT 'ACTIVE',
  CHECK (status IN ('ACTIVE','VOIDED'))
);

CREATE INDEX IF NOT EXISTS idx_oa_documents_status ON oa_controlled_documents(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_oa_documents_category ON oa_controlled_documents(category, document_no);
CREATE INDEX IF NOT EXISTS idx_oa_document_steps_queue ON oa_document_approval_steps(status, approver_role, step_no);
CREATE INDEX IF NOT EXISTS idx_oa_document_audit_document ON oa_document_audit_events(document_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_oa_document_notifications_delivery ON oa_document_notifications(delivery_status, created_at);
CREATE INDEX IF NOT EXISTS idx_oa_document_distributions_status ON oa_document_distributions(status, created_at);
CREATE INDEX IF NOT EXISTS idx_oa_document_evidence_document ON oa_document_evidence_files(document_id, approval_step_id, uploaded_at DESC);
