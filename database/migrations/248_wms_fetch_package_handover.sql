-- One physical QR identity and an immutable handover trail per material fetching package.
CREATE TABLE IF NOT EXISTS wms_fetch_packages (
  id bigserial PRIMARY KEY,
  package_no varchar(80) NOT NULL UNIQUE,
  qr_value varchar(240) NOT NULL UNIQUE,
  requisition_id bigint NOT NULL REFERENCES requisitions(id),
  work_order_code varchar(50),
  line_code varchar(30),
  total_qty numeric(38,6) NOT NULL DEFAULT 0,
  contents jsonb NOT NULL DEFAULT '[]'::jsonb,
  status varchar(24) NOT NULL DEFAULT 'PREPARED',
  handed_over_by varchar(120), handed_over_at timestamptz,
  received_by varchar(120), received_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_wms_fetch_package_status CHECK (status IN ('PREPARED','HANDED_OVER','RECEIVED','CONSUMING','CLOSED','VOIDED'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_wms_fetch_package_requisition ON wms_fetch_packages(requisition_id);
CREATE INDEX IF NOT EXISTS idx_wms_fetch_package_status ON wms_fetch_packages(status,created_at DESC);

CREATE TABLE IF NOT EXISTS wms_fetch_package_events (
  id bigserial PRIMARY KEY,
  fetch_package_id bigint NOT NULL REFERENCES wms_fetch_packages(id),
  event_type varchar(40) NOT NULL,
  actor varchar(120) NOT NULL,
  device_code varchar(120), station_code varchar(120), detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wms_fetch_package_events_package ON wms_fetch_package_events(fetch_package_id,occurred_at);
