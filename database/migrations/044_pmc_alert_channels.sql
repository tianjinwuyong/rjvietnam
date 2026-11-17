-- 044: PMC alert notification channels table
-- Supports Telegram and HTTP webhook channels for PMC alerts

create table if not exists notification_channels (
  id bigserial primary key,
  name varchar(100) not null,
  channel_type varchar(30) not null check (channel_type in ('telegram', 'http_webhook')),
  webhook_url text,
  telegram_bot_token text,
  telegram_chat_id varchar(100),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_notification_channels_active
  on notification_channels(is_active);
