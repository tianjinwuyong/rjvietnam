-- Station heartbeat registry
-- Tracks last_seen timestamp for each station for Andon/live monitoring

CREATE TABLE IF NOT EXISTS station_heartbeats (
  id               BIGSERIAL PRIMARY KEY,
  station_code     VARCHAR(40) NOT NULL UNIQUE,
  line_code        VARCHAR(30),
  last_seen        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_operator    VARCHAR(80),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_station_heartbeats_code     ON station_heartbeats(station_code);
CREATE INDEX IF NOT EXISTS idx_station_heartbeats_line    ON station_heartbeats(line_code);
CREATE INDEX IF NOT EXISTS idx_station_heartbeats_last_seen ON station_heartbeats(last_seen DESC);
