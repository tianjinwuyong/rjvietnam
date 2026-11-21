-- Add bom_id to work_orders for BOM version binding at WO creation time
-- Frontend (PmcCreateWorkOrder.tsx) already sends bomId when creating a WO.
-- This column enables: material readiness calculation, BOM diff at WO release, traceability.

ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS bom_id bigint REFERENCES boms(id);

CREATE INDEX IF NOT EXISTS idx_work_orders_bom_id ON work_orders(bom_id);