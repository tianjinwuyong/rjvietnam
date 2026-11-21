CREATE TABLE IF NOT EXISTS oa_process_definitions (
  id bigserial PRIMARY KEY,
  process_code varchar(80) NOT NULL UNIQUE,
  process_name varchar(180) NOT NULL,
  entity_type varchar(80) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_by varchar(120),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS oa_process_signature_steps (
  id bigserial PRIMARY KEY,
  process_id bigint NOT NULL REFERENCES oa_process_definitions(id),
  step_no integer NOT NULL,
  signer_user_id bigint,
  signer_username varchar(120) NOT NULL,
  signer_name varchar(160),
  signer_role varchar(100),
  sla_hours integer NOT NULL DEFAULT 24 CHECK (sla_hours > 0),
  active boolean NOT NULL DEFAULT true,
  created_by varchar(120),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_oa_process_active_step
  ON oa_process_signature_steps(process_id, step_no) WHERE active=true;

CREATE TABLE IF NOT EXISTS oa_process_requests (
  id bigserial PRIMARY KEY,
  request_no varchar(80) NOT NULL UNIQUE,
  process_id bigint NOT NULL REFERENCES oa_process_definitions(id),
  entity_type varchar(80) NOT NULL,
  entity_id bigint NOT NULL,
  entity_no varchar(80) NOT NULL,
  title varchar(240) NOT NULL,
  requester_username varchar(120),
  requester_name varchar(160),
  status varchar(30) NOT NULL DEFAULT 'PENDING',
  current_step integer NOT NULL DEFAULT 1,
  total_steps integer NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(entity_type, entity_id),
  CHECK (status IN ('PENDING','APPROVED','REJECTED','CANCELLED'))
);

CREATE TABLE IF NOT EXISTS oa_process_request_steps (
  id bigserial PRIMARY KEY,
  request_id bigint NOT NULL REFERENCES oa_process_requests(id),
  step_no integer NOT NULL,
  signer_user_id bigint,
  signer_username varchar(120) NOT NULL,
  signer_name varchar(160),
  signer_role varchar(100),
  sla_hours integer NOT NULL,
  status varchar(30) NOT NULL DEFAULT 'WAITING',
  started_at timestamptz,
  due_at timestamptz,
  decided_by varchar(120),
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(request_id, step_no),
  CHECK (status IN ('WAITING','PENDING','APPROVED','REJECTED','SKIPPED','OVERDUE'))
);

CREATE TABLE IF NOT EXISTS oa_process_audit_events (
  id bigserial PRIMARY KEY,
  request_id bigint NOT NULL REFERENCES oa_process_requests(id),
  action varchar(50) NOT NULL,
  actor varchar(120) NOT NULL,
  from_status varchar(30),
  to_status varchar(30),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO oa_process_definitions(process_code,process_name,entity_type,created_by)
VALUES('WMS-MATERIAL-REQUISITION','物料取料审批','WMS_REQUISITION','SYSTEM')
ON CONFLICT(process_code) DO NOTHING;

INSERT INTO oa_process_signature_steps(process_id,step_no,signer_username,signer_name,signer_role,sla_hours,created_by)
SELECT p.id,1,'PMC_CN_01','PMC 审批人','pmc_manager',8,'SYSTEM'
FROM oa_process_definitions p WHERE p.process_code='WMS-MATERIAL-REQUISITION'
AND NOT EXISTS(SELECT 1 FROM oa_process_signature_steps s WHERE s.process_id=p.id AND s.active=true);

INSERT INTO _migrations(filename,hash) VALUES('245_oa_material_requisition_approval.sql','oa-material-requisition-approval-v1')
ON CONFLICT(filename) DO NOTHING;
