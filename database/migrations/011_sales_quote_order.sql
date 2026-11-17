-- Sales MVP extension — quotes, orders, and quote-to-workorder traceability link.
-- Bridges customer_pos (PMC) and work_orders so SO→PO→WO conversion is traceable.

begin;

create table if not exists sales_quotes (
  id bigserial primary key,
  quote_no varchar(40) not null unique,
  customer_id bigint not null references customers(id),
  contact_id bigint references customer_contacts(id),
  currency varchar(12) not null references currencies(code),
  valid_until date not null,
  status varchar(20) not null default 'draft'
    check (status in ('draft','sent','accepted','rejected','expired')),
  total_amount numeric(18,4) not null default 0,
  notes text,
  created_by bigint references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists sales_quote_lines (
  id bigserial primary key,
  quote_id bigint not null references sales_quotes(id) on delete cascade,
  line_no smallint not null,
  product_id bigint not null references products(id),
  qty integer not null check (qty > 0),
  unit_price numeric(18,4) not null check (unit_price >= 0),
  lead_time_days integer not null default 30,
  notes text,
  created_at timestamptz not null default now(),
  unique (quote_id, line_no)
);

create table if not exists sales_orders (
  id bigserial primary key,
  so_no varchar(40) not null unique,
  customer_id bigint not null references customers(id),
  quote_id bigint references sales_quotes(id),
  currency varchar(12) not null references currencies(code),
  total_amount numeric(18,4) not null default 0,
  status varchar(20) not null default 'open'
    check (status in ('open','partially_fulfilled','fulfilled','closed','cancelled')),
  created_by bigint references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists sales_order_lines (
  id bigserial primary key,
  so_id bigint not null references sales_orders(id) on delete cascade,
  line_no smallint not null,
  product_id bigint not null references products(id),
  qty integer not null check (qty > 0),
  fulfilled_qty integer not null default 0 check (fulfilled_qty >= 0),
  unit_price numeric(18,4) not null check (unit_price >= 0),
  planned_delivery date not null,
  notes text,
  created_at timestamptz not null default now(),
  unique (so_id, line_no),
  check (fulfilled_qty <= qty)
);

-- Bridge table: links sales_order_lines to customer_pos and work_orders for traceability.
create table if not exists quote_to_workorder_link (
  id bigserial primary key,
  sales_order_line_id bigint not null references sales_order_lines(id) on delete cascade,
  customer_po_id bigint references customer_pos(id),
  work_order_id bigint references work_orders(id),
  linked_at timestamptz not null default now(),
  linked_by bigint references users(id),
  unique (sales_order_line_id, work_order_id)
);

create index if not exists idx_sales_quotes_customer on sales_quotes(customer_id, status, valid_until);
create index if not exists idx_sales_quotes_status on sales_quotes(status, valid_until);
create index if not exists idx_sales_quote_lines_quote on sales_quote_lines(quote_id, line_no);
create index if not exists idx_sales_orders_customer on sales_orders(customer_id, status, created_at desc);
create index if not exists idx_sales_orders_quote on sales_orders(quote_id);
create index if not exists idx_sales_order_lines_so on sales_order_lines(so_id, line_no);
create index if not exists idx_sales_order_lines_product on sales_order_lines(product_id);
create index if not exists idx_quote_to_wo_so on quote_to_workorder_link(sales_order_line_id);
create index if not exists idx_quote_to_wo_po on quote_to_workorder_link(customer_po_id);
create index if not exists idx_quote_to_wo_workorder on quote_to_workorder_link(work_order_id);

commit;