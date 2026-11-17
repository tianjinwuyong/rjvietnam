-- 235: widen sales_orders status check to the closed-loop status machine
-- The sales module's closed-loop transitions use:
--   open → confirmed → released → in_production → ready_to_ship → shipped
--        → delivered → invoiced → paid → closed  (cancelled from open/confirmed/released)
-- The original check constraint only allowed open/partially_fulfilled/fulfilled/closed/cancelled,
-- so confirming (status='confirmed') failed with "violates check constraint sales_orders_status_check".
ALTER TABLE sales_orders DROP CONSTRAINT IF EXISTS sales_orders_status_check;
ALTER TABLE sales_orders ADD CONSTRAINT sales_orders_status_check
  CHECK (status IN (
    'open', 'confirmed', 'released', 'in_production', 'ready_to_ship',
    'shipped', 'delivered', 'invoiced', 'paid', 'closed', 'cancelled'
  ));
