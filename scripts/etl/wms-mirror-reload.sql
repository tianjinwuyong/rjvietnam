-- =============================================================================
-- WMS terminal snapshot -> rjvn_* mirror reload
-- =============================================================================
-- Source : sync_stage.wms__*  — one REPEATABLE READ snapshot of the live WMS on
--          10.190.252.248:5434 (db `wms`), taken 2026-11-20.
-- Target : public.rjvn_*      — the read-through mirror layer created by
--          migration 309 and extended by 322.
--
-- Policy (owner decision, 2026-11-20): the terminal WMS is the live install, so
--   it REPLACES the mirror contents. The mirror layer is a cache of the
--   terminal system; nothing in this repo writes business edits into it.
--
-- Why the WHOLE mirror layer is cleared, not just the 26 captured tables:
--   the terminal has 78 tables and all 78 are mirrored locally. 26 of them hold
--   rows; the other 52 (bom, mrb_*, stock_transfer, sales_*, hr_*, purchase_order,
--   ...) are verified empty on the terminal. The local copies of those 52 still
--   carry rows from the older install (e.g. rjvn_bom_item 461, rjvn_mrb_review 3),
--   and those rows reference material/lot/supplier uuids that this reload
--   replaces. Keeping them would leave the cache pointing at identifiers the
--   terminal no longer has, so they are cleared with the rest. Net effect: after
--   this script every rjvn_* table is an exact image of the terminal table.
--
-- Two tables are deliberately NOT touched, because they are local bookkeeping and
--   not terminal data:
--     rjvn_external_id_map        — uuid -> canonical bigint bridge (ETL state)
--     rjvn_schema_migration_ledger — record of what the terminal has migrated
--
-- Mechanics: one DO block. (1) TRUNCATE every mirror in a single statement, so
-- FK ordering is irrelevant and the cache is never half-written. (2) INSERT from
-- each stage table in dependency order, discovered from the catalogue rather
-- than hard-coded, so a future schema change reorders itself. (3) Verify each
-- mirror's row count against its stage table inside the same transaction.
--
-- Composite `rjvn_user_profile` columns (public.rjvn_user_profile, a composite
-- whose single field is `user_id text`) are rebuilt from the text form `(uuid)`.
-- An empty string is converted to NULL first: '' is not a valid record literal.
-- Everything runs in ONE transaction; any failure rolls the whole reload back.
--
-- Idempotent: re-running produces the same mirror contents.
-- =============================================================================

begin;

-- ── 0. Refuse to run where the stage does not exist or is empty ────────────
-- This script TRUNCATEs the entire rjvn_* mirror layer before reloading it from
-- sync_stage. Run against a database that has no sync_stage (production never
-- does -- the mirrors get there through the ETL dump instead), it empties every
-- mirror and then loads nothing, silently destroying the mirrored data. That
-- happened on 2026-11-20 against rjms. Fail loudly instead.
do $$
declare n_stage bigint; n_tables int;
begin
  if to_regclass('sync_stage.wms__receipt_order') is null then
    raise exception 'MIRROR RELOAD REFUSED: sync_stage is not present in this database. '
                    'This script only runs on the environment that holds the terminal snapshot; '
                    'mirrors elsewhere are loaded from the ETL dump, never truncated in place.';
  end if;
  select count(*) into n_stage from sync_stage.wms__receipt_order;
  if n_stage = 0 then
    raise exception 'MIRROR RELOAD REFUSED: sync_stage.wms__receipt_order is empty. '
                    'Reloading would truncate every rjvn_* table and restore nothing.';
  end if;
  select count(*) into n_tables from pg_tables where schemaname = 'sync_stage';
  if n_tables < 20 then
    raise exception 'MIRROR RELOAD REFUSED: sync_stage has only % tables; expected the full snapshot.', n_tables;
  end if;
  raise notice 'mirror reload preflight ok: sync_stage tables=%, receipt rows=%', n_tables, n_stage;
end $$;

do $$
declare
  mirror_set text;
  pending    text[];
  loaded     text[] := '{}';
  progress   boolean := true;
  stg        text;
  collist    text;
  exprlist   text;
  n_stage    bigint;
  n_mirror   bigint;
  n_total    bigint := 0;
  t_count    int := 0;
