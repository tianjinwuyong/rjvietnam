BEGIN;

CREATE TABLE IF NOT EXISTS pmc_demands(
  id BIGSERIAL PRIMARY KEY,demand_no VARCHAR(48) NOT NULL UNIQUE,
  source_type VARCHAR(24) NOT NULL CHECK(source_type IN('SALES_ORDER','SAFETY_STOCK','FORECAST','REWORK','MANAGEMENT')),
  source_ref VARCHAR(80),product_id BIGINT NOT NULL REFERENCES products(id),required_qty INTEGER NOT NULL CHECK(required_qty>0),
  required_date DATE NOT NULL,priority_code VARCHAR(8) NOT NULL DEFAULT 'P2' CHECK(priority_code IN('P0','P1','P2','P3','P4')),
  reason TEXT NOT NULL,status VARCHAR(24) NOT NULL DEFAULT 'SUBMITTED' CHECK(status IN('SUBMITTED','UNDER_REVIEW','APPROVED','REJECTED','PLANNED','CLOSED','CANCELLED')),
  submitted_by VARCHAR(80) NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pmc_master_plans(
  id BIGSERIAL PRIMARY KEY,plan_no VARCHAR(48) NOT NULL UNIQUE,demand_id BIGINT NOT NULL REFERENCES pmc_demands(id) ON DELETE RESTRICT,
  product_id BIGINT NOT NULL REFERENCES products(id),planned_qty INTEGER NOT NULL CHECK(planned_qty>0),
  planned_start_at TIMESTAMPTZ NOT NULL,planned_finish_at TIMESTAMPTZ NOT NULL,line_id BIGINT REFERENCES production_lines(id),
  priority_score NUMERIC(8,2) NOT NULL DEFAULT 0,priority_code VARCHAR(8) NOT NULL DEFAULT 'P2',
  bom_id BIGINT REFERENCES boms(id),status VARCHAR(24) NOT NULL DEFAULT 'DRAFT' CHECK(status IN(
    'DRAFT','UNDER_REVIEW','APPROVED','WAITING_KIT','KIT_READY','RELEASED_TO_MES','RUNNING','WAITING_SETTLEMENT','CLOSED','REJECTED','CANCELLED'
  )),version_no INTEGER NOT NULL DEFAULT 1,created_by VARCHAR(80) NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pmc_plan_reviews(
  id BIGSERIAL PRIMARY KEY,plan_id BIGINT NOT NULL REFERENCES pmc_master_plans(id) ON DELETE RESTRICT,
  review_type VARCHAR(24) NOT NULL CHECK(review_type IN('CAPACITY','MATERIAL','BOM','QUALITY','COST','DELIVERY')),
  result VARCHAR(16) NOT NULL CHECK(result IN('PASS','WARNING','FAIL')),detail JSONB NOT NULL DEFAULT '{}',
  reviewed_by VARCHAR(80) NOT NULL,reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(plan_id,review_type)
);

CREATE TABLE IF NOT EXISTS pmc_plan_approvals(
  id BIGSERIAL PRIMARY KEY,plan_id BIGINT NOT NULL REFERENCES pmc_master_plans(id) ON DELETE RESTRICT,
  approval_role VARCHAR(32) NOT NULL,decision VARCHAR(16) NOT NULL CHECK(decision IN('APPROVE','REJECT')),
  actor VARCHAR(80) NOT NULL,comment TEXT NOT NULL,decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(plan_id,approval_role)
);

CREATE TABLE IF NOT EXISTS pmc_plan_work_orders(
  plan_id BIGINT NOT NULL REFERENCES pmc_master_plans(id) ON DELETE RESTRICT,
  work_order_id BIGINT NOT NULL UNIQUE REFERENCES work_orders(id) ON DELETE RESTRICT,
  bound_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(plan_id,work_order_id)
);

CREATE TABLE IF NOT EXISTS pmc_expedite_requests(
  id BIGSERIAL PRIMARY KEY,request_no VARCHAR(48) NOT NULL UNIQUE,plan_id BIGINT REFERENCES pmc_master_plans(id),
  product_id BIGINT NOT NULL REFERENCES products(id),requested_qty INTEGER NOT NULL CHECK(requested_qty>0),
  required_finish_at TIMESTAMPTZ NOT NULL,reason TEXT NOT NULL,evidence JSONB NOT NULL DEFAULT '[]',
  requested_line_id BIGINT REFERENCES production_lines(id),impact_snapshot JSONB NOT NULL DEFAULT '{}',
  required_approvals JSONB NOT NULL DEFAULT '[]',status VARCHAR(24) NOT NULL DEFAULT 'IMPACT_REVIEW' CHECK(status IN(
    'IMPACT_REVIEW','PENDING_APPROVAL','APPROVED','REJECTED','EXECUTING','COMPLETED','CANCELLED'
  )),requested_by VARCHAR(80) NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),approved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS pmc_expedite_approvals(
  id BIGSERIAL PRIMARY KEY,request_id BIGINT NOT NULL REFERENCES pmc_expedite_requests(id) ON DELETE RESTRICT,
  approval_role VARCHAR(32) NOT NULL,decision VARCHAR(16) NOT NULL CHECK(decision IN('APPROVE','REJECT')),
  actor VARCHAR(80) NOT NULL,comment TEXT NOT NULL,decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(request_id,approval_role)
);

CREATE TABLE IF NOT EXISTS pmc_schedule_impacts(
  id BIGSERIAL PRIMARY KEY,expedite_request_id BIGINT NOT NULL REFERENCES pmc_expedite_requests(id) ON DELETE RESTRICT,
  affected_plan_id BIGINT REFERENCES pmc_master_plans(id),affected_work_order_id BIGINT REFERENCES work_orders(id),
  old_start_at TIMESTAMPTZ,old_finish_at TIMESTAMPTZ,new_start_at TIMESTAMPTZ,new_finish_at TIMESTAMPTZ,
  delay_minutes INTEGER NOT NULL DEFAULT 0,customer_impact TEXT,cost_impact NUMERIC(14,2) NOT NULL DEFAULT 0,
  schedule_status VARCHAR(20) NOT NULL DEFAULT 'PROPOSED'
);

CREATE TABLE IF NOT EXISTS pmc_work_order_transfers(
  id BIGSERIAL PRIMARY KEY,transfer_no VARCHAR(48) NOT NULL UNIQUE,work_order_id BIGINT NOT NULL REFERENCES work_orders(id),
  from_line_id BIGINT NOT NULL REFERENCES production_lines(id),to_line_id BIGINT NOT NULL REFERENCES production_lines(id),
  reason TEXT NOT NULL,wip_qty INTEGER NOT NULL DEFAULT 0,ng_qty INTEGER NOT NULL DEFAULT 0,last_sn VARCHAR(100),
  handover_payload JSONB NOT NULL DEFAULT '{}',status VARCHAR(24) NOT NULL DEFAULT 'PENDING_APPROVAL' CHECK(status IN(
    'PENDING_APPROVAL','APPROVED','HANDED_OVER','RECEIVED','COMPLETED','REJECTED','CANCELLED'
  )),requested_by VARCHAR(80) NOT NULL,approved_by VARCHAR(80),handed_over_at TIMESTAMPTZ,received_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pmc_work_order_closure_checks(
  id BIGSERIAL PRIMARY KEY,work_order_id BIGINT NOT NULL REFERENCES work_orders(id) ON DELETE RESTRICT,
  check_type VARCHAR(32) NOT NULL,result VARCHAR(16) NOT NULL CHECK(result IN('PASS','WARNING','FAIL')),
  detail JSONB NOT NULL DEFAULT '{}',checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(work_order_id,check_type)
);

CREATE TABLE IF NOT EXISTS pmc_governance_audit(
  id BIGSERIAL PRIMARY KEY,event_key UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  entity_type VARCHAR(32) NOT NULL,entity_id BIGINT NOT NULL,event_type VARCHAR(40) NOT NULL,
  actor VARCHAR(80) NOT NULL,detail JSONB NOT NULL DEFAULT '{}',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pmc_demand_status ON pmc_demands(status,required_date);
CREATE INDEX IF NOT EXISTS idx_pmc_plan_status ON pmc_master_plans(status,planned_start_at);
CREATE INDEX IF NOT EXISTS idx_pmc_expedite_status ON pmc_expedite_requests(status,created_at);
CREATE INDEX IF NOT EXISTS idx_pmc_audit_entity ON pmc_governance_audit(entity_type,entity_id,created_at);

INSERT INTO _migrations(filename,hash) VALUES('189_pmc_closed_loop.sql','pmc-closed-loop-v1')
ON CONFLICT(filename) DO NOTHING;
COMMIT;
