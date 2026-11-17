BEGIN;

-- Every active feeder binding is a separate material item.  Department
-- approval is therefore attached to the binding, not only to the loading
-- session, so one unsafe reel cannot be released with a safe neighbour.
CREATE TABLE IF NOT EXISTS smt_loading_item_approvals (
  id              bigserial PRIMARY KEY,
  binding_id      bigint NOT NULL REFERENCES feeder_binding_events(id) ON DELETE CASCADE,
  approval_code   varchar(40) NOT NULL,
  decision        varchar(20) NOT NULL DEFAULT 'PENDING'
                  CHECK (decision IN ('PENDING','APPROVED','REJECTED')),
  approver        varchar(120),
  reason          text,
  decided_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (binding_id, approval_code)
);

CREATE INDEX IF NOT EXISTS idx_smt_loading_item_approvals_binding
  ON smt_loading_item_approvals(binding_id, decision);

INSERT INTO permissions(code,name_zh,name_en,name_vi,category)
VALUES ('smt.loading.approve','审批SMT上料物料','Approve SMT loading material','Duyệt vật liệu nạp SMT','mes')
ON CONFLICT(code) DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id
FROM roles r CROSS JOIN permissions p
WHERE r.code = ANY(ARRAY['admin','management','plant_manager','factory_manager','pmc','quality','warehouse','engineering','engineering_manager','production','line_leader'])
  AND p.code='smt.loading.approve'
ON CONFLICT DO NOTHING;

INSERT INTO _migrations(filename, hash)
VALUES ('217_smt_loading_item_approvals.sql', 'manual-217-smt-loading-item-approvals')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
