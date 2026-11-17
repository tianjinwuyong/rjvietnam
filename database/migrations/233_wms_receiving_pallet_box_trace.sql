CREATE TABLE IF NOT EXISTS wms_receiving_pallet_box_bindings (
  id BIGSERIAL PRIMARY KEY,
  pallet_qr VARCHAR(200) NOT NULL,
  box_qr VARCHAR(200) NOT NULL UNIQUE,
  lot_no VARCHAR(200),
  supplier VARCHAR(200),
  location_qr VARCHAR(200),
  bound_by VARCHAR(120) NOT NULL,
  bound_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (pallet_qr, box_qr)
);
CREATE INDEX IF NOT EXISTS idx_wms_recv_pallet_box_pallet ON wms_receiving_pallet_box_bindings(pallet_qr);
