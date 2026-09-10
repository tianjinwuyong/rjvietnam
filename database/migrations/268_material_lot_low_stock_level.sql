-- 268: per-lot low-stock warning level on material_lots.
-- Clicking the stock-qty cell in the material master sets this value;
-- lots whose derived on-hand falls below it flash red as a warning.

ALTER TABLE material_lots
  ADD COLUMN IF NOT EXISTS low_stock_level NUMERIC(18,4) NOT NULL DEFAULT 0;
