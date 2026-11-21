-- Migration 025: Fool-proof (Poka-yoke) tables for SMT material anti-error
begin;

-- ── Fool-Proof Rules ──────────────────────────────────────────────────────
-- Defines the expected material per feeder slot per station/line
create table if not exists fool_proof_rules (
  id              bigserial primary key,
  line_id         bigint references production_lines(id),
  station_id      bigint references stations(id),
  feeder_slot     varchar(8) not null,          -- e.g. 'F01', 'F12', 'E01'
  material_id     bigint references products(id),
  material_reel_code varchar(64),               -- optional exact reel-code match
  rule_type       varchar(16) not null default 'material',  -- 'material' | 'reel' | 'both'
  status          varchar(16) not null default 'active',    -- 'active' | 'disabled'
  notes           text,
  created_by      varchar(64),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (station_id, feeder_slot)
);

-- ── First Article Inspection ──────────────────────────────────────────────
create table if not exists first_article_inspections (
  id              bigserial primary key,
  work_order_id   bigint references work_orders(id),
  station_id      bigint references stations(id),
  line_id         bigint references production_lines(id),
  result          varchar(8) not null,                       -- 'PASS' | 'FAIL'
  checked_by      varchar(64),
  checked_at      timestamptz not null default now(),
  lot_no          varchar(64),
  remarks         text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ── First Article Check Items ─────────────────────────────────────────────
create table if not exists first_article_check_items (
  id                      bigserial primary key,
  inspection_id           bigint references first_article_inspections(id) on delete cascade,
  check_type              varchar(32) not null,   -- 'bom_match' | 'position' | 'direction' | 'quantity' | 'visual'
  material_code           varchar(64),
  expected_value          text,
  actual_value            text,
  result                  varchar(8) not null,    -- 'PASS' | 'FAIL'
  notes                   text
);

-- ── Material Verification Records ─────────────────────────────────────────
create table if not exists material_verifications (
  id              bigserial primary key,
  work_order_id   bigint references work_orders(id),
  line_id         bigint references production_lines(id),
  station_id      bigint references stations(id),
  feeder_slot     varchar(8),
  material_id     bigint references products(id),
  material_code   varchar(64),
  expected_reel   varchar(64),
  actual_reel     varchar(64),
  match_result    varchar(8) not null,   -- 'PASS' | 'FAIL'
  verified_by     varchar(64),
  verified_at     timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

-- ── Indexes ───────────────────────────────────────────────────────────────
create index if not exists idx_foolproof_station on fool_proof_rules(station_id);
create index if not exists idx_foolproof_line   on fool_proof_rules(line_id);
create index if not exists idx_foolproof_mat    on fool_proof_rules(material_id);
create index if not exists idx_fai_wo           on first_article_inspections(work_order_id);
create index if not exists idx_fai_station      on first_article_inspections(station_id);
create index if not exists idx_fai_check_insp   on first_article_check_items(inspection_id);
create index if not exists idx_mv_wo            on material_verifications(work_order_id);
create index if not exists idx_mv_station       on material_verifications(station_id);

commit;