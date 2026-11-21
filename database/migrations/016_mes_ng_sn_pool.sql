-- ============================================================
-- Migration 016: MES NG Pool & SN Pool (remote authoritative)
-- ============================================================
-- Replaces the old public.ng_defect_records / sn_duplicate_attempts
-- with schema + table naming that matches station Python code.
--
-- Architecture:
--   Local SQLite (per PC)     → ng_pool, sn_records      (unchanged)
--   Remote MES (PostgreSQL)   → mes.ng_pool, mes.sn_pool  (THIS FILE)
--
-- Station scan flow:
--   Scan SN
--     → ① Local SQLite ng_pool (fast reject)
--     → ② Local SQLite sn_records (fast dup check)
--     → ③ Remote MES ng_pool (authoritative NG check)
--     → ④ Remote MES sn_pool (authoritative dup check)
--     → All clear → write local + POST /api/mes/events
-- ============================================================

-- ============================================================
-- Schema
-- ============================================================
create schema if not exists mes;

-- ============================================================
-- mes.ng_pool — every NG event from every station
-- Naming matches station SQLite ate_ng_pool.db → ng_pool
-- ============================================================

create table if not exists mes.ng_pool (
  id              bigserial,
  sn              varchar(120) not null,
  model           varchar(60),              -- product model
  station_code    varchar(50) not null,      -- e.g. 'ATE1-01', 'ICT01'
  line_code       varchar(10),               -- '001'=smt, '002'=auto, '003'=pack, '004'=manual
  work_order_code varchar(20),               -- 11-digit work order
  channel         varchar(40),               -- test fixture / channel #
  error_code      varchar(40),               -- station-specific error
  result          varchar(20) not null default 'ng',
  source          varchar(20) not null,      -- 'ATE' | 'AOI' | 'PCBA' | 'AGING' | 'MANUAL'
  operator        varchar(60),
  occurred_at     timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (id, occurred_at)
) partition by range (occurred_at);

-- Indexes for remote NG detection queries
-- Hash index on sn: O(1) exact match — fastest for "is this SN NG?" check
create index if not exists idx_mes_ng_pool_sn         on mes.ng_pool using hash (sn);
create index if not exists idx_mes_ng_pool_station     on mes.ng_pool (station_code, occurred_at desc);
create index if not exists idx_mes_ng_pool_wo          on mes.ng_pool (work_order_code, occurred_at desc);
create index if not exists idx_mes_ng_pool_result      on mes.ng_pool (result, occurred_at desc);
create index if not exists idx_mes_ng_pool_occurred    on mes.ng_pool (occurred_at desc);

comment on table mes.ng_pool is 'Remote authoritative NG pool — matches station SQLite ng_pool naming. Queried by MES bridge for NG detection.';
comment on column mes.ng_pool.sn is 'Failed serial number';
comment on column mes.ng_pool.station_code is 'Station code from env MES_NEW_STATION (e.g. ATE1-01)';
comment on column mes.ng_pool.source is 'Station type category: ATE, AOI, PCBA, AGING, MANUAL';
comment on column mes.ng_pool.result is 'ng | scrap | hold — ng is the default NG result';

-- ============================================================
-- mes.sn_pool — every SN scanned at every station
-- Used for remote duplicate SN detection across all stations
-- Naming matches station in-memory sn_pool concept
-- ============================================================

create table if not exists mes.sn_pool (
  id              bigserial,
  sn              varchar(120) not null,
  model           varchar(60),
  station_code    varchar(50) not null,
  line_code       varchar(10),
  work_order_code varchar(20),
  channel         varchar(40),
  result          varchar(20),               -- 'pass' | 'ng'
  error_code      varchar(40),
  is_duplicate    boolean not null default false,
  operator        varchar(60),
  scanned_at      timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  primary key (id, scanned_at)
) partition by range (scanned_at);

-- Indexes for remote duplicate SN detection
-- Hash index on sn: O(1) exact match — fastest for "has this SN been scanned?" check
create index if not exists idx_mes_sn_pool_sn         on mes.sn_pool using hash (sn);
create index if not exists idx_mes_sn_pool_station     on mes.sn_pool (station_code, scanned_at desc);
create index if not exists idx_mes_sn_pool_wo          on mes.sn_pool (work_order_code, scanned_at desc);
create index if not exists idx_mes_sn_pool_dup         on mes.sn_pool (is_duplicate, scanned_at desc);
create index if not exists idx_mes_sn_pool_scanned     on mes.sn_pool (scanned_at desc);

comment on table mes.sn_pool is 'Remote authoritative SN pool — all SN scans across all stations. Queried for duplicate SN detection.';
comment on column mes.sn_pool.sn is 'Scanned serial number';
comment on column mes.sn_pool.is_duplicate is 'True if this SN was already scanned at another station';
comment on column mes.sn_pool.scanned_at is 'When the SN was scanned at the station';

-- ============================================================
-- Year partitions: 2026-2035 (10-year retention, matches 014)
-- ============================================================

do $$
declare
  year_start text;
  year_end   text;
  y int;
begin
  for y in 2026..2035 loop
    year_start := y || '-01-01';
    year_end   := (y + 1) || '-01-01';

    -- ng_pool partitions (check by schema name since mes ≠ public)
    if not exists (
      select 1 from pg_tables
      where schemaname = 'mes' and tablename = 'ng_pool_' || y
    ) then
      execute format(
        'create table mes.ng_pool_%s partition of mes.ng_pool for values from (%L) to (%L)',
        y, year_start, year_end
      );
    end if;

    -- sn_pool partitions
    if not exists (
      select 1 from pg_tables
      where schemaname = 'mes' and tablename = 'sn_pool_' || y
    ) then
      execute format(
        'create table mes.sn_pool_%s partition of mes.sn_pool for values from (%L) to (%L)',
        y, year_start, year_end
      );
    end if;
  end loop;
end $$;

-- ============================================================
-- Helper function: check if SN exists in ng_pool
-- Returns the first NG record if found, null if clear
-- ============================================================

create or replace function mes.check_sn_ng(p_sn varchar)
returns table (
  found         boolean,
  station_code  varchar,
  error_code    varchar,
  occurred_at   timestamptz
) language sql stable as $$
  select
    true,
    ng.station_code,
    ng.error_code,
    ng.occurred_at
  from mes.ng_pool ng
  where ng.sn = p_sn
    and ng.result = 'ng'
  order by ng.occurred_at desc
  limit 1;
$$;

comment on function mes.check_sn_ng is 'Remote NG check — used by MES bridge when station queries "is this SN NG?". Returns first NG record or empty set.';

-- ============================================================
-- Helper function: check if SN already scanned (duplicate)
-- Returns the first prior scan if found, null if first-time
-- ============================================================

create or replace function mes.check_sn_dup(p_sn varchar, p_exclude_station varchar default null)
returns table (
  found           boolean,
  station_code    varchar,
  work_order_code varchar,
  scanned_at      timestamptz,
  result          varchar
) language sql stable as $$
  select
    true,
    sp.station_code,
    sp.work_order_code,
    sp.scanned_at,
    sp.result
  from mes.sn_pool sp
  where sp.sn = p_sn
    and (p_exclude_station is null or sp.station_code <> p_exclude_station)
  order by sp.scanned_at desc
  limit 1;
$$;

comment on function mes.check_sn_dup is 'Remote duplicate check — used by MES bridge when station queries "has this SN been scanned?". Excludes the querying station to allow retry/fix.';
