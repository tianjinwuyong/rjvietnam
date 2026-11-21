-- =============================================================================
-- 322: Align the rjvn_* mirror layer with the live terminal WMS snapshot
-- =============================================================================
-- Context
--   The WMS running on the terminal box (10.190.252.248, port 5434) is the
--   live installation.  Its tables were extracted into `sync_stage.wms__*`
--   (26 tables, 10,167 rows) as a single REPEATABLE READ snapshot.
--
--   The mirror layer created by migration 309 predates that snapshot and is
--   missing:
--     · two tables the terminal has and no mirror exists for
--         mes_sync_log   (5,789 rows - MES sync audit)
--         operation_log  (  351 rows - operator audit trail)
--     · sixteen columns the terminal carries that the mirrors lack
--       (oa_* bridge columns added to the WMS by the OA integration, plus
--        mpq / issue_qty / deleted_at data columns).
--
--   Without these the reload in `scripts/etl/wms-terminal-reload.sql` cannot
--   COPY the snapshot in: the target tables either do not exist or silently
--   drop data.
--
-- Scope
--   Schema only.  No data is written here.  Every statement is idempotent, and
--   every ALTER is guarded by `to_regclass` so the migration is a no-op in any
--   environment that has no `rjvn_*` mirrors (production deliberately skipped
--   309/311 and has none).
--
-- Ownership
--   Mirrors are read by the API as the application role, same as migration 309.
-- =============================================================================

-- ── 1. Tables missing from the mirror layer ────────────────────────────────
-- Types/defaults follow the terminal catalog as projected by the staging DDL
-- (enums and composite user refs already collapsed to text / timestamptz).

do $$
begin
  if to_regclass('public.rjvn_mes_sync_log') is null then
    create table public.rjvn_mes_sync_log (
      id          uuid primary key,
      task        varchar,
      status      varchar,
      pulled      integer,
      created     integer,
      updated     integer,
      skipped     integer,
      failed      integer,
      message     text,
      request_id  varchar,
      started_at  timestamptz,
      finished_at timestamptz
    );
    comment on table public.rjvn_mes_sync_log is
      'Mirror of terminal WMS mes_sync_log (MES sync audit trail).';
  end if;

  if to_regclass('public.rjvn_operation_log') is null then
    create table public.rjvn_operation_log (
      id            uuid primary key,
      biz_type      varchar,
      biz_id        uuid,
      biz_no        varchar,
      action        varchar,
      action_detail text,
      operator_id   text,          -- terminal carries a composite user_profile
      operator_name varchar,
      ip_address    varchar,
      _created_at   timestamptz
    );
    comment on table public.rjvn_operation_log is
      'Mirror of terminal WMS operation_log (operator audit trail).';
  end if;
end $$;

-- ── 2. Columns missing from existing mirrors ───────────────────────────────
-- Guarded per table: a database without the mirrors stays unchanged.

do $$
declare
  spec record;
begin
  for spec in
    select * from (values
      -- mirror table             column              type
      ('rjvn_iqc_lot',            'oa_claimed_by',    'character varying'),
      ('rjvn_iqc_lot',            'oa_claimed_at',    'timestamp with time zone'),
      ('rjvn_iqc_lot',            'oa_source',        'character varying'),
      ('rjvn_iqc_report',         'oa_instance_id',   'bigint'),
      ('rjvn_iqc_report',         'oa_status',        'character varying'),
      ('rjvn_iqc_template_item',  'deleted_at',       'timestamp with time zone'),
      ('rjvn_material',           'mpq',              'numeric'),
      ('rjvn_picking_order',      'oa_instance_id',   'bigint'),
      ('rjvn_picking_order',      'oa_status',        'character varying'),
      ('rjvn_picking_order',      'oa_synced_at',     'timestamp with time zone'),
      ('rjvn_picking_order',      'oa_stage',         'character varying'),
      ('rjvn_picking_order_item', 'mpq',              'numeric'),
      ('rjvn_picking_order_item', 'issue_qty',        'numeric'),
      ('rjvn_sys_account',        'oa_user_id',       'bigint'),
      ('rjvn_work_order',         'oa_instance_id',   'bigint'),
      ('rjvn_work_order',         'oa_status',        'character varying')
    ) as v(tbl, col, typ)
  loop
    if to_regclass('public.' || spec.tbl) is not null then
      execute format(
        'alter table public.%I add column if not exists %I %s',
        spec.tbl, spec.col, spec.typ);
    end if;
  end loop;
end $$;

-- ── 3. Ownership（迁移以 postgres 跑，应用以 smt_factory 连）────────────────
do $$
begin
  alter table public.rjvn_mes_sync_log owner to smt_factory;
  alter table public.rjvn_operation_log owner to smt_factory;
exception when undefined_object then
  raise notice 'smt_factory role missing; ownership left as-is';
end $$;