begin
  -- ── 1. Clear the whole mirror layer in one statement ─────────────────────
  select string_agg(format('%I', c.relname), ',' order by c.relname)
    into mirror_set
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'r'
     and c.relname like 'rjvn\_%'
     and c.relname not in ('rjvn_external_id_map', 'rjvn_schema_migration_ledger');

  if mirror_set is null then
    raise exception 'no rjvn_* mirror tables found';
  end if;

  execute 'truncate table ' || mirror_set;

  -- ── 2. Load in dependency order ──────────────────────────────────────────
  select array_agg(table_name order by table_name)
    into pending
    from information_schema.tables
   where table_schema = 'sync_stage'
     and table_name like 'wms\_%';

  while cardinality(pending) > 0 loop
    progress := false;

    foreach stg in array pending loop
      -- A stage table is loadable only when every mirror it references is
      -- already loaded; parents outside this set were never truncated, so
      -- their rows still satisfy the constraint.
      --
      -- Self-referencing FKs are excluded (src.relname <> dst.relname):
      -- rjvn_work_order.parent_order_id and rjvn_hr_department.parent_id point
      -- at their own table. A plain `INSERT ... SELECT` checks FKs at END OF
      -- STATEMENT, so rows that reference siblings inside the same batch are
      -- legal — but the dependency test below cannot see that and would
      -- deadlock on the table itself ("dependency cycle"). Both self-FK
      -- columns are entirely NULL in this snapshot anyway.
      if not exists (
        select 1
          from pg_constraint con
          join pg_class src on src.oid = con.conrelid
          join pg_class dst on dst.oid = con.confrelid
         where con.contype = 'f'
           and src.relname = 'rjvn_' || substr(stg, 6)
           and src.relname <> dst.relname
           and dst.relname in (
                 select 'rjvn_' || substr(p, 6) from unnest(pending) p
                  where p <> all (loaded))
      ) then
        -- common columns, target-typed
        select
          string_agg(format('%I', s.column_name), ',' order by s.ordinal_position),
          string_agg(
            case
              when ty.typtype = 'c'
                then format('nullif(s.%I, '''')::%I.%I', s.column_name, ns.nspname, ty.typname)
              else format('s.%I::%s', s.column_name, format_type(a.atttypid, a.atttypmod))
            end,
            ',' order by s.ordinal_position)
        into collist, exprlist
          from information_schema.columns s
          join pg_attribute a
            on a.attrelid = to_regclass('public.rjvn_' || substr(stg, 6))
           and a.attname  = s.column_name
           and a.attnum   > 0
          join pg_type ty on ty.oid = a.atttypid
          join pg_namespace ns on ns.oid = ty.typnamespace
         where s.table_schema = 'sync_stage'
           and s.table_name   = stg;

        if collist is null then
          raise exception 'no common columns between sync_stage.% and public.rjvn_%',
                          stg, substr(stg, 6);
        end if;

        execute format('insert into public.rjvn_%I (%s) select %s from sync_stage.%I s',
                       substr(stg, 6), collist, exprlist, stg);

        execute format('select count(*) from sync_stage.%I', stg) into n_stage;
        execute format('select count(*) from public.rjvn_%I', substr(stg, 6)) into n_mirror;
        if n_mirror <> n_stage then
          raise exception 'row-count mismatch on %: stage=% mirror=%', stg, n_stage, n_mirror;
        end if;

        loaded   := loaded || stg;
        progress := true;
        t_count  := t_count + 1;
        n_total  := n_total + n_stage;
        raise notice '%-26s -> %-26s %6s rows', stg, 'public.rjvn_' || substr(stg, 6), n_stage;
      end if;
    end loop;

    if not progress then
      raise exception 'dependency cycle, cannot order: %', array_to_string(pending, ', ');
    end if;

    select array_agg(x) into pending
      from unnest(pending) x
     where x <> all (loaded);
  end loop;

  raise notice 'RELOAD OK: % tables, % rows', t_count, n_total;
end $$;

commit;