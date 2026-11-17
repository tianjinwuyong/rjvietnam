-- Sales Order closed-loop extension.
-- Idempotent so it is safe to re-run regardless of prior partial application.

CREATE TABLE IF NOT EXISTS sales_order_status_history (
  id bigserial PRIMARY KEY,
  so_id bigint NOT NULL REFERENCES sales_orders(id),
  from_status varchar(32),
  to_status varchar(32) NOT NULL,
  actor varchar(64),
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_so_status_history_so ON sales_order_status_history(so_id);

-- Closed-loop timestamp columns on the existing sales_orders table.
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS released_at timestamptz;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS shipped_at timestamptz;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS delivered_at timestamptz;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS invoiced_at timestamptz;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS paid_at timestamptz;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS cancel_reason text;

-- Link columns so the closed loop is traceable from both sides.
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS sales_order_id bigint;
CREATE INDEX IF NOT EXISTS idx_work_orders_so ON work_orders(sales_order_id);

ALTER TABLE ar_invoices ADD COLUMN IF NOT EXISTS sales_order_id bigint;
CREATE INDEX IF NOT EXISTS idx_ar_invoices_so ON ar_invoices(sales_order_id);
