-- 019_bom_edit_history.sql
-- BOM edit history: every CREATE / EDIT / IMPORT / DELETE on a BOM sheet is logged here.

begin;

create table if not exists bom_edit_history (
  id            bigserial primary key,
  bom_id        bigint not null references boms(id),
  action        varchar(20) not null check (action in ('CREATE', 'EDIT', 'IMPORT', 'DELETE')),
  operator_id   bigint references users(id),
  operator_name varchar(120) not null default 'system',
  operated_at   timestamptz not null default now(),
  source        varchar(20) not null default 'FORM' check (source in ('FORM', 'EXCEL', 'API')),
  -- Full BOM snapshot at the moment of the action (all lines as JSON)
  snapshot      jsonb not null,
  -- Human-readable change summary
  change_summary text,
  created_at    timestamptz not null default now()
);

comment on table bom_edit_history is 'BOM sheet edit audit trail — one row per save/create/import/delete.';
comment on column bom_edit_history.snapshot is 'Complete BOM state (header + lines) at the time of the action.';

create index if not exists idx_bom_edit_history_bom_id
  on bom_edit_history (bom_id, operated_at desc);

commit;
