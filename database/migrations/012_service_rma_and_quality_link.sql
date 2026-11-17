-- Customer Service MVP extension — RMA workflow and quality-data cross-references.
-- Bridges customer_service_tickets (004) with quality_inspections (001) and material_lots.

begin;

create table if not exists rma_requests (
  id bigserial primary key,
  rma_no varchar(40) not null unique,
  customer_id bigint not null references customers(id),
  product_id bigint not null references products(id),
  serial_no varchar(80) not null,
  qty integer not null default 1 check (qty > 0),
  reason_code varchar(40) not null,
  customer_complaint text not null,
  received_at timestamptz,
  inspection_result varchar(20) not null default 'pending'
    check (inspection_result in ('pending','pass','fail','rework')),
  disposition varchar(20)
    check (disposition in ('repair','replace','refund','scrap')),
  status varchar(20) not null default 'draft'
    check (status in ('draft','submitted','received','inspecting','closed','rejected')),
  created_by bigint references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists rma_repair_records (
  id bigserial primary key,
  rma_id bigint not null references rma_requests(id) on delete cascade,
  defect_code_id bigint references defect_codes(id),
  action_taken text not null,
  parts_used text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  operator_id bigint references users(id),
  result varchar(20) not null default 'in_progress'
    check (result in ('in_progress','pass','fail')),
  created_at timestamptz not null default now()
);

-- Bridge table: links customer complaints to quality inspection data for cross-referencing.
create table if not exists complaint_quality_links (
  id bigserial primary key,
  complaint_id bigint not null references customer_service_tickets(id) on delete cascade,
  quality_inspection_id bigint references quality_inspections(id),
  work_order_id bigint references work_orders(id),
  material_lot_id bigint references material_lots(id),
  relation_note text,
  linked_at timestamptz not null default now(),
  linked_by bigint references users(id),
  unique (complaint_id, quality_inspection_id)
);

create index if not exists idx_rma_requests_customer on rma_requests(customer_id, status, created_at desc);
create index if not exists idx_rma_requests_serial on rma_requests(serial_no);
create index if not exists idx_rma_requests_product on rma_requests(product_id, status);
create index if not exists idx_rma_requests_status on rma_requests(status, received_at desc);
create index if not exists idx_rma_repair_records_rma on rma_repair_records(rma_id, started_at desc);
create index if not exists idx_complaint_quality_links_complaint on complaint_quality_links(complaint_id);
create index if not exists idx_complaint_quality_links_inspection on complaint_quality_links(quality_inspection_id);
create index if not exists idx_complaint_quality_links_workorder on complaint_quality_links(work_order_id);
create index if not exists idx_complaint_quality_links_lot on complaint_quality_links(material_lot_id);

commit;