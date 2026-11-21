-- ============================================================
-- Migration 078: SN Partition Management & Archival System
-- ============================================================
-- Tracks sn_pool and ng_pool partitions with archival state.
-- Archives partitions older than threshold (default: 3 years)
-- to mes_archive schema for long-term retention without
-- bloating the live MES database.
--
-- Key design decisions:
-- - mes_archive.sn_pool / ng_pool are ALSO partitioned parents
-- - Archived partitions are detached from mes.* and attached to mes_archive.*
-- - check_sn_dup() and check_sn_ng() now query sn_pool_all / ng_pool_all
--   which UNION ALL both live and archive partition parents, so
--   duplicate checks work even after archival
-- - Partition management table tracks every partition's status
-- ============================================================

-- ============================================================
-- 1. mes_archive schema — where old partitions live
-- ============================================================
create schema if not exists mes_archive;

-- ============================================================
-- 2. mes_archive partitioned parent tables
-- These receive archived partitions via ALTER TABLE ... ATTACH PARTITION
-- ============================================================

-- sn_pool archive parent (partitioned identically to mes.sn_pool)
create table if not exists mes_archive.sn_pool (
  id              bigserial,
  sn              varchar(120) not null,
  model           varchar(60),
  station_code    varchar(50) not null,
  line_code       varchar(10),
  work_order_code varchar(20),
  channel         varchar(40),
  result          varchar(20),
  error_code      varchar(40),
  is_duplicate    boolean not null default false,
  operator        varchar(60),
  scanned_at      timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  primary key (id, scanned_at)
) partition by range (scanned_at);

-- ng_pool archive parent
create table if not exists mes_archive.ng_pool (
  id              bigserial,
  sn              varchar(120) not null,
  model           varchar(60),
  station_code    varchar(50) not null,
  line_code       varchar(10),
  work_order_code varchar(20),
  channel         varchar(40),
  error_code      varchar(40),
  result          varchar(20) not null default 'ng',
  source          varchar(20) not null,
  operator        varchar(60),
  occurred_at     timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (id, occurred_at)
) partition by range (occurred_at);

-- ============================================================
-- 3. Partition management table
-- ============================================================
create table if not exists mes.sn_partition_management (
  id                   bigserial primary key,
  live_schema          varchar(20) not null default 'mes',   -- always 'mes' for live
  archive_schema       varchar(20) not null default 'mes_archive',
  table_name           varchar(40)  not null,                -- 'sn_pool' or 'ng_pool'
  partition_name       varchar(60)  not null,                -- e.g. 'sn_pool_2024'
  partition_year       int          not null,                -- e.g. 2024
  status               varchar(20)  not null default 'active',  -- active | archived
  row_count            bigint,
  archived_at          timestamptz,
  archived_by          varchar(60),
  created_at           timestamptz  not null default now(),
  constraint chk_sn_partition_name check (
    format('sn_pool_%s', partition_year) = partition_name
    or format('ng_pool_%s', partition_year) = partition_name
  )
);

comment on table mes.sn_partition_management is
  'Tracks lifecycle of sn_pool and ng_pool yearly partitions. '
  'Partitions older than archive_threshold_years are archived to mes_archive schema. '
  'DO NOT update this table manually — use mes.archive_sn_partition().';
comment on column mes.sn_partition_management.status is
  'active=attached to mes.* parent, archived=moved to mes_archive.* parent';

create index if not exists idx_sn_part_mgmt_status
  on mes.sn_partition_management (status, partition_year);
create index if not exists idx_sn_part_mgmt_lookup
  on mes.sn_partition_management (table_name, partition_year);

-- ============================================================
-- 4. Archive threshold config
-- ============================================================
create table if not exists mes.sn_archive_config (
  id                       serial primary key,
  archive_threshold_years  int not null default 3,
  enable_auto_archive      boolean not null default true,
  updated_at               timestamptz not null default now(),
  updated_by               varchar(60)
);

insert into mes.sn_archive_config (archive_threshold_years, enable_auto_archive, updated_by)
values (3, true, 'system')
on conflict do nothing;

comment on table mes.sn_archive_config is
  'Controls SN archival policy: how many years to keep live before archiving to mes_archive.';

