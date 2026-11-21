-- Vietnam Ruijing SMT integrated factory platform
-- PostgreSQL schema with 10-year data retention via annual partitioning
-- Partitioned tables: all station event records, inventory transactions, traceability
-- Unpartitioned: master data, reference data, work orders

-- ============================================================
-- MASTER DATA TABLES (not partitioned - small, stable)
-- ============================================================

create table roles (
  id bigserial primary key,
  code varchar(40) not null unique,
  name_zh varchar(120) not null,
  name_en varchar(120) not null,
  name_vi varchar(120) not null,
  created_at timestamptz not null default now()
);

create table users (
  id bigserial primary key,
  username varchar(80) not null unique,
  display_name varchar(120) not null,
  role_id bigint not null references roles(id),
  locale varchar(12) not null default 'vi-VN',
  status varchar(20) not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table customers (
  id bigserial primary key,
  code varchar(60) not null unique,
  name_zh varchar(160) not null,
  name_en varchar(160) not null,
  name_vi varchar(160) not null,
  status varchar(20) not null default 'active'
);

create table suppliers (
  id bigserial primary key,
  code varchar(60) not null unique,
  name_zh varchar(160) not null,
  name_en varchar(160) not null,
  name_vi varchar(160) not null,
  status varchar(20) not null default 'active'
);

create table products (
  id bigserial primary key,
  code varchar(80) not null unique,
  name_zh varchar(160) not null,
  name_en varchar(160) not null,
  name_vi varchar(160) not null,
  revision varchar(30) not null,
  status varchar(20) not null default 'active'
);

create table materials (
  id bigserial primary key,
  code varchar(80) not null unique,
  name_zh varchar(160) not null,
  name_en varchar(160) not null,
  name_vi varchar(160) not null,
  uom varchar(20) not null,
  material_type varchar(30) not null,
  msd_level varchar(10),
  shelf_life_days integer,
  status varchar(20) not null default 'active'
);

create table boms (
  id bigserial primary key,
  product_id bigint not null references products(id),
  revision varchar(30) not null,
  status varchar(20) not null default 'draft',
  unique(product_id, revision)
);

create table bom_lines (
  id bigserial primary key,
  bom_id bigint not null references boms(id),
  material_id bigint not null references materials(id),
  reference_designators text,
  qty_per numeric(18, 6) not null,
  loss_rate numeric(8, 4) not null default 0
);

-- ============================================================
-- PRODUCTION LINE & STATION REFERENCE TABLES (not partitioned)
-- ============================================================

create table production_lines (
  id bigserial primary key,
  internal_code varchar(40) not null unique,
  numeric_line_code char(2) not null unique,
  name_zh varchar(120) not null,
  name_en varchar(120) not null,
  name_vi varchar(120) not null,
  status varchar(20) not null default 'idle',
  created_at timestamptz not null default now()
);

create table station_types (
  id bigserial primary key,
  code varchar(40) not null unique,
  name_zh varchar(120) not null,
  name_en varchar(120) not null,
  name_vi varchar(120) not null,
  category varchar(20) not null,
  has_hardware bool not null default false,
  has_software bool not null default false,
  created_at timestamptz not null default now()
);

create table stations (
  id bigserial primary key,
  line_id bigint not null references production_lines(id),
  code varchar(50) not null,
  station_type_id bigint not null references station_types(id),
  name_zh varchar(120) not null,
  name_en varchar(120) not null,
  name_vi varchar(120) not null,
  equipment_code varchar(50),
  status varchar(20) not null default 'idle',
  created_at timestamptz not null default now(),
  unique(line_id, code)
);

create table machines (
  id bigserial primary key,
  line_id bigint not null references production_lines(id),
  station_id bigint references stations(id),
  code varchar(50) not null unique,
  machine_type varchar(40) not null,
  brand varchar(80),
  model varchar(80),
  serial_no varchar(80),
  status varchar(20) not null default 'ready',
  created_at timestamptz not null default now()
);

-- ============================================================
-- STORAGE & LOGISTICS (not partitioned - moderate size)
-- ============================================================

create table storage_locations (
  id bigserial primary key,
  code varchar(50) not null unique,
  area varchar(40) not null,
  name_zh varchar(120) not null,
  name_en varchar(120) not null,
  name_vi varchar(120) not null,
  status varchar(20) not null default 'active'
);

-- ============================================================
-- ORDER MANAGEMENT (not partitioned - moderate size)
-- ============================================================

create table customer_pos (
  id bigserial primary key,
  po_number varchar(80) not null unique,
  customer_id bigint not null references customers(id),
  product_id bigint not null references products(id),
  order_qty integer not null check (order_qty > 0),
  due_date date not null,
  status varchar(20) not null default 'confirmed',
  created_at timestamptz not null default now()
);

create table work_order_serial_counters (
  id bigserial primary key,
  yy char(2) not null,
  mm char(2) not null,
  work_order_type smallint not null check (work_order_type in (1, 2, 3)),
  numeric_line_code char(2) not null,
  next_serial integer not null default 1,
  unique(yy, mm, work_order_type, numeric_line_code)
);

create table work_orders (
  id bigserial primary key,
  code char(11) not null unique check (code ~ '^[0-9]{11}$'),
  customer_po_id bigint not null references customer_pos(id),
  product_id bigint not null references products(id),
  line_id bigint not null references production_lines(id),
  work_order_type smallint not null check (work_order_type in (1, 2, 3)),
  planned_qty integer not null check (planned_qty > 0),
  completed_qty integer not null default 0,
  status varchar(20) not null default 'draft',
  released_at timestamptz,
  closed_at timestamptz,
  created_by bigint references users(id),
  created_at timestamptz not null default now()
);

-- ============================================================
-- MATERIAL LOTS (not partitioned - moderate size, has status)
-- ============================================================

create table material_lots (
  id bigserial primary key,
  material_id bigint not null references materials(id),
  supplier_id bigint not null references suppliers(id),
  lot_no varchar(80) not null unique,
  received_qty numeric(18, 4) not null check (received_qty > 0),
  iqc_status varchar(20) not null default 'pending',
  msd_sealed_at timestamptz,
  msd_exposure_start timestamptz,
  baking_required bool not null default false,
  baking_status varchar(20),
  created_at timestamptz not null default now()
);

create table defect_codes (
  id bigserial primary key,
  code varchar(80) not null unique,
  name_zh varchar(160) not null,
  name_en varchar(160) not null,
  name_vi varchar(160) not null,
  severity varchar(20) not null default 'major'
);

-- ============================================================
-- FEEDER & PCB SERIAL MANAGEMENT (not partitioned)
-- ============================================================

create table feeder_bindings (
  id bigserial primary key,
  work_order_id bigint not null references work_orders(id),
  line_id bigint not null references production_lines(id),
  machine_id bigint not null references machines(id),
  material_lot_id bigint not null references material_lots(id),
  feeder_no varchar(30) not null,
  reel_code varchar(80) not null,
  operator_id bigint not null references users(id),
  bound_at timestamptz not null default now(),
  unbound_at timestamptz
);

create table pcb_serials (
  id bigserial primary key,
  serial_no varchar(80) not null unique,
  work_order_id bigint not null references work_orders(id),
  status varchar(20) not null default 'wip',
  created_at timestamptz not null default now()
);

-- ============================================================
-- QUALITY & REPAIR (not partitioned - moderate size)
-- ============================================================

create table quality_inspections (
  id bigserial primary key,
  inspection_no varchar(80) not null unique,
  work_order_id bigint references work_orders(id),
  pcb_serial_id bigint references pcb_serials(id),
  station_type varchar(40) not null,
  result varchar(20) not null,
  operator_id bigint not null references users(id),
  occurred_at timestamptz not null default now()
);

create table repair_records (
  id bigserial primary key,
  repair_no varchar(80) not null unique,
  inspection_id bigint not null references quality_inspections(id),
  defect_code_id bigint not null references defect_codes(id),
  action_taken text not null,
  result varchar(20) not null default 'closed',
  operator_id bigint not null references users(id),
  closed_at timestamptz not null default now()
);

-- ============================================================
-- PARTITIONED TABLES - 10-year retention via annual partitions
-- All use RANGE partitioning on occurred_at / created_at / marked_at
-- ============================================================

-- Base partitioned table template:
-- CREATE TABLE parent () PARTITION BY RANGE (col);
-- CREATE TABLE child_2026 PARTITION OF parent FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');
-- Indexes on partition key + foreign keys go on parent; PG propagates to children

-- ── INVENTORY TRANSACTIONS (partitioned) ──────────────────────
create table inventory_transactions (
  id bigserial,
  tx_no varchar(80) not null,
  action varchar(30) not null,
  material_lot_id bigint not null,
  work_order_id bigint,
  qty numeric(18, 4) not null,
  from_location_id bigint,
  to_location_id bigint,
  operator_id bigint not null,
  occurred_at timestamptz not null default now(),
  primary key (id, occurred_at)
) partition by range (occurred_at);

create table inventory_transactions_2026 partition of inventory_transactions
  for values from ('2026-01-01') to ('2027-01-01');
create table inventory_transactions_2027 partition of inventory_transactions
  for values from ('2027-01-01') to ('2028-01-01');
create table inventory_transactions_2028 partition of inventory_transactions
  for values from ('2028-01-01') to ('2029-01-01');
create table inventory_transactions_2029 partition of inventory_transactions
  for values from ('2029-01-01') to ('2030-01-01');
create table inventory_transactions_2030 partition of inventory_transactions
  for values from ('2030-01-01') to ('2031-01-01');
create table inventory_transactions_2031 partition of inventory_transactions
  for values from ('2031-01-01') to ('2032-01-01');
create table inventory_transactions_2033 partition of inventory_transactions
  for values from ('2033-01-01') to ('2034-01-01');
create table inventory_transactions_2034 partition of inventory_transactions
  for values from ('2034-01-01') to ('2035-01-01');
create table inventory_transactions_2035 partition of inventory_transactions
  for values from ('2035-01-01') to ('2036-01-01');
create index idx_inv_tx_lot on inventory_transactions(material_lot_id, occurred_at);

-- ── TRACEABILITY EVENTS (partitioned) ────────────────────────
create table traceability_events (
  id bigserial,
  trace_key varchar(120) not null,
  event_type varchar(50) not null,
  reference_no varchar(120) not null,
  status varchar(40) not null,
  actor varchar(120) not null,
  event_payload jsonb not null default '{}',
  occurred_at timestamptz not null default now(),
  primary key (id, occurred_at)
) partition by range (occurred_at);

create table traceability_events_2026 partition of traceability_events
  for values from ('2026-01-01') to ('2027-01-01');
create table traceability_events_2027 partition of traceability_events
  for values from ('2027-01-01') to ('2028-01-01');
create table traceability_events_2028 partition of traceability_events
  for values from ('2028-01-01') to ('2029-01-01');
create table traceability_events_2029 partition of traceability_events
  for values from ('2029-01-01') to ('2030-01-01');
create table traceability_events_2030 partition of traceability_events
  for values from ('2030-01-01') to ('2031-01-01');
create table traceability_events_2031 partition of traceability_events
  for values from ('2031-01-01') to ('2032-01-01');
create table traceability_events_2032 partition of traceability_events
  for values from ('2032-01-01') to ('2033-01-01');
create table traceability_events_2033 partition of traceability_events
  for values from ('2033-01-01') to ('2034-01-01');
create table traceability_events_2034 partition of traceability_events
  for values from ('2034-01-01') to ('2035-01-01');
create table traceability_events_2035 partition of traceability_events
  for values from ('2035-01-01') to ('2036-01-01');
create index idx_trace_events_key on traceability_events(trace_key, occurred_at);

-- ── STATION EVENTS (partitioned) ──────────────────────────────
create table station_events (
  id bigserial,
  pcb_serial_id bigint not null,
  station_id bigint not null,
  machine_id bigint,
  operator_id bigint,
  event_type varchar(40) not null,
  result varchar(20) not null,
  occurred_at timestamptz not null default now(),
  primary key (id, occurred_at)
) partition by range (occurred_at);

create table station_events_2026 partition of station_events
  for values from ('2026-01-01') to ('2027-01-01');
create table station_events_2027 partition of station_events
  for values from ('2027-01-01') to ('2028-01-01');
create table station_events_2028 partition of station_events
  for values from ('2028-01-01') to ('2029-01-01');
create table station_events_2029 partition of station_events
  for values from ('2029-01-01') to ('2030-01-01');
create table station_events_2030 partition of station_events
  for values from ('2030-01-01') to ('2031-01-01');
create table station_events_2031 partition of station_events
  for values from ('2031-01-01') to ('2032-01-01');
create table station_events_2032 partition of station_events
  for values from ('2032-01-01') to ('2033-01-01');
create table station_events_2033 partition of station_events
  for values from ('2033-01-01') to ('2034-01-01');
create table station_events_2034 partition of station_events
  for values from ('2034-01-01') to ('2035-01-01');
create table station_events_2035 partition of station_events
  for values from ('2035-01-01') to ('2036-01-01');
create index idx_station_events_pcb on station_events(pcb_serial_id, occurred_at);

-- ── PCB LASER MARKING (partitioned) ───────────────────────────
create table pcb_laser_marking (
  id bigserial,
  pcb_serial_id bigint,
  work_order_id bigint,
  machine_id bigint,
  operator_id bigint,
  marked_at timestamptz not null default now(),
  primary key (id, marked_at)
) partition by range (marked_at);

create table pcb_laser_marking_2026 partition of pcb_laser_marking for values from ('2026-01-01') to ('2027-01-01');
create table pcb_laser_marking_2027 partition of pcb_laser_marking for values from ('2027-01-01') to ('2028-01-01');
create table pcb_laser_marking_2028 partition of pcb_laser_marking for values from ('2028-01-01') to ('2029-01-01');
create table pcb_laser_marking_2029 partition of pcb_laser_marking for values from ('2029-01-01') to ('2030-01-01');
create table pcb_laser_marking_2030 partition of pcb_laser_marking for values from ('2030-01-01') to ('2031-01-01');
create table pcb_laser_marking_2031 partition of pcb_laser_marking for values from ('2031-01-01') to ('2032-01-01');
create table pcb_laser_marking_2032 partition of pcb_laser_marking for values from ('2032-01-01') to ('2033-01-01');
create table pcb_laser_marking_2033 partition of pcb_laser_marking for values from ('2033-01-01') to ('2034-01-01');
create table pcb_laser_marking_2034 partition of pcb_laser_marking for values from ('2034-01-01') to ('2035-01-01');
create table pcb_laser_marking_2035 partition of pcb_laser_marking for values from ('2035-01-01') to ('2036-01-01');
create index idx_laser_pcb on pcb_laser_marking(pcb_serial_id, marked_at);

-- ── AI INSERTION RECORDS (partitioned) ────────────────────────
create table ai_insert_records (
  id bigserial,
  pcb_serial_id bigint not null,
  work_order_id bigint not null,
  station_id bigint not null,
  machine_id bigint,
  component_code varchar(80) not null,
  insert_position varchar(40) not null,
  result varchar(20) not null,
  operator_id bigint,
  occurred_at timestamptz not null default now(),
  primary key (id, occurred_at)
) partition by range (occurred_at);

create table ai_insert_records_2026 partition of ai_insert_records for values from ('2026-01-01') to ('2027-01-01');
create table ai_insert_records_2027 partition of ai_insert_records for values from ('2027-01-01') to ('2028-01-01');
create table ai_insert_records_2028 partition of ai_insert_records for values from ('2028-01-01') to ('2029-01-01');
create table ai_insert_records_2029 partition of ai_insert_records for values from ('2029-01-01') to ('2030-01-01');
create table ai_insert_records_2030 partition of ai_insert_records for values from ('2030-01-01') to ('2031-01-01');
create table ai_insert_records_2031 partition of ai_insert_records for values from ('2031-01-01') to ('2032-01-01');
create table ai_insert_records_2032 partition of ai_insert_records for values from ('2032-01-01') to ('2033-01-01');
create table ai_insert_records_2033 partition of ai_insert_records for values from ('2033-01-01') to ('2034-01-01');
create table ai_insert_records_2034 partition of ai_insert_records for values from ('2034-01-01') to ('2035-01-01');
create table ai_insert_records_2035 partition of ai_insert_records for values from ('2035-01-01') to ('2036-01-01');
create index idx_ai_insert_pcb on ai_insert_records(pcb_serial_id, occurred_at);

-- ── SMT PLACEMENT RECORDS (partitioned) ───────────────────────
create table smt_placement_records (
  id bigserial,
  pcb_serial_id bigint not null,
  work_order_id bigint not null,
  station_id bigint not null,
  machine_id bigint,
  feeder_binding_id bigint,
  component_code varchar(80) not null,
  reference_designator varchar(40) not null,
  result varchar(20) not null,
  operator_id bigint,
  occurred_at timestamptz not null default now(),
  primary key (id, occurred_at)
) partition by range (occurred_at);

create table smt_placement_records_2026 partition of smt_placement_records for values from ('2026-01-01') to ('2027-01-01');
create table smt_placement_records_2027 partition of smt_placement_records for values from ('2027-01-01') to ('2028-01-01');
create table smt_placement_records_2028 partition of smt_placement_records for values from ('2028-01-01') to ('2029-01-01');
create table smt_placement_records_2029 partition of smt_placement_records for values from ('2029-01-01') to ('2030-01-01');
create table smt_placement_records_2030 partition of smt_placement_records for values from ('2030-01-01') to ('2031-01-01');
create table smt_placement_records_2031 partition of smt_placement_records for values from ('2031-01-01') to ('2032-01-01');
create table smt_placement_records_2032 partition of smt_placement_records for values from ('2032-01-01') to ('2033-01-01');
create table smt_placement_records_2033 partition of smt_placement_records for values from ('2033-01-01') to ('2034-01-01');
create table smt_placement_records_2034 partition of smt_placement_records for values from ('2034-01-01') to ('2035-01-01');
create table smt_placement_records_2035 partition of smt_placement_records for values from ('2035-01-01') to ('2036-01-01');
create index idx_smt_place_pcb on smt_placement_records(pcb_serial_id, occurred_at);

-- ── SPI INSPECTION RECORDS (partitioned) ──────────────────────
create table spire_inspection_records (
  id bigserial,
  pcb_serial_id bigint,
  work_order_id bigint,
  station_id bigint not null,
  machine_id bigint,
  result varchar(20) not null,
  defect_count integer,
  spi_data jsonb,
  operator_id bigint,
  occurred_at timestamptz not null default now(),
  primary key (id, occurred_at)
) partition by range (occurred_at);

create table spire_inspection_records_2026 partition of spire_inspection_records for values from ('2026-01-01') to ('2027-01-01');
create table spire_inspection_records_2027 partition of spire_inspection_records for values from ('2027-01-01') to ('2028-01-01');
create table spire_inspection_records_2028 partition of spire_inspection_records for values from ('2028-01-01') to ('2029-01-01');
create table spire_inspection_records_2029 partition of spire_inspection_records for values from ('2029-01-01') to ('2030-01-01');
create table spire_inspection_records_2030 partition of spire_inspection_records for values from ('2030-01-01') to ('2031-01-01');
create table spire_inspection_records_2031 partition of spire_inspection_records for values from ('2031-01-01') to ('2032-01-01');
create table spire_inspection_records_2032 partition of spire_inspection_records for values from ('2032-01-01') to ('2033-01-01');
create table spire_inspection_records_2033 partition of spire_inspection_records for values from ('2033-01-01') to ('2034-01-01');
create table spire_inspection_records_2034 partition of spire_inspection_records for values from ('2034-01-01') to ('2035-01-01');
create table spire_inspection_records_2035 partition of spire_inspection_records for values from ('2035-01-01') to ('2036-01-01');
create index idx_spire_pcb on spire_inspection_records(pcb_serial_id, occurred_at);

-- ── AOI INSPECTION RECORDS (partitioned) ──────────────────────
create table aoi_inspection_records (
  id bigserial,
  pcb_serial_id bigint,
  work_order_id bigint,
  station_id bigint not null,
  machine_id bigint,
  result varchar(20) not null,
  defect_count integer,
  defect_codes varchar(80)[],
  defect_images jsonb,
  misreport_rate numeric(8,4),
  operator_id bigint,
  occurred_at timestamptz not null default now(),
  primary key (id, occurred_at)
) partition by range (occurred_at);

create table aoi_inspection_records_2026 partition of aoi_inspection_records for values from ('2026-01-01') to ('2027-01-01');
create table aoi_inspection_records_2027 partition of aoi_inspection_records for values from ('2027-01-01') to ('2028-01-01');
create table aoi_inspection_records_2028 partition of aoi_inspection_records for values from ('2028-01-01') to ('2029-01-01');
create table aoi_inspection_records_2029 partition of aoi_inspection_records for values from ('2029-01-01') to ('2030-01-01');
create table aoi_inspection_records_2030 partition of aoi_inspection_records for values from ('2030-01-01') to ('2031-01-01');
create table aoi_inspection_records_2031 partition of aoi_inspection_records for values from ('2031-01-01') to ('2032-01-01');
create table aoi_inspection_records_2032 partition of aoi_inspection_records for values from ('2032-01-01') to ('2033-01-01');
create table aoi_inspection_records_2033 partition of aoi_inspection_records for values from ('2033-01-01') to ('2034-01-01');
create table aoi_inspection_records_2034 partition of aoi_inspection_records for values from ('2034-01-01') to ('2035-01-01');
create table aoi_inspection_records_2035 partition of aoi_inspection_records for values from ('2035-01-01') to ('2036-01-01');
create index idx_aoi_pcb on aoi_inspection_records(pcb_serial_id, occurred_at);

-- ── PCBA LOADING RECORDS (partitioned) ─────────────────────────
create table pcba_loading_records (
  id bigserial,
  pcb_serial_id bigint,
  work_order_id bigint,
  station_id bigint not null,
  operator_id bigint,
  msd_level varchar(10),
  exposure_start timestamptz,
  exposure_hours numeric(10,2),
  status varchar(20) not null default 'loaded',
  occurred_at timestamptz not null default now(),
  primary key (id, occurred_at)
) partition by range (occurred_at);

create table pcba_loading_records_2026 partition of pcba_loading_records for values from ('2026-01-01') to ('2027-01-01');
create table pcba_loading_records_2027 partition of pcba_loading_records for values from ('2027-01-01') to ('2028-01-01');
create table pcba_loading_records_2028 partition of pcba_loading_records for values from ('2028-01-01') to ('2029-01-01');
create table pcba_loading_records_2029 partition of pcba_loading_records for values from ('2029-01-01') to ('2030-01-01');
create table pcba_loading_records_2030 partition of pcba_loading_records for values from ('2030-01-01') to ('2031-01-01');
create table pcba_loading_records_2031 partition of pcba_loading_records for values from ('2031-01-01') to ('2032-01-01');
create table pcba_loading_records_2032 partition of pcba_loading_records for values from ('2032-01-01') to ('2033-01-01');
create table pcba_loading_records_2033 partition of pcba_loading_records for values from ('2033-01-01') to ('2034-01-01');
create table pcba_loading_records_2034 partition of pcba_loading_records for values from ('2034-01-01') to ('2035-01-01');
create table pcba_loading_records_2035 partition of pcba_loading_records for values from ('2035-01-01') to ('2036-01-01');
create index idx_pcba_load_pcb on pcba_loading_records(pcb_serial_id, occurred_at);

-- ── PDA SCAN RECORDS (partitioned) ─────────────────────────────
create table pda_scan_records (
  id bigserial,
  pcb_serial_id bigint,
  work_order_id bigint,
  station_id bigint not null,
  operator_id bigint,
  barcode varchar(80) not null,
  barcode_type varchar(30) not null,
  scanned_at timestamptz not null default now(),
  primary key (id, scanned_at)
) partition by range (scanned_at);

create table pda_scan_records_2026 partition of pda_scan_records for values from ('2026-01-01') to ('2027-01-01');
create table pda_scan_records_2027 partition of pda_scan_records for values from ('2027-01-01') to ('2028-01-01');
create table pda_scan_records_2028 partition of pda_scan_records for values from ('2028-01-01') to ('2029-01-01');
create table pda_scan_records_2029 partition of pda_scan_records for values from ('2029-01-01') to ('2030-01-01');
create table pda_scan_records_2030 partition of pda_scan_records for values from ('2030-01-01') to ('2031-01-01');
create table pda_scan_records_2031 partition of pda_scan_records for values from ('2031-01-01') to ('2032-01-01');
create table pda_scan_records_2032 partition of pda_scan_records for values from ('2032-01-01') to ('2033-01-01');
create table pda_scan_records_2033 partition of pda_scan_records for values from ('2033-01-01') to ('2034-01-01');
create table pda_scan_records_2034 partition of pda_scan_records for values from ('2034-01-01') to ('2035-01-01');
create table pda_scan_records_2035 partition of pda_scan_records for values from ('2035-01-01') to ('2036-01-01');
create index idx_pda_scan_pcb on pda_scan_records(pcb_serial_id, scanned_at);

-- ── WS-AOI INSPECTION RECORDS (partitioned) ────────────────────
create table wsaoi_inspection_records (
  id bigserial,
  pcb_serial_id bigint,
  work_order_id bigint,
  station_id bigint not null,
  machine_id bigint,
  result varchar(20) not null,
  defect_count integer,
  defect_codes varchar(80)[],
  defect_images jsonb,
  operator_id bigint,
  occurred_at timestamptz not null default now(),
  primary key (id, occurred_at)
) partition by range (occurred_at);

create table wsaoi_inspection_records_2026 partition of wsaoi_inspection_records for values from ('2026-01-01') to ('2027-01-01');
create table wsaoi_inspection_records_2027 partition of wsaoi_inspection_records for values from ('2027-01-01') to ('2028-01-01');
create table wsaoi_inspection_records_2028 partition of wsaoi_inspection_records for values from ('2028-01-01') to ('2029-01-01');
create table wsaoi_inspection_records_2029 partition of wsaoi_inspection_records for values from ('2029-01-01') to ('2030-01-01');
create table wsaoi_inspection_records_2030 partition of wsaoi_inspection_records for values from ('2030-01-01') to ('2031-01-01');
create table wsaoi_inspection_records_2031 partition of wsaoi_inspection_records for values from ('2031-01-01') to ('2032-01-01');
create table wsaoi_inspection_records_2032 partition of wsaoi_inspection_records for values from ('2032-01-01') to ('2033-01-01');
create table wsaoi_inspection_records_2033 partition of wsaoi_inspection_records for values from ('2033-01-01') to ('2034-01-01');
create table wsaoi_inspection_records_2034 partition of wsaoi_inspection_records for values from ('2034-01-01') to ('2035-01-01');
create table wsaoi_inspection_records_2035 partition of wsaoi_inspection_records for values from ('2035-01-01') to ('2036-01-01');
create index idx_wsaoi_pcb on wsaoi_inspection_records(pcb_serial_id, occurred_at);

-- ── ICT TEST RECORDS (partitioned) ─────────────────────────────
create table ict_test_records (
  id bigserial,
  pcb_serial_id bigint not null,
  work_order_id bigint not null,
  station_id bigint not null,
  machine_id bigint,
  test_no varchar(80) not null,
  result varchar(20) not null,
  measurements jsonb,
  pass_points integer,
  fail_points integer,
  operator_id bigint,
  occurred_at timestamptz not null default now(),
  primary key (id, occurred_at)
) partition by range (occurred_at);

create table ict_test_records_2026 partition of ict_test_records for values from ('2026-01-01') to ('2027-01-01');
create table ict_test_records_2027 partition of ict_test_records for values from ('2027-01-01') to ('2028-01-01');
create table ict_test_records_2028 partition of ict_test_records for values from ('2028-01-01') to ('2029-01-01');
create table ict_test_records_2029 partition of ict_test_records for values from ('2029-01-01') to ('2030-01-01');
create table ict_test_records_2030 partition of ict_test_records for values from ('2030-01-01') to ('2031-01-01');
create table ict_test_records_2031 partition of ict_test_records for values from ('2031-01-01') to ('2032-01-01');
create table ict_test_records_2032 partition of ict_test_records for values from ('2032-01-01') to ('2033-01-01');
create table ict_test_records_2033 partition of ict_test_records for values from ('2033-01-01') to ('2034-01-01');
create table ict_test_records_2034 partition of ict_test_records for values from ('2034-01-01') to ('2035-01-01');
create table ict_test_records_2035 partition of ict_test_records for values from ('2035-01-01') to ('2036-01-01');
create unique index idx_ict_test_no on ict_test_records(test_no, occurred_at);
create index idx_ict_pcb on ict_test_records(pcb_serial_id, occurred_at);

-- ── FCT TEST RECORDS (partitioned) ─────────────────────────────
create table fct_test_records (
  id bigserial,
  pcb_serial_id bigint not null,
  work_order_id bigint not null,
  station_id bigint not null,
  machine_id bigint,
  test_no varchar(80) not null,
  result varchar(20) not null,
  measurements jsonb,
  test_data jsonb,
  operator_id bigint,
  occurred_at timestamptz not null default now(),
  primary key (id, occurred_at)
) partition by range (occurred_at);

create table fct_test_records_2026 partition of fct_test_records for values from ('2026-01-01') to ('2027-01-01');
create table fct_test_records_2027 partition of fct_test_records for values from ('2027-01-01') to ('2028-01-01');
create table fct_test_records_2028 partition of fct_test_records for values from ('2028-01-01') to ('2029-01-01');
create table fct_test_records_2029 partition of fct_test_records for values from ('2029-01-01') to ('2030-01-01');
create table fct_test_records_2030 partition of fct_test_records for values from ('2030-01-01') to ('2031-01-01');
create table fct_test_records_2031 partition of fct_test_records for values from ('2031-01-01') to ('2032-01-01');
create table fct_test_records_2032 partition of fct_test_records for values from ('2032-01-01') to ('2033-01-01');
create table fct_test_records_2033 partition of fct_test_records for values from ('2033-01-01') to ('2034-01-01');
create table fct_test_records_2034 partition of fct_test_records for values from ('2034-01-01') to ('2035-01-01');
create table fct_test_records_2035 partition of fct_test_records for values from ('2035-01-01') to ('2036-01-01');
create unique index idx_fct_test_no on fct_test_records(test_no, occurred_at);
create index idx_fct_pcb on fct_test_records(pcb_serial_id, occurred_at);

-- ── DEPANEL RECORDS (partitioned) ──────────────────────────────
create table depanel_records (
  id bigserial,
  pcb_serial_id bigint not null,
  work_order_id bigint not null,
  station_id bigint not null,
  machine_id bigint,
  panel_sn varchar(80) not null,
  routing_params jsonb,
  router_bit_used varchar(40),
  router_bit_life_used numeric(10,2),
  result varchar(20) not null,
  operator_id bigint,
  occurred_at timestamptz not null default now(),
  primary key (id, occurred_at)
) partition by range (occurred_at);

create table depanel_records_2026 partition of depanel_records for values from ('2026-01-01') to ('2027-01-01');
create table depanel_records_2027 partition of depanel_records for values from ('2027-01-01') to ('2028-01-01');
create table depanel_records_2028 partition of depanel_records for values from ('2028-01-01') to ('2029-01-01');
create table depanel_records_2029 partition of depanel_records for values from ('2029-01-01') to ('2030-01-01');
create table depanel_records_2030 partition of depanel_records for values from ('2030-01-01') to ('2031-01-01');
create table depanel_records_2031 partition of depanel_records for values from ('2031-01-01') to ('2032-01-01');
create table depanel_records_2032 partition of depanel_records for values from ('2032-01-01') to ('2033-01-01');
create table depanel_records_2033 partition of depanel_records for values from ('2033-01-01') to ('2034-01-01');
create table depanel_records_2034 partition of depanel_records for values from ('2034-01-01') to ('2035-01-01');
create table depanel_records_2035 partition of depanel_records for values from ('2035-01-01') to ('2036-01-01');
create index idx_depanel_pcb on depanel_records(pcb_serial_id, occurred_at);

-- ── SN BINDING RECORDS (partitioned) ──────────────────────────
create table sn_binding_records (
  id bigserial,
  work_order_id bigint not null,
  binding_type varchar(20) not null,
  sn_a varchar(80) not null,
  sn_b varchar(80) not null,
  station_id bigint not null,
  operator_id bigint,
  bound_at timestamptz not null default now(),
  primary key (id, bound_at)
) partition by range (bound_at);

create table sn_binding_records_2026 partition of sn_binding_records for values from ('2026-01-01') to ('2027-01-01');
create table sn_binding_records_2027 partition of sn_binding_records for values from ('2027-01-01') to ('2028-01-01');
create table sn_binding_records_2028 partition of sn_binding_records for values from ('2028-01-01') to ('2029-01-01');
create table sn_binding_records_2029 partition of sn_binding_records for values from ('2029-01-01') to ('2030-01-01');
create table sn_binding_records_2030 partition of sn_binding_records for values from ('2030-01-01') to ('2031-01-01');
create table sn_binding_records_2031 partition of sn_binding_records for values from ('2031-01-01') to ('2032-01-01');
create table sn_binding_records_2032 partition of sn_binding_records for values from ('2032-01-01') to ('2033-01-01');
create table sn_binding_records_2033 partition of sn_binding_records for values from ('2033-01-01') to ('2034-01-01');
create table sn_binding_records_2034 partition of sn_binding_records for values from ('2034-01-01') to ('2035-01-01');
create table sn_binding_records_2035 partition of sn_binding_records for values from ('2035-01-01') to ('2036-01-01');
create index idx_sn_bind_wo on sn_binding_records(work_order_id, bound_at);

-- ── ATE TEST RECORDS (partitioned) ─────────────────────────────
create table ate_test_records (
  id bigserial,
  pcb_serial_id bigint not null,
  work_order_id bigint not null,
  station_id bigint not null,
  machine_id bigint,
  test_no varchar(80) not null,
  ate_stage varchar(10) not null,
  result varchar(20) not null,
  test_data jsonb,
  measurements jsonb,
  operator_id bigint,
  occurred_at timestamptz not null default now(),
  primary key (id, occurred_at)
) partition by range (occurred_at);

create table ate_test_records_2026 partition of ate_test_records for values from ('2026-01-01') to ('2027-01-01');
create table ate_test_records_2027 partition of ate_test_records for values from ('2027-01-01') to ('2028-01-01');
create table ate_test_records_2028 partition of ate_test_records for values from ('2028-01-01') to ('2029-01-01');
create table ate_test_records_2029 partition of ate_test_records for values from ('2029-01-01') to ('2030-01-01');
create table ate_test_records_2030 partition of ate_test_records for values from ('2030-01-01') to ('2031-01-01');
create table ate_test_records_2031 partition of ate_test_records for values from ('2031-01-01') to ('2032-01-01');
create table ate_test_records_2032 partition of ate_test_records for values from ('2032-01-01') to ('2033-01-01');
create table ate_test_records_2033 partition of ate_test_records for values from ('2033-01-01') to ('2034-01-01');
create table ate_test_records_2034 partition of ate_test_records for values from ('2034-01-01') to ('2035-01-01');
create table ate_test_records_2035 partition of ate_test_records for values from ('2035-01-01') to ('2036-01-01');
create unique index idx_ate_test_no on ate_test_records(test_no, occurred_at);
create index idx_ate_pcb on ate_test_records(pcb_serial_id, occurred_at);

-- ── ULTRASONIC RECORDS (partitioned) ──────────────────────────
create table ultrasonic_records (
  id bigserial,
  pcb_serial_id bigint,
  work_order_id bigint,
  station_id bigint not null,
  machine_id bigint,
  welding_mode varchar(40),
  amplitude numeric(10,2),
  weld_time_ms integer,
  cool_time_ms integer,
  delay_time_ms integer,
  result varchar(20) not null,
  parameters jsonb,
  operator_id bigint,
  occurred_at timestamptz not null default now(),
  primary key (id, occurred_at)
) partition by range (occurred_at);

create table ultrasonic_records_2026 partition of ultrasonic_records for values from ('2026-01-01') to ('2027-01-01');
create table ultrasonic_records_2027 partition of ultrasonic_records for values from ('2027-01-01') to ('2028-01-01');
create table ultrasonic_records_2028 partition of ultrasonic_records for values from ('2028-01-01') to ('2029-01-01');
create table ultrasonic_records_2029 partition of ultrasonic_records for values from ('2029-01-01') to ('2030-01-01');
create table ultrasonic_records_2030 partition of ultrasonic_records for values from ('2030-01-01') to ('2031-01-01');
create table ultrasonic_records_2031 partition of ultrasonic_records for values from ('2031-01-01') to ('2032-01-01');
create table ultrasonic_records_2032 partition of ultrasonic_records for values from ('2032-01-01') to ('2033-01-01');
create table ultrasonic_records_2033 partition of ultrasonic_records for values from ('2033-01-01') to ('2034-01-01');
create table ultrasonic_records_2034 partition of ultrasonic_records for values from ('2034-01-01') to ('2035-01-01');
create table ultrasonic_records_2035 partition of ultrasonic_records for values from ('2035-01-01') to ('2036-01-01');
create index idx_ultra_pcb on ultrasonic_records(pcb_serial_id, occurred_at);

-- ── BURNIN LOADING RECORDS (partitioned) ──────────────────────
create table burnin_loading_records (
  id bigserial,
  pcb_serial_id bigint,
  work_order_id bigint,
  station_id bigint not null,
  machine_id bigint,
  operator_id bigint,
  loaded_at timestamptz not null default now(),
  batch_no varchar(80),
  primary key (id, loaded_at)
) partition by range (loaded_at);

create table burnin_loading_records_2026 partition of burnin_loading_records for values from ('2026-01-01') to ('2027-01-01');
create table burnin_loading_records_2027 partition of burnin_loading_records for values from ('2027-01-01') to ('2028-01-01');
create table burnin_loading_records_2028 partition of burnin_loading_records for values from ('2028-01-01') to ('2029-01-01');
create table burnin_loading_records_2029 partition of burnin_loading_records for values from ('2029-01-01') to ('2030-01-01');
create table burnin_loading_records_2030 partition of burnin_loading_records for values from ('2030-01-01') to ('2031-01-01');
create table burnin_loading_records_2031 partition of burnin_loading_records for values from ('2031-01-01') to ('2032-01-01');
create table burnin_loading_records_2032 partition of burnin_loading_records for values from ('2032-01-01') to ('2033-01-01');
create table burnin_loading_records_2033 partition of burnin_loading_records for values from ('2033-01-01') to ('2034-01-01');
create table burnin_loading_records_2034 partition of burnin_loading_records for values from ('2034-01-01') to ('2035-01-01');
create table burnin_loading_records_2035 partition of burnin_loading_records for values from ('2035-01-01') to ('2036-01-01');
create index idx_bi_load_pcb on burnin_loading_records(pcb_serial_id, loaded_at);

-- ── BURNIN TEST RECORDS (partitioned) ─────────────────────────
create table burnin_test_records (
  id bigserial,
  burnin_load_id bigint not null,
  pcb_serial_id bigint not null,
  station_id bigint not null,
  machine_id bigint,
  temperature_c numeric(8,2),
  test_duration_hours numeric(8,2),
  result varchar(20) not null,
  test_data jsonb,
  operator_id bigint,
  occurred_at timestamptz not null default now(),
  primary key (id, occurred_at)
) partition by range (occurred_at);

create table burnin_test_records_2026 partition of burnin_test_records for values from ('2026-01-01') to ('2027-01-01');
create table burnin_test_records_2027 partition of burnin_test_records for values from ('2027-01-01') to ('2028-01-01');
create table burnin_test_records_2028 partition of burnin_test_records for values from ('2028-01-01') to ('2029-01-01');
create table burnin_test_records_2029 partition of burnin_test_records for values from ('2029-01-01') to ('2030-01-01');
create table burnin_test_records_2030 partition of burnin_test_records for values from ('2030-01-01') to ('2031-01-01');
create table burnin_test_records_2031 partition of burnin_test_records for values from ('2031-01-01') to ('2032-01-01');
create table burnin_test_records_2032 partition of burnin_test_records for values from ('2032-01-01') to ('2033-01-01');
create table burnin_test_records_2033 partition of burnin_test_records for values from ('2033-01-01') to ('2034-01-01');
create table burnin_test_records_2034 partition of burnin_test_records for values from ('2034-01-01') to ('2035-01-01');
create table burnin_test_records_2035 partition of burnin_test_records for values from ('2035-01-01') to ('2036-01-01');
create index idx_bi_test_load on burnin_test_records(burnin_load_id, occurred_at);

-- ── HIPOT TEST RECORDS (partitioned) ───────────────────────────
create table hipot_test_records (
  id bigserial,
  pcb_serial_id bigint,
  work_order_id bigint,
  station_id bigint not null,
  machine_id bigint,
  test_no varchar(80) not null,
  test_voltage_kv numeric(8,2) not null,
  leakage_current_ma numeric(10,4),
  result varchar(20) not null,
  operator_id bigint,
  occurred_at timestamptz not null default now(),
  primary key (id, occurred_at)
) partition by range (occurred_at);

create table hipot_test_records_2026 partition of hipot_test_records for values from ('2026-01-01') to ('2027-01-01');
create table hipot_test_records_2027 partition of hipot_test_records for values from ('2027-01-01') to ('2028-01-01');
create table hipot_test_records_2028 partition of hipot_test_records for values from ('2028-01-01') to ('2029-01-01');
create table hipot_test_records_2029 partition of hipot_test_records for values from ('2029-01-01') to ('2030-01-01');
create table hipot_test_records_2030 partition of hipot_test_records for values from ('2030-01-01') to ('2031-01-01');
create table hipot_test_records_2031 partition of hipot_test_records for values from ('2031-01-01') to ('2032-01-01');
create table hipot_test_records_2032 partition of hipot_test_records for values from ('2032-01-01') to ('2033-01-01');
create table hipot_test_records_2033 partition of hipot_test_records for values from ('2033-01-01') to ('2034-01-01');
create table hipot_test_records_2034 partition of hipot_test_records for values from ('2034-01-01') to ('2035-01-01');
create table hipot_test_records_2035 partition of hipot_test_records for values from ('2035-01-01') to ('2036-01-01');
create unique index idx_hipot_test_no on hipot_test_records(test_no, occurred_at);
create index idx_hipot_pcb on hipot_test_records(pcb_serial_id, occurred_at);

-- ── PACKAGING RECORDS (partitioned) ─────────────────────────────
create table packaging_records (
  id bigserial,
  box_sn varchar(80) not null,
  work_order_id bigint not null,
  station_id bigint not null,
  machine_id bigint,
  product_count integer not null default 0,
  pcb_serials varchar(80)[],
  label_printed bool not null default false,
  operator_id bigint,
  packed_at timestamptz not null default now(),
  primary key (id, packed_at)
) partition by range (packed_at);

create table packaging_records_2026 partition of packaging_records for values from ('2026-01-01') to ('2027-01-01');
create table packaging_records_2027 partition of packaging_records for values from ('2027-01-01') to ('2028-01-01');
create table packaging_records_2028 partition of packaging_records for values from ('2028-01-01') to ('2029-01-01');
create table packaging_records_2029 partition of packaging_records for values from ('2029-01-01') to ('2030-01-01');
create table packaging_records_2030 partition of packaging_records for values from ('2030-01-01') to ('2031-01-01');
create table packaging_records_2031 partition of packaging_records for values from ('2031-01-01') to ('2032-01-01');
create table packaging_records_2032 partition of packaging_records for values from ('2032-01-01') to ('2033-01-01');
create table packaging_records_2033 partition of packaging_records for values from ('2033-01-01') to ('2034-01-01');
create table packaging_records_2034 partition of packaging_records for values from ('2034-01-01') to ('2035-01-01');
create table packaging_records_2035 partition of packaging_records for values from ('2035-01-01') to ('2036-01-01');
create unique index idx_pack_box on packaging_records(box_sn, packed_at);
create index idx_pack_wo on packaging_records(work_order_id, packed_at);

-- ── PALLET RECORDS (partitioned) ───────────────────────────────
create table pallet_records (
  id bigserial,
  pallet_sn varchar(80) not null,
  work_order_id bigint not null,
  station_id bigint not null,
  customer_po_id bigint,
  box_sns varchar(80)[],
  box_count integer not null default 0,
  label_printed bool not null default false,
  operator_id bigint,
  created_at timestamptz not null default now(),
  primary key (id, created_at)
) partition by range (created_at);

create table pallet_records_2026 partition of pallet_records for values from ('2026-01-01') to ('2027-01-01');
create table pallet_records_2027 partition of pallet_records for values from ('2027-01-01') to ('2028-01-01');
create table pallet_records_2028 partition of pallet_records for values from ('2028-01-01') to ('2029-01-01');
create table pallet_records_2029 partition of pallet_records for values from ('2029-01-01') to ('2030-01-01');
create table pallet_records_2030 partition of pallet_records for values from ('2030-01-01') to ('2031-01-01');
create table pallet_records_2031 partition of pallet_records for values from ('2031-01-01') to ('2032-01-01');
create table pallet_records_2032 partition of pallet_records for values from ('2032-01-01') to ('2033-01-01');
create table pallet_records_2033 partition of pallet_records for values from ('2033-01-01') to ('2034-01-01');
create table pallet_records_2034 partition of pallet_records for values from ('2034-01-01') to ('2035-01-01');
create table pallet_records_2035 partition of pallet_records for values from ('2035-01-01') to ('2036-01-01');
create unique index idx_pallet_sn on pallet_records(pallet_sn, created_at);

-- ── APPEARANCE DEFECT RECORDS (partitioned) ───────────────────
create table appearance_defect_records (
  id bigserial,
  pcb_serial_id bigint not null,
  work_order_id bigint not null,
  station_id bigint not null,
  defect_description text,
  defect_photos jsonb,
  defect_severity varchar(20),
  operator_id bigint,
  occurred_at timestamptz not null default now(),
  primary key (id, occurred_at)
) partition by range (occurred_at);

create table appearance_defect_records_2026 partition of appearance_defect_records for values from ('2026-01-01') to ('2027-01-01');
create table appearance_defect_records_2027 partition of appearance_defect_records for values from ('2027-01-01') to ('2028-01-01');
create table appearance_defect_records_2028 partition of appearance_defect_records for values from ('2028-01-01') to ('2029-01-01');
create table appearance_defect_records_2029 partition of appearance_defect_records for values from ('2029-01-01') to ('2030-01-01');
create table appearance_defect_records_2030 partition of appearance_defect_records for values from ('2030-01-01') to ('2031-01-01');
create table appearance_defect_records_2031 partition of appearance_defect_records for values from ('2031-01-01') to ('2032-01-01');
create table appearance_defect_records_2032 partition of appearance_defect_records for values from ('2032-01-01') to ('2033-01-01');
create table appearance_defect_records_2033 partition of appearance_defect_records for values from ('2033-01-01') to ('2034-01-01');
create table appearance_defect_records_2034 partition of appearance_defect_records for values from ('2034-01-01') to ('2035-01-01');
create table appearance_defect_records_2035 partition of appearance_defect_records for values from ('2035-01-01') to ('2036-01-01');
create index idx_app_defect_pcb on appearance_defect_records(pcb_serial_id, occurred_at);

-- ── OQC INSPECTION RECORDS (partitioned) ───────────────────────
create table oqc_inspection_records (
  id bigserial,
  pcb_serial_id bigint,
  work_order_id bigint,
  station_id bigint not null,
  inspection_type varchar(20) not null,
  result varchar(20) not null,
  measurements jsonb,
  operator_id bigint,
  occurred_at timestamptz not null default now(),
  primary key (id, occurred_at)
) partition by range (occurred_at);

create table oqc_inspection_records_2026 partition of oqc_inspection_records for values from ('2026-01-01') to ('2027-01-01');
create table oqc_inspection_records_2027 partition of oqc_inspection_records for values from ('2027-01-01') to ('2028-01-01');
create table oqc_inspection_records_2028 partition of oqc_inspection_records for values from ('2028-01-01') to ('2029-01-01');
create table oqc_inspection_records_2029 partition of oqc_inspection_records for values from ('2029-01-01') to ('2030-01-01');
create table oqc_inspection_records_2030 partition of oqc_inspection_records for values from ('2030-01-01') to ('2031-01-01');
create table oqc_inspection_records_2031 partition of oqc_inspection_records for values from ('2031-01-01') to ('2032-01-01');
create table oqc_inspection_records_2032 partition of oqc_inspection_records for values from ('2032-01-01') to ('2033-01-01');
create table oqc_inspection_records_2033 partition of oqc_inspection_records for values from ('2033-01-01') to ('2034-01-01');
create table oqc_inspection_records_2034 partition of oqc_inspection_records for values from ('2034-01-01') to ('2035-01-01');
create table oqc_inspection_records_2035 partition of oqc_inspection_records for values from ('2035-01-01') to ('2036-01-01');
create index idx_oqc_pcb on oqc_inspection_records(pcb_serial_id, occurred_at);

-- ── DEFECT REPLACEMENT RECORDS (partitioned) ───────────────────
create table defect_replacement_records (
  id bigserial,
  original_pcb_serial_id bigint not null,
  replacement_pcb_serial_id bigint,
  work_order_id bigint not null,
  station_id bigint not null,
  reason varchar(160) not null,
  replacement_type varchar(20) not null,
  operator_id bigint,
  occurred_at timestamptz not null default now(),
  primary key (id, occurred_at)
) partition by range (occurred_at);

create table defect_replacement_records_2026 partition of defect_replacement_records for values from ('2026-01-01') to ('2027-01-01');
create table defect_replacement_records_2027 partition of defect_replacement_records for values from ('2027-01-01') to ('2028-01-01');
create table defect_replacement_records_2028 partition of defect_replacement_records for values from ('2028-01-01') to ('2029-01-01');
create table defect_replacement_records_2029 partition of defect_replacement_records for values from ('2029-01-01') to ('2030-01-01');
create table defect_replacement_records_2030 partition of defect_replacement_records for values from ('2030-01-01') to ('2031-01-01');
create table defect_replacement_records_2031 partition of defect_replacement_records for values from ('2031-01-01') to ('2032-01-01');
create table defect_replacement_records_2032 partition of defect_replacement_records for values from ('2032-01-01') to ('2033-01-01');
create table defect_replacement_records_2033 partition of defect_replacement_records for values from ('2033-01-01') to ('2034-01-01');
create table defect_replacement_records_2034 partition of defect_replacement_records for values from ('2034-01-01') to ('2035-01-01');
create table defect_replacement_records_2035 partition of defect_replacement_records for values from ('2035-01-01') to ('2036-01-01');
create index idx_defect_repl_pcb on defect_replacement_records(original_pcb_serial_id, occurred_at);

-- ── OQC REPORT RECORDS (partitioned) ───────────────────────────
create table oqc_report_records (
  id bigserial,
  work_order_id bigint not null,
  customer_po_id bigint,
  report_no varchar(80) not null,
  total_inspected integer,
  passed integer,
  failed integer,
  defect_summary jsonb,
  operator_id bigint,
  created_at timestamptz not null default now(),
  primary key (id, created_at)
) partition by range (created_at);

create table oqc_report_records_2026 partition of oqc_report_records for values from ('2026-01-01') to ('2027-01-01');
create table oqc_report_records_2027 partition of oqc_report_records for values from ('2027-01-01') to ('2028-01-01');
create table oqc_report_records_2028 partition of oqc_report_records for values from ('2028-01-01') to ('2029-01-01');
create table oqc_report_records_2029 partition of oqc_report_records for values from ('2029-01-01') to ('2030-01-01');
create table oqc_report_records_2030 partition of oqc_report_records for values from ('2030-01-01') to ('2031-01-01');
create table oqc_report_records_2031 partition of oqc_report_records for values from ('2031-01-01') to ('2032-01-01');
create table oqc_report_records_2032 partition of oqc_report_records for values from ('2032-01-01') to ('2033-01-01');
create table oqc_report_records_2033 partition of oqc_report_records for values from ('2033-01-01') to ('2034-01-01');
create table oqc_report_records_2034 partition of oqc_report_records for values from ('2034-01-01') to ('2035-01-01');
create table oqc_report_records_2035 partition of oqc_report_records for values from ('2035-01-01') to ('2036-01-01');
create unique index idx_oqc_report_no on oqc_report_records(report_no, created_at);

-- ── BARCODE CONVERSION RECORDS (partitioned) ─────────────────────
create table barcode_conversion_records (
  id bigserial,
  old_barcode varchar(80) not null,
  new_barcode varchar(80) not null,
  work_order_id bigint,
  station_id bigint not null,
  reason varchar(160),
  operator_id bigint,
  converted_at timestamptz not null default now(),
  primary key (id, converted_at)
) partition by range (converted_at);

create table barcode_conversion_records_2026 partition of barcode_conversion_records for values from ('2026-01-01') to ('2027-01-01');
create table barcode_conversion_records_2027 partition of barcode_conversion_records for values from ('2027-01-01') to ('2028-01-01');
create table barcode_conversion_records_2028 partition of barcode_conversion_records for values from ('2028-01-01') to ('2029-01-01');
create table barcode_conversion_records_2029 partition of barcode_conversion_records for values from ('2029-01-01') to ('2030-01-01');
create table barcode_conversion_records_2030 partition of barcode_conversion_records for values from ('2030-01-01') to ('2031-01-01');
create table barcode_conversion_records_2031 partition of barcode_conversion_records for values from ('2031-01-01') to ('2032-01-01');
create table barcode_conversion_records_2032 partition of barcode_conversion_records for values from ('2032-01-01') to ('2033-01-01');
create table barcode_conversion_records_2033 partition of barcode_conversion_records for values from ('2033-01-01') to ('2034-01-01');
create table barcode_conversion_records_2034 partition of barcode_conversion_records for values from ('2034-01-01') to ('2035-01-01');
create table barcode_conversion_records_2035 partition of barcode_conversion_records for values from ('2035-01-01') to ('2036-01-01');
create index idx_barcode_conv_pcb on barcode_conversion_records(old_barcode, converted_at);

-- ── DECODING RECORDS (partitioned) ──────────────────────────────
create table decoding_records (
  id bigserial,
  pcb_serial_id bigint not null,
  work_order_id bigint not null,
  station_id bigint not null,
  failure_reason varchar(160) not null,
  unlocked_by_user_id bigint,
  unlock_reason varchar(160),
  operator_id bigint,
  unlocked_at timestamptz not null default now(),
  primary key (id, unlocked_at)
) partition by range (unlocked_at);

create table decoding_records_2026 partition of decoding_records for values from ('2026-01-01') to ('2027-01-01');
create table decoding_records_2027 partition of decoding_records for values from ('2027-01-01') to ('2028-01-01');
create table decoding_records_2028 partition of decoding_records for values from ('2028-01-01') to ('2029-01-01');
create table decoding_records_2029 partition of decoding_records for values from ('2029-01-01') to ('2030-01-01');
create table decoding_records_2030 partition of decoding_records for values from ('2030-01-01') to ('2031-01-01');
create table decoding_records_2031 partition of decoding_records for values from ('2031-01-01') to ('2032-01-01');
create table decoding_records_2032 partition of decoding_records for values from ('2032-01-01') to ('2033-01-01');
create table decoding_records_2033 partition of decoding_records for values from ('2033-01-01') to ('2034-01-01');
create table decoding_records_2034 partition of decoding_records for values from ('2034-01-01') to ('2035-01-01');
create table decoding_records_2035 partition of decoding_records for values from ('2035-01-01') to ('2036-01-01');
create index idx_decode_pcb on decoding_records(pcb_serial_id, unlocked_at);

-- ── MSD BAKING RECORDS (partitioned) ──────────────────────────
create table msd_baking_records (
  id bigserial,
  material_lot_id bigint not null,
  station_id bigint not null,
  baking_start timestamptz not null,
  baking_end timestamptz,
  oven_temp_c numeric(8,2) not null,
  oven_humidity_percent numeric(8,2),
  standard_baking_hours numeric(8,2) not null,
  actual_baking_hours numeric(8,2),
  result varchar(20) not null,
  operator_id bigint,
  created_at timestamptz not null default now(),
  primary key (id, created_at)
) partition by range (created_at);

create table msd_baking_records_2026 partition of msd_baking_records for values from ('2026-01-01') to ('2027-01-01');
create table msd_baking_records_2027 partition of msd_baking_records for values from ('2027-01-01') to ('2028-01-01');
create table msd_baking_records_2028 partition of msd_baking_records for values from ('2028-01-01') to ('2029-01-01');
create table msd_baking_records_2029 partition of msd_baking_records for values from ('2029-01-01') to ('2030-01-01');
create table msd_baking_records_2030 partition of msd_baking_records for values from ('2030-01-01') to ('2031-01-01');
create table msd_baking_records_2031 partition of msd_baking_records for values from ('2031-01-01') to ('2032-01-01');
create table msd_baking_records_2032 partition of msd_baking_records for values from ('2032-01-01') to ('2033-01-01');
create table msd_baking_records_2033 partition of msd_baking_records for values from ('2033-01-01') to ('2034-01-01');
create table msd_baking_records_2034 partition of msd_baking_records for values from ('2034-01-01') to ('2035-01-01');
create table msd_baking_records_2035 partition of msd_baking_records for values from ('2035-01-01') to ('2036-01-01');
create index idx_msd_bake_lot on msd_baking_records(material_lot_id, created_at);

-- ============================================================
-- PDA INSPECTION RECORDS (not partitioned — small, append-only audit log)
-- ============================================================

create table pda_inspection_records (
  id bigserial primary key,
  record_type varchar(20) not null,          -- 'RECEIVING' | 'IQC'
  lot_no varchar(80) not null,
  material_code varchar(80),
  material_name_zh varchar(160),
  supplier_code varchar(60),
  supplier_name_zh varchar(160),
  received_qty numeric(18, 4),
  -- Receiving fields
  po_no varchar(80),
  date_code varchar(40),
  msd_level varchar(10),
  msd_bag_intact bool,
  msd_bag_sealed bool,
  msd_exposure_noted bool,
  receiving_photo_url text,
  receiving_notes text,
  location_code varchar(40),
  -- IQC fields
  sample_size integer,
  defect_count integer,
  defect_type varchar(40),
  defect_severity varchar(20),
  defect_rate numeric(8, 4),
  defect_photo_url text,
  inspection_notes text,
  -- Decision
  decision varchar(20),                      -- 'PASS' | 'HOLD' | 'REJECT'
  decision_by varchar(20),                   -- 'AUTO' | 'OPERATOR'
  ornith_confidence numeric(5, 3),
  -- Metadata
  operator_name varchar(120),
  device_info varchar(120),                  -- browser user agent or device ID
  recorded_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index idx_pda_inspection_lot on pda_inspection_records(lot_no);
create index idx_pda_inspection_type_recorded on pda_inspection_records(record_type, recorded_at);
create index idx_pda_inspection_supplier on pda_inspection_records(supplier_code, recorded_at);
create index idx_pda_inspection_decision on pda_inspection_records(decision, recorded_at);

-- NOTE: Foreign key constraints are NOT added on partitioned tables
-- because PostgreSQL doesn't support FKs referencing partitioned tables
-- from non-partitioned tables in the same way.
-- Application layer must enforce referential integrity, or use
-- triggers on each partition.
