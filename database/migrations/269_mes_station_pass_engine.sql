-- 269: native station-pass engine (parity with the Python MES /exec/pass chain).
-- The Python MES stored this in SQLite prd_pass + a few ALTER'ed columns; here the
-- pass itself is an event row, the policy is per station, and站跳行 needs an
-- approved 放行单 (skip release) instead of a boolean override.
--
-- Tables:
--   mes_station_pass_policies  per-station防呆 policy (manual deny / retest / dwell)
--   mes_skip_releases          跳站放行单 (request -> approve/reject -> consume)
--   mes_station_pass_events    one row per pass attempt (OK and NG), idempotent

CREATE TABLE IF NOT EXISTS mes_station_pass_policies (
  station_code        VARCHAR(64) PRIMARY KEY,
  deny_manual_pass    BOOLEAN NOT NULL DEFAULT false,
  allow_repeat_pass   BOOLEAN NOT NULL DEFAULT false,
  max_retest          INTEGER NOT NULL DEFAULT 0 CHECK (max_retest >= 0),
  min_dwell_minutes   INTEGER NOT NULL DEFAULT 0 CHECK (min_dwell_minutes >= 0),
  require_upstream_ok BOOLEAN NOT NULL DEFAULT true,
  notes               TEXT,
  updated_by          VARCHAR(120),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mes_skip_releases (
  release_no          VARCHAR(64) PRIMARY KEY,
  identity_value      VARCHAR(200) NOT NULL,
  work_order_code     VARCHAR(160),
  from_station_code   VARCHAR(64) NOT NULL,
  to_station_code     VARCHAR(64) NOT NULL,
  reason              TEXT NOT NULL,
  status              VARCHAR(24) NOT NULL DEFAULT 'PENDING'
                      CHECK (status IN ('PENDING','APPROVED','REJECTED','CONSUMED','EXPIRED')),
  requested_by        VARCHAR(120) NOT NULL,
  requested_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_by         VARCHAR(120),
  approved_at         TIMESTAMPTZ,
  rejected_by         VARCHAR(120),
  rejected_at         TIMESTAMPTZ,
  reject_reason       TEXT,
  consumed_at         TIMESTAMPTZ,
  consumed_by_pass_id VARCHAR(80),
  expires_at          TIMESTAMPTZ,
  detail              JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_mes_skip_releases_identity
  ON mes_skip_releases(upper(identity_value), status);
CREATE INDEX IF NOT EXISTS idx_mes_skip_releases_pending
  ON mes_skip_releases(status, requested_at DESC);

CREATE TABLE IF NOT EXISTS mes_station_pass_events (
  pass_id             VARCHAR(80) PRIMARY KEY,
  idempotency_key     VARCHAR(200) NOT NULL UNIQUE,
  identity_value      VARCHAR(200) NOT NULL,
  product_id          VARCHAR(80),
  work_order_code     VARCHAR(160),
  line_code           VARCHAR(64),
  station_code        VARCHAR(64) NOT NULL,
  result              VARCHAR(8) NOT NULL CHECK (result IN ('OK','NG')),
  gate_state          VARCHAR(24) NOT NULL
                      CHECK (gate_state IN ('ALLOW','HOLD','REJECT','REPAIR_ROUTE','COMPLETED')),
  reason_code         VARCHAR(80) NOT NULL,
  next_action         VARCHAR(80) NOT NULL,
  visit_no            INTEGER,
  retest_no           INTEGER,
  operator_id         VARCHAR(120) NOT NULL,
  source              VARCHAR(24) NOT NULL DEFAULT 'manual'
                      CHECK (source IN ('manual','machine','device','auto','agent')),
  defect_code         VARCHAR(80),
  root_cause          VARCHAR(80),
  dwell_seconds       INTEGER,
  skip_release_no     VARCHAR(64),
  request_payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  decided_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mes_station_pass_identity
  ON mes_station_pass_events(upper(identity_value), decided_at DESC);
CREATE INDEX IF NOT EXISTS idx_mes_station_pass_station
  ON mes_station_pass_events(station_code, decided_at DESC);
CREATE INDEX IF NOT EXISTS idx_mes_station_pass_work_order
  ON mes_station_pass_events(work_order_code, decided_at DESC);
