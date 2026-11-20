-- =============================================================================
-- 323: Complete the `oa` schema with the tables/columns the live OA carries
-- =============================================================================
-- Context
--   80 OA tables were extracted from the live OA install (10.190.252.248,
--   port 5433, db oa_system) into `sync_stage.oa__*`.  Compared with the `oa`
--   schema in this database, six tables and thirteen columns were missing, so
--   the snapshot could not be loaded without silently dropping data.
--
--   The live OA also carries the permission "class" subsystem
--   (sys_class / sys_class_policy / sys_position_class / sys_class_audit).
--   Nothing in apps/web or services/api references those tables today — they
--   are imported so the OA deployment is fully represented, not because a
--   route reads them yet.
--
-- Scope
--   Schema only; no rows.  Idempotent, so it is a no-op where the objects
--   already exist.  `create schema if not exists` makes this the single
--   statement that bootstraps an environment (production) that has no `oa`
--   schema at all.
--
-- NOTE for a bare environment: this migration creates only the six tables
--   above.  The other 174 OA tables are bootstrapped from
--   `database/oa/oa_schema_full.sql` (pg_dump of the reference schema) — see
--   that file's header.  Order: bootstrap file first, then migrations.
-- =============================================================================

create schema if not exists oa;

-- ── 1. Tables absent from the reference oa schema ──────────────────────────

create table if not exists oa.doc_print_log (
  id         bigserial primary key,
  doc_id     bigint,
  user_id    bigint,
  result     varchar,
  lang       varchar,
  ip         varchar,
  ua         text,
  created_at timestamptz default now()
);

create table if not exists oa.knowledge_comment (
  id               bigserial primary key,
  doc_id           bigint,
  user_id          bigint,
  content          text,
  parent_id        bigint,
  reply_to_user_id bigint,
  active           boolean default true,
  created_at       timestamptz default now()
);

create table if not exists oa.sys_class (
  code       text primary key,
  name       text,
  name_vi    text,
  sort       integer default 0,
  note       text,
  updated_at timestamptz default now()
);

create table if not exists oa.sys_class_audit (
  id          bigserial primary key,
  kind        text,
  target      text,
  old_value   text,
  new_value   text,
  operator_id bigint,
  created_at  timestamptz default now()
);

create table if not exists oa.sys_class_policy (
  id             bigserial primary key,
  class_code     text,
  module_pattern text,
  level          text,
  priority       integer default 0,
  note           text,
  updated_at     timestamptz default now(),
  updated_by     bigint
);

create table if not exists oa.sys_position_class (
  position_code text primary key,
  class_code    text,
  note          text,
  updated_at    timestamptz default now(),
  updated_by    bigint
);

-- ── 2. Columns absent from existing oa tables ──────────────────────────────
do $$
declare
  spec record;
begin
  for spec in
    select * from (values
      -- table              column             type
      ('doc_review_read',   'content_hash',    'character varying'),
      ('flow_definition',   'timeout_hours',   'numeric'),
      ('flow_definition',   'escalate_hours',  'numeric'),
      ('flow_task',         'assignee_name',   'character varying'),
      ('flow_task',         'assignee_dept',   'character varying'),
      ('flow_task',         'assignee_position', 'character varying'),
      ('flow_task',         'timeout_hours',   'numeric'),
      ('flow_task',         'escalate_count',  'integer'),
      ('flow_task',         'delegate_id',     'bigint'),
      ('flow_task',         'delegate_name',   'character varying'),
      ('flow_task',         'escalate_hours',  'numeric'),
      ('knowledge_doc',     'comment_count',   'integer'),
      ('meeting_series',    'lead_days',       'integer')
    ) as v(tbl, col, typ)
  loop
    if to_regclass('oa.' || spec.tbl) is not null then
      execute format('alter table oa.%I add column if not exists %I %s',
                     spec.tbl, spec.col, spec.typ);
    end if;
  end loop;
end $$;

-- ── 3. Ownership（迁移以 postgres 跑，应用以 smt_factory 连）────────────────
do $$
begin
  alter table oa.doc_print_log      owner to smt_factory;
  alter table oa.knowledge_comment  owner to smt_factory;
  alter table oa.sys_class          owner to smt_factory;
  alter table oa.sys_class_audit    owner to smt_factory;
  alter table oa.sys_class_policy   owner to smt_factory;
  alter table oa.sys_position_class owner to smt_factory;
  alter sequence oa.doc_print_log_id_seq      owner to smt_factory;
  alter sequence oa.knowledge_comment_id_seq  owner to smt_factory;
  alter sequence oa.sys_class_audit_id_seq    owner to smt_factory;
  alter sequence oa.sys_class_policy_id_seq   owner to smt_factory;
exception when undefined_object then
  raise notice 'smt_factory role missing; ownership left as-is';
end $$;