-- ============================================================
-- 5. Archive SN partition function
-- ============================================================
-- Detaches partition from mes.{sn_pool|ng_pool} and attaches
-- to mes_archive.{sn_pool|ng_pool}. Updates management table.
-- ============================================================
create or replace function mes.archive_sn_partition(
  p_partition_year  int,
  p_table_name      varchar(40) default 'sn_pool',
  p_operator        varchar(60) default 'system'
) returns table (
  archived_table_name   text,
  row_count_moved       bigint,
  execution_time_ms     bigint
) language plpgsql as $$
declare
  v_partition_name   text := p_table_name || '_' || p_partition_year;
  v_live_fqn         text := 'mes.'      || v_partition_name;  -- e.g. mes.sn_pool_2024
  v_archive_fqn      text := 'mes_archive.' || v_partition_name; -- e.g. mes_archive.sn_pool_2024
  v_row_count        bigint;
  v_start_time       timestamptz := now();
  v_current_status   varchar(20);
  v_exists_live      boolean;
  v_exists_archive   boolean;
begin
  -- Check management record
  select status into v_current_status
  from mes.sn_partition_management
  where table_name = p_table_name and partition_year = p_partition_year;

  if not found then
    raise exception 'Partition % for % not found in sn_partition_management',
      v_partition_name, p_table_name;
  end if;

  if v_current_status = 'archived' then
    raise exception 'Partition % is already archived', v_partition_name;
  end if;

  -- Verify partition table exists in mes schema
  execute format('select true from pg_tables where schemaname = ''mes'' and tablename = %L', v_partition_name)
    into v_exists_live;
  if not v_exists_live then
    raise exception 'Partition table % does not exist in mes schema', v_live_fqn;
  end if;

  -- Get row count before moving
  execute format('select count(*) from %I', v_live_fqn) into v_row_count;

  -- Detach from live parent
  execute format('alter table %I detach partition %I', p_table_name, v_partition_name);

  -- Attach to archive parent
  execute format('alter table %I attach partition %I for values from (%L) to (%L)',
    'mes_archive.' || p_table_name,
    v_partition_name,
    p_partition_year || '-01-01',
    (p_partition_year + 1) || '-01-01'
  );

  -- Update management table
  update mes.sn_partition_management
  set status      = 'archived',
      row_count   = v_row_count,
      archived_at = now(),
      archived_by = p_operator,
      updated_at  = now()
  where table_name = p_table_name and partition_year = p_partition_year;

  return query select
    v_archive_fqn                     as archived_table_name,
    v_row_count                       as row_count_moved,
    extract(milliseconds from now() - v_start_time)::bigint as execution_time_ms;
end;
$$;

comment on function mes.archive_sn_partition is
  'Archives a sn_pool or ng_pool partition: detaches from mes.* parent, '
  'attaches to mes_archive.* parent, updates sn_partition_management. '
  'After this, check_sn_dup / check_sn_ng still find SNs via sn_pool_all / ng_pool_all.';

-- ============================================================
-- 6. Auto-archive trigger
-- ============================================================
create or replace function mes.check_and_archive_sn_partitions()
returns table (
  archived_partition   text,
  partition_year       int,
  row_count            bigint
) language plpgsql as $$
declare
  v_threshold     int;
  v_enabled       boolean;
  v_current_year  int := extract(year from now())::int;
  v_cutoff_year   int;
  v_row           record;
begin
  select archive_threshold_years, enable_auto_archive
    into v_threshold, v_enabled
  from mes.sn_archive_config
  order by id desc limit 1;

  if not v_enabled then
    return;
  end if;

  -- e.g. threshold=3, current_year=2026 → cutoff=2023 → archive 2023 and older
  v_cutoff_year := v_current_year - v_threshold;

  for v_row in (
    select partition_name, partition_year, table_name
    from mes.sn_partition_management
    where status = 'active'
      and partition_year <= v_cutoff_year
    order by partition_year
  ) loop
    return query
    select *
    from mes.archive_sn_partition(v_row.partition_year, v_row.table_name, 'auto-trigger');
  end loop;
end;
$$;

comment on function mes.check_and_archive_sn_partitions is
  'Finds all active partitions older than archive_threshold_years and archives them. '
  'Run via scheduled job or after each shift: SELECT * FROM mes.check_and_archive_sn_partitions();';

-- ============================================================
-- 7. Union views — query BOTH live and archived partitions
-- ============================================================
-- check_sn_dup / check_sn_ng will be updated to use these views
-- so duplicate detection works even after archival

create or replace view mes.sn_pool_all as
  select sn, model, station_code, line_code, work_order_code,
         channel, result, error_code, is_duplicate, operator,
         scanned_at, created_at
  from mes.sn_pool
  union all
  select sn, model, station_code, line_code, work_order_code,
         channel, result, error_code, is_duplicate, operator,
         scanned_at, created_at
  from mes_archive.sn_pool;

