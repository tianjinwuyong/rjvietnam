-- Manual-line data relay, cleansing, quarantine and safe retention.
-- Production/quality/audit ledgers are deliberately not purge targets.

CREATE TABLE IF NOT EXISTS station_data_staging (
  staging_id BIGSERIAL PRIMARY KEY,
  event_id VARCHAR(160) NOT NULL UNIQUE,
  station_code VARCHAR(64) NOT NULL,
  source_type VARCHAR(32) NOT NULL,
  source_ref TEXT,
  raw_payload JSONB NOT NULL,
  normalized_payload JSONB,
  payload_hash CHAR(64) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'RECEIVED'
    CHECK (status IN ('RECEIVED','CLEANED','PROJECTED','QUARANTINED','FAILED')),
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  error_code VARCHAR(64),
  error_detail TEXT
);

CREATE INDEX IF NOT EXISTS station_data_staging_status_received_idx
  ON station_data_staging(status, received_at);
CREATE INDEX IF NOT EXISTS station_data_staging_station_received_idx
  ON station_data_staging(station_code, received_at DESC);

CREATE TABLE IF NOT EXISTS station_data_quarantine (
  quarantine_id BIGSERIAL PRIMARY KEY,
  staging_id BIGINT REFERENCES station_data_staging(staging_id) ON DELETE SET NULL,
  event_id VARCHAR(160) NOT NULL,
  station_code VARCHAR(64) NOT NULL,
  reason_code VARCHAR(64) NOT NULL,
  reason_detail TEXT,
  raw_payload JSONB NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN','RELEASED','DISCARDED')),
  quarantined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by VARCHAR(120),
  review_note TEXT
);

CREATE INDEX IF NOT EXISTS station_data_quarantine_open_idx
  ON station_data_quarantine(status, quarantined_at);

CREATE TABLE IF NOT EXISTS station_data_retention_policies (
  dataset VARCHAR(64) PRIMARY KEY,
  retention_days INTEGER NOT NULL CHECK (retention_days >= 1),
  archive_before_delete BOOLEAN NOT NULL DEFAULT FALSE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  protected BOOLEAN NOT NULL DEFAULT FALSE,
  description TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO station_data_retention_policies
  (dataset,retention_days,archive_before_delete,enabled,protected,description)
VALUES
  ('station_data_staging_projected',7,FALSE,TRUE,FALSE,'已成功投影的原始暂存数据'),
  ('station_data_staging_failed',30,FALSE,TRUE,FALSE,'已失败但可由隔离记录追溯的暂存数据'),
  ('station_data_quarantine_closed',90,TRUE,TRUE,FALSE,'已人工处理的隔离数据'),
  ('station_inventory_checks',365,FALSE,TRUE,FALSE,'可重建的工位盘点证据'),
  ('production_quality_audit',3650,TRUE,FALSE,TRUE,'生产、NG、维修、复活、交接及审批账；禁止自动删除')
ON CONFLICT(dataset) DO NOTHING;

CREATE TABLE IF NOT EXISTS station_data_cleanup_audit (
  cleanup_id BIGSERIAL PRIMARY KEY,
  dataset VARCHAR(64) NOT NULL,
  cutoff_at TIMESTAMPTZ NOT NULL,
  rows_deleted INTEGER NOT NULL DEFAULT 0,
  dry_run BOOLEAN NOT NULL DEFAULT TRUE,
  executed_by VARCHAR(120) NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

