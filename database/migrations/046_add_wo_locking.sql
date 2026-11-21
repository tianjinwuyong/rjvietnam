-- Migration: Add WO locking for PDA material loading
-- Prevents multiple PDAs from working on the same work order simultaneously

ALTER TABLE work_orders
  ADD COLUMN locked_by VARCHAR(50),
  ADD COLUMN locked_at TIMESTAMPTZ;

CREATE INDEX idx_work_orders_lock ON work_orders(locked_by) WHERE locked_by IS NOT NULL;
