-- Migration 079: Add shelf_placed_at to work_orders
-- A WO can only be placed to smart rack once
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS shelf_placed_at TIMESTAMPTZ;
