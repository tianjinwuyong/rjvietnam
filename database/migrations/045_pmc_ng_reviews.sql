-- 045: PMC NG (No Good) review table
-- QA engineers review NG events, record root cause and improvement actions

create table if not exists ng_reviews (
  id bigserial primary key,
  ng_event_id bigint,
  work_order_code varchar(30),
  line_code varchar(20),
  station_code varchar(30),
  ng_reason_code varchar(50),
  ng_reason_text text,
  ng_qty int not null default 1 check (ng_qty > 0),
  review_status varchar(20) not null default 'pending'
    check (review_status in ('pending', 'reviewed', 'closed')),
  root_cause text,
  improvement_action text,
  reviewed_by bigint references users(id),
  reviewed_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_ng_reviews_status
  on ng_reviews(review_status, created_at desc);

create index if not exists idx_ng_reviews_work_order
  on ng_reviews(work_order_code);
