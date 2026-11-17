-- M4: every received material lot must be traceable to an approved inbound order line.

ALTER TABLE material_lots
  ADD COLUMN IF NOT EXISTS inbound_order_id bigint REFERENCES inbound_orders(id),
  ADD COLUMN IF NOT EXISTS inbound_order_line_id bigint REFERENCES inbound_order_lines(id);

CREATE INDEX IF NOT EXISTS idx_material_lots_inbound_order
  ON material_lots(inbound_order_id, inbound_order_line_id);

CREATE INDEX IF NOT EXISTS idx_inbound_order_lines_receipt_match
  ON inbound_order_lines(inbound_order_id, material_id);

INSERT INTO _migrations(filename, hash)
VALUES ('151_inbound_receipt_strong_link.sql', 'm4-inbound-receipt-strong-link-v1')
ON CONFLICT (filename) DO NOTHING;
