-- Migration 198: P3 — Notifications + Andon support
-- Grill Q8(D), Q10(D), Q12(D)

BEGIN;

-- Equipment notifications (in-app + Zalo + email tracking)
CREATE TABLE IF NOT EXISTS equipment_notifications (
  id bigserial PRIMARY KEY,
  event_type varchar(40) NOT NULL,
  title varchar(200) NOT NULL,
  body text,
  target_roles jsonb DEFAULT '[]',
  channels jsonb DEFAULT '["in_app"]',
  equipment_id varchar(40),
  wo_id bigint,
  urgency varchar(20) DEFAULT 'normal',
  read_at timestamptz,
  acknowledged_by varchar(40),
  acknowledged_at timestamptz,
  zalo_sent_at timestamptz,
  email_sent_at timestamptz,
  created_by varchar(40),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_equip_notif_unread ON equipment_notifications(read_at) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_equip_notif_event ON equipment_notifications(event_type);
CREATE INDEX IF NOT EXISTS idx_equip_notif_urgency ON equipment_notifications(urgency) WHERE urgency IN ('critical', 'high');
CREATE INDEX IF NOT EXISTS idx_equip_notif_time ON equipment_notifications(created_at DESC);

-- Andon display config (per line/screen)
CREATE TABLE IF NOT EXISTS andon_display_config (
  id bigserial PRIMARY KEY,
  display_code varchar(40) NOT NULL UNIQUE,
  display_name varchar(120),
  line_id varchar(40),
  location varchar(120),
  display_type varchar(30) DEFAULT 'full',
  refresh_interval_sec int DEFAULT 10,
  show_health_scores boolean DEFAULT true,
  show_pm_today boolean DEFAULT true,
  show_cost boolean DEFAULT false,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Seed default Andon displays
INSERT INTO andon_display_config (display_code, display_name, display_type, location, refresh_interval_sec)
VALUES
  ('ANDON-SMT-01', 'SMT产线大屏', 'full', 'SMT车间入口', 10),
  ('ANDON-DIP-01', 'DIP产线大屏', 'full', 'DIP车间入口', 10),
  ('ANDON-OFFICE', '办公室看板', 'alerts_only', '工程办公室', 30)
ON CONFLICT (display_code) DO NOTHING;

COMMIT;
