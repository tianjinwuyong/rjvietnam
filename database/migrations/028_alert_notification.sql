-- Migration 028: Alert notification system
-- notification_channels: webhook URLs for Telegram/slack/email
-- alert_history: sent alert log with delivery status

CREATE TABLE IF NOT EXISTS notification_channels (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  channel_type VARCHAR(20) NOT NULL, -- 'telegram'|'slack'|'email'|'http_webhook'
  webhook_url VARCHAR(500),
  telegram_chat_id VARCHAR(50),
  telegram_bot_token VARCHAR(200),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by BIGINT
);

CREATE TABLE IF NOT EXISTS alert_history (
  id BIGSERIAL PRIMARY KEY,
  alert_type VARCHAR(30) NOT NULL,  -- 'overdue'|'delay'|'material_risk'|'ng'|'stagnation'
  work_order_code VARCHAR(50),
  line_code VARCHAR(20),
  priority INTEGER,                  -- 1=critical 2=high 3=normal 4=low
  title VARCHAR(200) NOT NULL,
  message TEXT NOT NULL,
  channel_id BIGINT REFERENCES notification_channels(id),
  delivery_status VARCHAR(20) DEFAULT 'pending', -- 'pending'|'sent'|'failed'
  response_body TEXT,
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_history_work_order ON alert_history(work_order_code);
CREATE INDEX IF NOT EXISTS idx_alert_history_sent_at ON alert_history(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_channels_active ON notification_channels(is_active);

-- Seed default notification channel (placeholder — needs real bot token)
INSERT INTO notification_channels (name, channel_type, is_active)
VALUES ('Telegram 瑞晶工厂', 'telegram', FALSE)
ON CONFLICT DO NOTHING;
