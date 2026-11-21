-- IQC NG scrap financial approval closed loop.
CREATE TABLE IF NOT EXISTS wms_iqc_scrap_finance_approvals (
  id BIGSERIAL PRIMARY KEY,
  approval_no VARCHAR(80) NOT NULL UNIQUE,
  defect_case_id BIGINT NOT NULL UNIQUE REFERENCES wms_iqc_defect_cases(id),
  status VARCHAR(32) NOT NULL DEFAULT 'PENDING_FINANCE_APPROVAL'
    CHECK (status IN ('PENDING_FINANCE_APPROVAL','FINANCE_APPROVED','FINANCE_REJECTED','SCRAP_EXECUTED')),
  scrap_qty NUMERIC(18,3) NOT NULL DEFAULT 0,
  unit_cost NUMERIC(18,4) NOT NULL DEFAULT 0,
  scrap_amount NUMERIC(18,4) NOT NULL DEFAULT 0,
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  reason TEXT,
  submitted_by VARCHAR(120) NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finance_approver VARCHAR(120),
  decision_note TEXT,
  decided_at TIMESTAMPTZ,
  executed_by VARCHAR(120),
  executed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wms_iqc_scrap_finance_status
  ON wms_iqc_scrap_finance_approvals(status, submitted_at DESC);

CREATE TABLE IF NOT EXISTS wms_iqc_scrap_finance_audit (
  id BIGSERIAL PRIMARY KEY,
  approval_id BIGINT NOT NULL REFERENCES wms_iqc_scrap_finance_approvals(id),
  action VARCHAR(40) NOT NULL,
  from_status VARCHAR(32),
  to_status VARCHAR(32),
  actor VARCHAR(120) NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wms_iqc_scrap_finance_audit_approval
  ON wms_iqc_scrap_finance_audit(approval_id, created_at);
