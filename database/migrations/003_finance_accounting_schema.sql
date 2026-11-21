-- Finance and accounting extension for the SMT factory baseline.
-- Adds the minimum GL, AP/AR, shipment billing, cost center, and valuation support
-- needed to treat finance as a first-class module while preserving the factory ledger.

begin;

create table if not exists currencies (
  code varchar(12) primary key,
  name_zh varchar(120) not null,
  name_en varchar(120) not null,
  name_vi varchar(120) not null,
  symbol varchar(12),
  minor_units smallint not null default 2,
  status varchar(20) not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists fiscal_periods (
  id bigserial primary key,
  period_code varchar(20) not null unique,
  period_type varchar(20) not null default 'month',
  start_date date not null,
  end_date date not null,
  status varchar(20) not null default 'open',
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date)
);

create table if not exists gl_accounts (
  id bigserial primary key,
  code varchar(40) not null unique,
  parent_id bigint references gl_accounts(id),
  name_zh varchar(160) not null,
  name_en varchar(160) not null,
  name_vi varchar(160) not null,
  account_type varchar(30) not null,
  normal_balance varchar(10) not null,
  is_postable boolean not null default true,
  status varchar(20) not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists cost_centers (
  id bigserial primary key,
  code varchar(40) not null unique,
  parent_id bigint references cost_centers(id),
  name_zh varchar(160) not null,
  name_en varchar(160) not null,
  name_vi varchar(160) not null,
  center_type varchar(40) not null,
  owner_user_id bigint references users(id),
  status varchar(20) not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists profit_centers (
  id bigserial primary key,
  code varchar(40) not null unique,
  parent_id bigint references profit_centers(id),
  name_zh varchar(160) not null,
  name_en varchar(160) not null,
  name_vi varchar(160) not null,
  center_type varchar(40) not null,
  owner_user_id bigint references users(id),
  status varchar(20) not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists tax_codes (
  id bigserial primary key,
  code varchar(40) not null unique,
  name_zh varchar(160) not null,
  name_en varchar(160) not null,
  name_vi varchar(160) not null,
  tax_type varchar(30) not null,
  rate numeric(8, 4) not null default 0,
  recoverable boolean not null default false,
  status varchar(20) not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists exchange_rates (
  id bigserial primary key,
  rate_date date not null,
  base_currency_code varchar(12) not null references currencies(code),
  quote_currency_code varchar(12) not null references currencies(code),
  rate numeric(18, 8) not null check (rate > 0),
  source varchar(80),
  status varchar(20) not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(rate_date, base_currency_code, quote_currency_code)
);

create table if not exists customer_contacts (
  id bigserial primary key,
  customer_id bigint not null references customers(id) on delete cascade,
  contact_code varchar(60) not null,
  contact_name varchar(120) not null,
  title varchar(120),
  email varchar(160),
  phone varchar(40),
  locale varchar(12) not null default 'en-US',
  is_primary boolean not null default false,
  status varchar(20) not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(customer_id, contact_code)
);

create table if not exists supplier_contacts (
  id bigserial primary key,
  supplier_id bigint not null references suppliers(id) on delete cascade,
  contact_code varchar(60) not null,
  contact_name varchar(120) not null,
  title varchar(120),
  email varchar(160),
  phone varchar(40),
  locale varchar(12) not null default 'en-US',
  is_primary boolean not null default false,
  status varchar(20) not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(supplier_id, contact_code)
);

alter table customers
  add column if not exists account_owner_id bigint references users(id),
  add column if not exists default_currency_code varchar(12) references currencies(code),
  add column if not exists tax_registration_no varchar(80),
  add column if not exists payment_terms_days integer not null default 30;

alter table suppliers
  add column if not exists account_owner_id bigint references users(id),
  add column if not exists default_currency_code varchar(12) references currencies(code),
  add column if not exists tax_registration_no varchar(80),
  add column if not exists payment_terms_days integer not null default 30;

alter table products
  add column if not exists standard_unit_cost numeric(18, 4),
  add column if not exists cost_center_id bigint references cost_centers(id),
  add column if not exists profit_center_id bigint references profit_centers(id);

alter table materials
  add column if not exists standard_unit_cost numeric(18, 4),
  add column if not exists inventory_account_id bigint references gl_accounts(id),
  add column if not exists cogs_account_id bigint references gl_accounts(id);

alter table work_orders
  add column if not exists cost_center_id bigint references cost_centers(id),
  add column if not exists profit_center_id bigint references profit_centers(id),
  add column if not exists standard_cost numeric(18, 4),
  add column if not exists actual_cost numeric(18, 4),
  add column if not exists cost_status varchar(20) not null default 'open',
  add column if not exists cost_posted_at timestamptz;

create table if not exists gl_journal_entries (
  id bigserial primary key,
  entry_no varchar(80) not null unique,
  source_type varchar(40) not null,
  source_no varchar(80) not null,
  entry_type varchar(40) not null,
  period_id bigint references fiscal_periods(id),
  posting_date date not null,
  currency_code varchar(12) not null references currencies(code),
  exchange_rate numeric(18, 8) not null default 1,
  memo text,
  status varchar(20) not null default 'draft',
  created_by bigint references users(id),
  posted_by bigint references users(id),
  posted_at timestamptz,
  reversed_entry_id bigint references gl_journal_entries(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source_type, source_no, entry_type)
);

create table if not exists gl_journal_lines (
  id bigserial primary key,
  entry_id bigint not null references gl_journal_entries(id) on delete cascade,
  line_no integer not null check (line_no > 0),
  account_id bigint not null references gl_accounts(id),
  cost_center_id bigint references cost_centers(id),
  profit_center_id bigint references profit_centers(id),
  supplier_id bigint references suppliers(id),
  customer_id bigint references customers(id),
  work_order_id bigint references work_orders(id),
  material_lot_id bigint references material_lots(id),
  tax_code_id bigint references tax_codes(id),
  description text,
  debit_amount numeric(18, 4) not null default 0,
  credit_amount numeric(18, 4) not null default 0,
  foreign_amount numeric(18, 4),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(entry_id, line_no),
  check (
    (debit_amount > 0 and credit_amount = 0)
    or (credit_amount > 0 and debit_amount = 0)
  )
);

create table if not exists inventory_cost_layers (
  id bigserial primary key,
  layer_no varchar(80) not null unique,
  material_lot_id bigint not null references material_lots(id),
  -- Note: inventory_transaction_id has no FK constraint because inventory_transactions
  -- is partitioned by occurred_at (composite PK), preventing a simple FK reference.
  -- Application/business-rules layer must validate this column.
  inventory_transaction_id bigint,
  source_type varchar(40) not null,
  source_no varchar(80) not null,
  source_line_no integer,
  quantity numeric(18, 4) not null check (quantity > 0),
  remaining_quantity numeric(18, 4) not null check (remaining_quantity >= 0),
  unit_cost numeric(18, 4) not null check (unit_cost >= 0),
  currency_code varchar(12) not null references currencies(code),
  status varchar(20) not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);

create table if not exists work_order_cost_summaries (
  id bigserial primary key,
  work_order_id bigint not null unique references work_orders(id) on delete cascade,
  currency_code varchar(12) not null references currencies(code),
  standard_material_cost numeric(18, 4) not null default 0,
  standard_labor_cost numeric(18, 4) not null default 0,
  standard_overhead_cost numeric(18, 4) not null default 0,
  actual_material_cost numeric(18, 4) not null default 0,
  actual_labor_cost numeric(18, 4) not null default 0,
  actual_overhead_cost numeric(18, 4) not null default 0,
  scrap_cost numeric(18, 4) not null default 0,
  total_standard_cost numeric(18, 4) not null default 0,
  total_actual_cost numeric(18, 4) not null default 0,
  cost_status varchar(20) not null default 'open',
  last_posted_entry_id bigint references gl_journal_entries(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists shipments (
  id bigserial primary key,
  shipment_no varchar(80) not null unique,
  customer_id bigint not null references customers(id),
  customer_po_id bigint references customer_pos(id),
  ship_date date,
  ship_to_name varchar(160),
  ship_to_address text,
  carrier_name varchar(120),
  tracking_no varchar(120),
  status varchar(20) not null default 'draft',
  posting_status varchar(20) not null default 'draft',
  created_by bigint references users(id),
  posted_by bigint references users(id),
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists shipment_lines (
  id bigserial primary key,
  shipment_id bigint not null references shipments(id) on delete cascade,
  line_no integer not null check (line_no > 0),
  customer_po_line_id bigint references customer_po_lines(id),
  work_order_id bigint references work_orders(id),
  product_id bigint not null references products(id),
  shipped_qty numeric(18, 4) not null check (shipped_qty > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(shipment_id, line_no)
);

create table if not exists ap_invoices (
  id bigserial primary key,
  invoice_no varchar(80) not null unique,
  supplier_id bigint not null references suppliers(id),
  receiving_order_id bigint references receiving_orders(id),
  period_id bigint references fiscal_periods(id),
  invoice_date date not null,
  due_date date,
  currency_code varchar(12) not null references currencies(code),
  subtotal_amount numeric(18, 4) not null default 0,
  tax_amount numeric(18, 4) not null default 0,
  total_amount numeric(18, 4) not null default 0,
  paid_amount numeric(18, 4) not null default 0,
  outstanding_amount numeric(18, 4) not null default 0,
  posting_status varchar(20) not null default 'draft',
  payment_status varchar(20) not null default 'unpaid',
  posted_entry_id bigint references gl_journal_entries(id),
  posted_at timestamptz,
  created_by bigint references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists ap_invoice_lines (
  id bigserial primary key,
  ap_invoice_id bigint not null references ap_invoices(id) on delete cascade,
  line_no integer not null check (line_no > 0),
  receiving_order_line_id bigint references receiving_order_lines(id),
  material_id bigint references materials(id),
  description text,
  quantity numeric(18, 4) not null check (quantity > 0),
  unit_price numeric(18, 4) not null check (unit_price >= 0),
  tax_code_id bigint references tax_codes(id),
  line_amount numeric(18, 4) not null check (line_amount >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(ap_invoice_id, line_no)
);

create table if not exists ar_invoices (
  id bigserial primary key,
  invoice_no varchar(80) not null unique,
  customer_id bigint not null references customers(id),
  customer_po_id bigint references customer_pos(id),
  shipment_id bigint references shipments(id),
  period_id bigint references fiscal_periods(id),
  invoice_date date not null,
  due_date date,
  currency_code varchar(12) not null references currencies(code),
  subtotal_amount numeric(18, 4) not null default 0,
  tax_amount numeric(18, 4) not null default 0,
  total_amount numeric(18, 4) not null default 0,
  paid_amount numeric(18, 4) not null default 0,
  outstanding_amount numeric(18, 4) not null default 0,
  posting_status varchar(20) not null default 'draft',
  payment_status varchar(20) not null default 'unpaid',
  posted_entry_id bigint references gl_journal_entries(id),
  posted_at timestamptz,
  created_by bigint references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists ar_invoice_lines (
  id bigserial primary key,
  ar_invoice_id bigint not null references ar_invoices(id) on delete cascade,
  line_no integer not null check (line_no > 0),
  shipment_line_id bigint references shipment_lines(id),
  product_id bigint not null references products(id),
  work_order_id bigint references work_orders(id),
  description text,
  quantity numeric(18, 4) not null check (quantity > 0),
  unit_price numeric(18, 4) not null check (unit_price >= 0),
  tax_code_id bigint references tax_codes(id),
  line_amount numeric(18, 4) not null check (line_amount >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(ar_invoice_id, line_no)
);

alter table currencies
  add constraint currencies_status_check check (status in ('active', 'inactive', 'voided'));

alter table fiscal_periods
  add constraint fiscal_periods_status_check check (status in ('open', 'closed', 'locked', 'voided'));

alter table gl_accounts
  add constraint gl_accounts_type_check check (account_type in ('asset', 'liability', 'equity', 'revenue', 'expense', 'cogs', 'other')),
  add constraint gl_accounts_balance_check check (normal_balance in ('debit', 'credit')),
  add constraint gl_accounts_status_check check (status in ('active', 'inactive', 'voided'));

alter table cost_centers
  add constraint cost_centers_status_check check (status in ('active', 'inactive', 'voided'));

alter table profit_centers
  add constraint profit_centers_status_check check (status in ('active', 'inactive', 'voided'));

alter table tax_codes
  add constraint tax_codes_type_check check (tax_type in ('vat', 'sales_tax', 'withholding', 'import', 'other')),
  add constraint tax_codes_status_check check (status in ('active', 'inactive', 'voided'));

alter table exchange_rates
  add constraint exchange_rates_source_currency_check check (base_currency_code <> quote_currency_code);

alter table customer_contacts
  add constraint customer_contacts_status_check check (status in ('active', 'inactive', 'voided'));

alter table supplier_contacts
  add constraint supplier_contacts_status_check check (status in ('active', 'inactive', 'voided'));

alter table customers
  add constraint customers_finance_terms_check check (payment_terms_days > 0);

alter table suppliers
  add constraint suppliers_finance_terms_check check (payment_terms_days > 0);

alter table work_orders
  add constraint work_orders_cost_status_check check (cost_status in ('open', 'accumulating', 'posted', 'closed', 'voided'));

alter table gl_journal_entries
  add constraint gl_journal_entries_status_check check (status in ('draft', 'posted', 'voided', 'reversed'));

alter table inventory_cost_layers
  add constraint inventory_cost_layers_status_check check (status in ('open', 'consumed', 'closed', 'voided'));

alter table work_order_cost_summaries
  add constraint work_order_cost_summaries_status_check check (cost_status in ('open', 'accumulating', 'posted', 'closed', 'voided'));

alter table shipments
  add constraint shipments_status_check check (status in ('draft', 'packed', 'shipped', 'delivered', 'cancelled', 'voided')),
  add constraint shipments_posting_status_check check (posting_status in ('draft', 'posted', 'voided'));

alter table ap_invoices
  add constraint ap_invoices_posting_status_check check (posting_status in ('draft', 'posted', 'voided')),
  add constraint ap_invoices_payment_status_check check (payment_status in ('unpaid', 'partial', 'paid', 'refunded', 'written_off'));

alter table ar_invoices
  add constraint ar_invoices_posting_status_check check (posting_status in ('draft', 'posted', 'voided')),
  add constraint ar_invoices_payment_status_check check (payment_status in ('unpaid', 'partial', 'paid', 'refunded', 'written_off'));

create index if not exists idx_fiscal_periods_status on fiscal_periods(status, start_date desc);
create index if not exists idx_gl_accounts_parent on gl_accounts(parent_id, code);
create index if not exists idx_cost_centers_parent on cost_centers(parent_id, code);
create index if not exists idx_profit_centers_parent on profit_centers(parent_id, code);
create index if not exists idx_exchange_rates_pair on exchange_rates(base_currency_code, quote_currency_code, rate_date desc);
create index if not exists idx_customer_contacts_customer on customer_contacts(customer_id, is_primary desc, contact_name);
create index if not exists idx_supplier_contacts_supplier on supplier_contacts(supplier_id, is_primary desc, contact_name);
create index if not exists idx_customers_account_owner on customers(account_owner_id, status);
create index if not exists idx_suppliers_account_owner on suppliers(account_owner_id, status);
create index if not exists idx_products_cost_centers on products(cost_center_id, profit_center_id);
create index if not exists idx_materials_accounts on materials(inventory_account_id, cogs_account_id);
create index if not exists idx_work_orders_cost_centers on work_orders(cost_center_id, profit_center_id, status);
create index if not exists idx_gl_journal_entries_source on gl_journal_entries(source_type, source_no, posting_date desc);
create index if not exists idx_gl_journal_entries_status on gl_journal_entries(status, posting_date desc);
create index if not exists idx_gl_journal_lines_entry on gl_journal_lines(entry_id, line_no);
create index if not exists idx_gl_journal_lines_account on gl_journal_lines(account_id, cost_center_id, profit_center_id);
create index if not exists idx_inventory_cost_layers_lot on inventory_cost_layers(material_lot_id, created_at desc);
create index if not exists idx_inventory_cost_layers_tx on inventory_cost_layers(inventory_transaction_id);
create index if not exists idx_work_order_cost_summaries_status on work_order_cost_summaries(cost_status, updated_at desc);
create index if not exists idx_shipments_customer on shipments(customer_id, ship_date desc);
create index if not exists idx_shipments_po on shipments(customer_po_id, ship_date desc);
create index if not exists idx_shipment_lines_shipment on shipment_lines(shipment_id, line_no);
create index if not exists idx_ap_invoices_supplier on ap_invoices(supplier_id, invoice_date desc);
create index if not exists idx_ap_invoices_status on ap_invoices(posting_status, payment_status, due_date);
create index if not exists idx_ap_invoice_lines_invoice on ap_invoice_lines(ap_invoice_id, line_no);
create index if not exists idx_ar_invoices_customer on ar_invoices(customer_id, invoice_date desc);
create index if not exists idx_ar_invoices_status on ar_invoices(posting_status, payment_status, due_date);
create index if not exists idx_ar_invoice_lines_invoice on ar_invoice_lines(ar_invoice_id, line_no);

commit;
