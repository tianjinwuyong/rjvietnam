-- Finance MVP extension — payment ledger, AR aging snapshots, inventory
-- valuation snapshots, and saved report views. Builds on top of the
-- finance/accounting extension (003) and the baseline factory ledger (001).
--
-- invoice_id on payment_records intentionally has no FK constraint so the
-- same column can point at either ar_invoices (direction=IN) or ap_invoices
-- (direction=OUT); the application layer is responsible for the join.

begin;

create table if not exists payment_records (
  id bigserial primary key,
  payment_no varchar(40) not null unique,
  direction varchar(6) not null,
  party_type varchar(20) not null,
  party_id bigint not null,
  invoice_id bigint,
  amount numeric(18, 4) not null,
  currency varchar(12) not null references currencies(code),
  paid_at timestamptz not null,
  method varchar(30) not null,
  reference_no varchar(80),
  memo text,
  created_by bigint references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (direction in ('IN', 'OUT')),
  check (party_type in ('customer', 'supplier')),
  check (amount > 0)
);

create table if not exists ar_aging_snapshots (
  id bigserial primary key,
  snapshot_at timestamptz not null,
  customer_id bigint not null references customers(id),
  bucket_0_30 numeric(18, 4) not null default 0,
  bucket_31_60 numeric(18, 4) not null default 0,
  bucket_61_90 numeric(18, 4) not null default 0,
  over_90 numeric(18, 4) not null default 0,
  total_outstanding numeric(18, 4) GENERATED ALWAYS AS (bucket_0_30 + bucket_31_60 + bucket_61_90 + over_90) STORED,
  currency varchar(12) not null references currencies(code),
  created_at timestamptz not null default now(),
  unique(snapshot_at, customer_id, currency)
);

create table if not exists inventory_valuation_snapshots (
  id bigserial primary key,
  snapshot_at timestamptz not null,
  material_id bigint not null references materials(id),
  storage_location_id bigint references storage_locations(id),
  on_hand_qty numeric(18, 4) not null default 0,
  unit_cost numeric(18, 4) not null default 0,
  total_value numeric(18, 4) GENERATED ALWAYS AS (on_hand_qty * unit_cost) STORED,
  currency varchar(12) not null references currencies(code),
  created_at timestamptz not null default now()
);

create table if not exists finance_reports (
  id bigserial primary key,
  code varchar(40) not null unique,
  name_zh varchar(120) not null,
  name_en varchar(120) not null,
  name_vi varchar(120) not null,
  params jsonb not null default '{}'::jsonb,
  last_run_at timestamptz,
  created_by bigint references users(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_payment_records_invoice on payment_records(invoice_id);
create index if not exists idx_payment_records_party on payment_records(party_type, party_id, paid_at desc);
create index if not exists idx_payment_records_paid_at on payment_records(paid_at desc);
create index if not exists idx_ar_aging_snapshots_customer_time on ar_aging_snapshots(customer_id, snapshot_at desc);
create index if not exists idx_inventory_valuation_snapshots_material_time on inventory_valuation_snapshots(material_id, snapshot_at desc);
create index if not exists idx_inventory_valuation_snapshots_location_time on inventory_valuation_snapshots(storage_location_id, snapshot_at desc);
create index if not exists idx_finance_reports_code on finance_reports(code);

commit;