create or replace view mes.ng_pool_all as
  select sn, model, station_code, line_code, work_order_code,
         channel, error_code, result, source, operator,
         occurred_at, created_at, updated_at
  from mes.ng_pool
  union all
  select sn, model, station_code, line_code, work_order_code,
         channel, error_code, result, source, operator,
         occurred_at, created_at, updated_at
  from mes_archive.ng_pool;

-- ============================================================
-- 8. Fix check_sn_dup to use sn_pool_all (covers archived SNs)
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
  from mes.sn_pool_all sp
  where sp.sn = p_sn
    and (p_exclude_station is null or sp.station_code <> p_exclude_station)
  order by sp.scanned_at desc
  limit 1;
$$;

comment on function mes.check_sn_dup is
  'Duplicate SN check — queries mes.sn_pool_all which includes both live and archived partitions. '
  'Used by MES bridge when station queries "has this SN been scanned?". '
  'Excludes the querying station to allow retry/fix at same station.';

-- ============================================================
-- 9. Fix check_sn_ng to use ng_pool_all (covers archived NG events)
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
  from mes.ng_pool_all ng
  where ng.sn = p_sn
    and ng.result = 'ng'
  order by ng.occurred_at desc
  limit 1;
$$;

comment on function mes.check_sn_ng is
  'NG check — queries mes.ng_pool_all which includes both live and archived NG events. '
  'Used by MES bridge when station queries "is this SN NG?".';

-- ============================================================
-- 10. Seed partition management — register existing partitions
-- ============================================================
do $$
declare
  v_year     int;
  v_partition text;
  v_count    bigint;
begin
  for v_year in 2026..2035 loop
    -- sn_pool partitions
    v_partition := 'sn_pool_' || v_year;
    execute format('select count(*) from mes.%I', v_partition) into v_count;
    insert into mes.sn_partition_management
      (table_name, partition_name, partition_year, status, row_count)
    values ('sn_pool', v_partition, v_year, 'active', v_count)
    on conflict do nothing;

    -- ng_pool partitions
    v_partition := 'ng_pool_' || v_year;
    execute format('select count(*) from mes.%I', v_partition) into v_count;
    insert into mes.sn_partition_management
      (table_name, partition_name, partition_year, status, row_count)
    values ('ng_pool', v_partition, v_year, 'active', v_count)
    on conflict do nothing;
  end loop;
end;
$$;

-- ============================================================
-- 11. Extend partitions to 2036-2037 and register them
-- ============================================================
do $$
declare
  y       int;
  y_start text;
  y_end   text;
begin
  for y in 2036..2037 loop
    y_start := y || '-01-01';
    y_end   := (y + 1) || '-01-01';

    -- sn_pool partition in mes
    if not exists (
      select 1 from pg_tables
      where schemaname = 'mes' and tablename = 'sn_pool_' || y
    ) then
      execute format(
        'create table mes.sn_pool_%s partition of mes.sn_pool for values from (%L) to (%L)',
        y, y_start, y_end
      );
    end if;

    -- ng_pool partition in mes
    if not exists (
      select 1 from pg_tables
      where schemaname = 'mes' and tablename = 'ng_pool_' || y
    ) then
      execute format(
        'create table mes.ng_pool_%s partition of mes.ng_pool for values from (%L) to (%L)',
        y, y_start, y_end
      );
    end if;

    -- Register in management table
    insert into mes.sn_partition_management
      (table_name, partition_name, partition_year, status, row_count)
    values ('sn_pool', 'sn_pool_' || y, y, 'active', 0)
    on conflict do nothing;

    insert into mes.sn_partition_management
      (table_name, partition_name, partition_year, status, row_count)
    values ('ng_pool', 'ng_pool_' || y, y, 'active', 0)
    on conflict do nothing;
  end loop;
end;
$$;

-- ============================================================
-- 12. Monitor view — all partitions status at a glance
-- ============================================================
create or replace view mes.get_sn_partition_status as
  select
    m.table_name,
    m.partition_name,
    m.partition_year,
    m.status,
    m.row_count,
    m.archived_at,
    m.archived_by,
    m.created_at as updated_at,
    case
      when m.status = 'active' then
        (select count(*) from mes.sn_pool where false)  -- placeholder to confirm accessible
      else null
    end as quick_check
  from mes.sn_partition_management m
  order by m.table_name, m.partition_year;

-- ============================================================
-- 13. Archive a single partition manually (example)
-- Usage: SELECT * FROM mes.archive_sn_partition(2023, 'sn_pool', 'admin');
-- ============================================================
