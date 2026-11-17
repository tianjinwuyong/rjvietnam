-- Migration 026: Add scheduling fields to work_orders for alert system
-- Adds: due_date, planned_start_date, alert_level, notes

ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS due_date DATE,
  ADD COLUMN IF NOT EXISTS planned_start_date DATE,
  ADD COLUMN IF NOT EXISTS alert_level VARCHAR(20) DEFAULT NULL; -- overdue, delay, material_risk, normal

COMMENT ON COLUMN work_orders.due_date IS '计划完成日期 / Planned completion date';
COMMENT ON COLUMN work_orders.planned_start_date IS '计划开始日期 / Planned start date';
COMMENT ON COLUMN work_orders.alert_level IS 'Alert level: overdue, delay, material_risk, normal';

-- Populate due_date from customer_po for existing work orders (backfill)
UPDATE work_orders wo
SET due_date = po.due_date::date
FROM customer_pos po
WHERE wo.customer_po_id = po.id
  AND wo.due_date IS NULL;

-- Seed demo due_dates for remaining work orders without PO link
UPDATE work_orders SET due_date = CURRENT_DATE + INTERVAL '7 days'  WHERE due_date IS NULL AND status IN ('draft', 'released');
UPDATE work_orders SET due_date = CURRENT_DATE + INTERVAL '3 days'  WHERE due_date IS NULL AND status = 'running';
UPDATE work_orders SET due_date = CURRENT_DATE - INTERVAL '2 days'  WHERE due_date IS NULL AND status = 'hold';

-- Index for alert queries
CREATE INDEX IF NOT EXISTS idx_work_orders_due_date ON work_orders(due_date) WHERE due_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_work_orders_alert_level ON work_orders(alert_level) WHERE alert_level IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_work_orders_status ON work_orders(status);
