-- Migration 027: WO priority, work hours tracking, and WO change log
-- Priority: 1=Critical, 2=High, 3=Normal, 4=Low
-- Standard work hours per board, for labor cost estimation

ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS priority SMALLINT DEFAULT 3, -- 1=Critical, 2=High, 3=Normal, 4=Low
  ADD COLUMN IF NOT EXISTS standard_hour_per_board NUMERIC(10,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS actual_man_hours NUMERIC(10,2) DEFAULT 0;

COMMENT ON COLUMN work_orders.priority IS '1=Critical, 2=High, 3=Normal, 4=Low';
COMMENT ON COLUMN work_orders.standard_hour_per_board IS '标准工时(小时/片)';
COMMENT ON COLUMN work_orders.actual_man_hours IS '实际工时(人时)';

-- WO change log for freeze/变更 audit trail
CREATE TABLE IF NOT EXISTS work_order_change_log (
  id BIGSERIAL PRIMARY KEY,
  work_order_id BIGINT NOT NULL REFERENCES work_orders(id),
  changed_by BIGINT REFERENCES users(id),
  changed_at TIMESTAMPTZ DEFAULT NOW(),
  field_name VARCHAR(64) NOT NULL,
  old_value TEXT,
  new_value TEXT,
  reason VARCHAR(255)
);

CREATE INDEX IF NOT EXISTS idx_wo_change_log_wo ON work_order_change_log(work_order_id);

-- Set demo priorities
UPDATE work_orders SET priority = 1 WHERE status = 'running' AND due_date < CURRENT_DATE + INTERVAL '3 days';
UPDATE work_orders SET priority = 2 WHERE status = 'released';
