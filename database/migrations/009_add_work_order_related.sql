-- Add related_work_order_id for cross-process linking (rule 6.4)
ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS related_work_order_id BIGINT REFERENCES work_orders(id);

CREATE INDEX IF NOT EXISTS idx_work_orders_related_wo
  ON work_orders(related_work_order_id);
