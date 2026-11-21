-- 234: sales order number sequence
-- The sales module's POST /sales/orders route generates so_no via nextval('so_number_seq').
-- This sequence was never created, so order creation failed with "relation so_number_seq does not exist".
CREATE SEQUENCE IF NOT EXISTS so_number_seq;
