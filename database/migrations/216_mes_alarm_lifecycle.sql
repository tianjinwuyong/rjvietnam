BEGIN;

CREATE TABLE IF NOT EXISTS mes_alarm_processes (
  alarm_id VARCHAR(160) NOT NULL,
  line_domain VARCHAR(24) NOT NULL
    CHECK (line_domain IN ('AUTO_LINE','MANUAL_LINE')),
  station_code VARCHAR(64) NOT NULL,
  alarm_type VARCHAR(64) NOT NULL DEFAULT 'STATION_ALARM',
  status VARCHAR(24) NOT NULL DEFAULT 'STARTED'
    CHECK (status IN ('STARTED','ACKNOWLEDGED','RESOLVED')),
  sns JSONB NOT NULL DEFAULT '[]'::jsonb,
  reason TEXT,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  operator_name VARCHAR(160),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acknowledged_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  duration_ms BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (alarm_id, line_domain),
  CHECK (
    (line_domain = 'AUTO_LINE' AND station_code ~ '^auto_') OR
    (line_domain = 'MANUAL_LINE' AND station_code ~ '^manu_')
  )
);

CREATE TABLE IF NOT EXISTS mes_alarm_events (
  event_id VARCHAR(160) PRIMARY KEY,
  alarm_id VARCHAR(160) NOT NULL,
  line_domain VARCHAR(24) NOT NULL
    CHECK (line_domain IN ('AUTO_LINE','MANUAL_LINE')),
  station_code VARCHAR(64) NOT NULL,
  event_type VARCHAR(32) NOT NULL
    CHECK (event_type IN ('ALARM_STARTED','ALARM_ACKNOWLEDGED','ALARM_RESOLVED')),
  sns JSONB NOT NULL DEFAULT '[]'::jsonb,
  reason TEXT,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  operator_name VARCHAR(160),
  event_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  duration_ms BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (alarm_id, line_domain)
    REFERENCES mes_alarm_processes(alarm_id, line_domain) ON DELETE RESTRICT,
  CHECK (
    (line_domain = 'AUTO_LINE' AND station_code ~ '^auto_') OR
    (line_domain = 'MANUAL_LINE' AND station_code ~ '^manu_')
  )
);

CREATE INDEX IF NOT EXISTS idx_mes_alarm_process_domain_status
  ON mes_alarm_processes(line_domain, status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_mes_alarm_process_station
  ON mes_alarm_processes(line_domain, station_code, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_mes_alarm_event_alarm
  ON mes_alarm_events(line_domain, alarm_id, event_at);

COMMIT;
