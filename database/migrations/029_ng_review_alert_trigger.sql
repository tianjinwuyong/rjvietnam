-- Migration 029: NG review closed-loop + alert auto-trigger tracking
-- ng_reviews: QA engineer audit of NG events
-- alert_sent_log: dedup tracking to avoid spamming the same alert

CREATE TABLE IF NOT EXISTS ng_reviews (
  id BIGSERIAL PRIMARY KEY,
  ng_event_id BIGINT,                      -- FK to station_events.id (nullable for manual)
  work_order_code VARCHAR(50),
  line_code VARCHAR(20),
  station_code VARCHAR(30),
  ng_reason_code VARCHAR(30),
  ng_reason_text VARCHAR(200),
  ng_qty INTEGER NOT NULL DEFAULT 1,
  review_status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending|reviewed|closed'
  root_cause VARCHAR(500),
  improvement_action VARCHAR(500),
  reviewed_by BIGINT,
  reviewed_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alert_sent_log (
  id BIGSERIAL PRIMARY KEY,
  alert_key VARCHAR(100) NOT NULL UNIQUE,  -- e.g. "overdue:WO001", "stagnation:LINE001", "material_risk:WO001"
  alert_type VARCHAR(30) NOT NULL,
  work_order_code VARCHAR(50),
  line_code VARCHAR(20),
  last_sent_at TIMESTAMPTZ DEFAULT NOW(),
  send_count INTEGER DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_ng_reviews_status ON ng_reviews(review_status);
CREATE INDEX IF NOT EXISTS idx_ng_reviews_wo ON ng_reviews(work_order_code);
CREATE INDEX IF NOT EXISTS idx_alert_sent_log_key ON alert_sent_log(alert_key);
