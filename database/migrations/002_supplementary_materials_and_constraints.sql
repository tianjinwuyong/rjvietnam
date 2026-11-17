-- 002: Supplementary materials, reserved_qty, status constraints
-- Covers audit gaps D1, D2, D3, D6

-- D3: Add reserved_qty to material_lots (required by TypeScript type)
alter table material_lots
  add column if not exists reserved_qty numeric(18, 4) not null default 0;

-- D2: Enforce WO status lifecycle at DB level
alter table work_orders
  drop constraint if exists work_orders_status_check;
alter table work_orders
  add constraint work_orders_status_check
  check (status in ('draft', 'released', 'running', 'completed', 'closed', 'voided'));

-- D6: Index inventory_transactions by work_order_id for fast joins
create index if not exists idx_inventory_transactions_work_order
  on inventory_transactions(work_order_id, occurred_at);

-- D1: Supplementary materials table (rule 6.3)
create table if not exists supplementary_materials (
  id bigserial primary key,
  work_order_id bigint not null references work_orders(id),
  material_id bigint not null references materials(id),
  required_qty numeric(18, 4) not null check (required_qty > 0),
  uom varchar(20) not null,
  reason text not null,
  status varchar(20) not null default 'pending'
    check (status in ('pending', 'approved', 'issued', 'closed')),
  requested_by bigint references users(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_supplementary_materials_wo
  on supplementary_materials(work_order_id);
