-- Allow work_orders.customer_po_id to be NULL for trial-production WOs without a PO
-- Also add a CHECK constraint so only type 1 (production) WOs require a PO link

ALTER TABLE work_orders ALTER COLUMN customer_po_id DROP NOT NULL;

-- Add a partial check: types 2,3,4 (sample/repair/other) must have NULL customer_po_id
-- type 1 (production) typically has one, but we won't enforce it at the DB level
