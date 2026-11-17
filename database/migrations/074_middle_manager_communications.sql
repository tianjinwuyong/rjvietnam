-- 074: MES communication channel for plant manager and middle managers.
-- Schema only; do not seed production messages.

CREATE TABLE IF NOT EXISTS mes_manager_channels (
  id BIGSERIAL PRIMARY KEY,
  channel_code VARCHAR(80) NOT NULL UNIQUE,
  name_zh VARCHAR(160) NOT NULL,
  name_en VARCHAR(160) NOT NULL,
  name_vi VARCHAR(160) NOT NULL,
  recipient_role_codes TEXT[] NOT NULL DEFAULT '{}',
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISABLED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mes_manager_channel_messages (
  id BIGSERIAL PRIMARY KEY,
  channel_id BIGINT NOT NULL REFERENCES mes_manager_channels(id),
  sender_user_id BIGINT REFERENCES users(id),
  sender_role_code VARCHAR(80),
  subject VARCHAR(240) NOT NULL,
  body TEXT NOT NULL,
  priority VARCHAR(20) NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('NORMAL','IMPORTANT','URGENT')),
  status VARCHAR(20) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','ACKNOWLEDGED','CLOSED')),
  work_order_code VARCHAR(80),
  line_code VARCHAR(40),
  exception_id VARCHAR(120),
  due_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  closed_by BIGINT REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS mes_manager_channel_receipts (
  message_id BIGINT NOT NULL REFERENCES mes_manager_channel_messages(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id),
  read_at TIMESTAMPTZ,
  acknowledged_at TIMESTAMPTZ,
  reply TEXT,
  PRIMARY KEY (message_id, user_id)
);

CREATE TABLE IF NOT EXISTS mes_plant_manager_authorizations (
  id BIGSERIAL PRIMARY KEY,
  authorization_no VARCHAR(64) NOT NULL UNIQUE,
  exception_id BIGINT,
  work_order_code VARCHAR(80),
  line_code VARCHAR(40),
  employee_code VARCHAR(80),
  material_code VARCHAR(80),
  material_lot_no VARCHAR(80),
  authorization_type VARCHAR(40) NOT NULL,
  reason TEXT NOT NULL,
  valid_from TIMESTAMPTZ NOT NULL,
  valid_until TIMESTAMPTZ NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','EXPIRED','REVOKED','USED')),
  authorized_by BIGINT REFERENCES users(id) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  revoked_by BIGINT REFERENCES users(id),
  CHECK (valid_until > valid_from),
  CHECK (valid_until <= valid_from + INTERVAL '24 hours')
);

CREATE INDEX IF NOT EXISTS idx_mes_mgr_messages_channel_created
  ON mes_manager_channel_messages(channel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mes_mgr_receipts_user
  ON mes_manager_channel_receipts(user_id, acknowledged_at);

INSERT INTO mes_manager_channels
  (channel_code, name_zh, name_en, name_vi, recipient_role_codes)
VALUES
  ('MIDDLE_MANAGERS', '中层管理者频道', 'Middle Managers', 'Quản lý cấp trung',
   ARRAY['management','pmc','hr_manager','line_leader','engineering_manager','quality','warehouse'])
ON CONFLICT (channel_code) DO NOTHING;

INSERT INTO permissions(code,name_zh,name_en,name_vi,category,module,status)
VALUES
  ('management.communication.view','查看管理沟通','View management communication','Xem trao đổi quản lý','management','communication','active'),
  ('management.communication.send','发送管理沟通','Send management communication','Gửi trao đổi quản lý','management','communication','active'),
  ('management.communication.ack','确认管理沟通','Acknowledge management communication','Xác nhận trao đổi quản lý','management','communication','active')
  ,('management.exception.authorize','厂长例外授权','Authorize plant exception','Ủy quyền ngoại lệ nhà máy','management','exception','active')
ON CONFLICT(code) DO UPDATE SET status='active';

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.code IN ('admin','management','plant_manager','factory_manager','pmc','hr_manager','line_leader','engineering_manager','quality','warehouse')
  AND p.code IN ('management.communication.view','management.communication.ack')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.code IN ('admin','management','plant_manager','factory_manager')
  AND p.code='management.communication.send'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.code IN ('admin','management','plant_manager','factory_manager')
  AND p.code='management.exception.authorize'
ON CONFLICT DO NOTHING;
