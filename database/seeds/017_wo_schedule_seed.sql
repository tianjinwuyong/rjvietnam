-- Seed 017: Work order scheduling dates (for alert demo)
-- Sets due_date for existing work orders by status

UPDATE work_orders SET due_date = CURRENT_DATE + INTERVAL '14 days' WHERE status = 'draft';
UPDATE work_orders SET due_date = CURRENT_DATE + INTERVAL '7 days'  WHERE status = 'released' AND due_date IS NULL;
UPDATE work_orders SET due_date = CURRENT_DATE + INTERVAL '3 days'  WHERE status = 'running' AND due_date IS NULL;
UPDATE work_orders SET due_date = CURRENT_DATE - INTERVAL '1 day'   WHERE status = 'hold' AND due_date IS NULL;
UPDATE work_orders SET planned_start_date = CURRENT_DATE WHERE status IN ('draft', 'released');
