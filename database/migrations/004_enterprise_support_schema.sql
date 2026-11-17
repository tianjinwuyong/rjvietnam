-- Enterprise support extension for HR, marketing, and customer service.
-- Additive schema only. Keeps the factory execution core intact.

begin;

create table if not exists departments (
  id bigserial primary key,
  code varchar(40) not null unique,
  parent_id bigint references departments(id),
  name_zh varchar(160) not null,
  name_en varchar(160) not null,
  name_vi varchar(160) not null,
  department_type varchar(40) not null,
  status varchar(20) not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists positions (
  id bigserial primary key,
  code varchar(40) not null unique,
  department_id bigint references departments(id),
  name_zh varchar(160) not null,
  name_en varchar(160) not null,
  name_vi varchar(160) not null,
  position_level varchar(40) not null,
  status varchar(20) not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists employees (
  id bigserial primary key,
  employee_no varchar(40) not null unique,
  user_id bigint references users(id),
  department_id bigint references departments(id),
  position_id bigint references positions(id),
  manager_employee_id bigint references employees(id),
  full_name varchar(160) not null,
  full_name_zh varchar(160),
  full_name_en varchar(160),
  full_name_vi varchar(160),
  employment_type varchar(40) not null default 'full_time',
  hire_date date not null,
  leave_date date,
  work_location varchar(80),
  status varchar(20) not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id)
);

create table if not exists employee_shifts (
  id bigserial primary key,
  employee_id bigint not null references employees(id) on delete cascade,
  shift_date date not null,
  shift_code varchar(40) not null,
  planned_start timestamptz,
  planned_end timestamptz,
  actual_start timestamptz,
  actual_end timestamptz,
  status varchar(20) not null default 'planned',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(employee_id, shift_date, shift_code)
);

create table if not exists leave_requests (
  id bigserial primary key,
  leave_no varchar(80) not null unique,
  employee_id bigint not null references employees(id),
  leave_type varchar(40) not null,
  start_date date not null,
  end_date date not null,
  reason text,
  status varchar(20) not null default 'draft',
  approver_user_id bigint references users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date)
);

create table if not exists training_records (
  id bigserial primary key,
  training_no varchar(80) not null unique,
  employee_id bigint not null references employees(id),
  training_topic varchar(160) not null,
  provider varchar(160),
  started_at date,
  completed_at date,
  result varchar(40),
  status varchar(20) not null default 'planned',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists marketing_campaigns (
  id bigserial primary key,
  campaign_no varchar(80) not null unique,
  owner_user_id bigint references users(id),
  name_zh varchar(160) not null,
  name_en varchar(160) not null,
  name_vi varchar(160) not null,
  channel varchar(40) not null,
  start_date date,
  end_date date,
  status varchar(20) not null default 'draft',
  budget_amount numeric(18, 4) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date)
);

create table if not exists marketing_campaign_leads (
  id bigserial primary key,
  campaign_id bigint not null references marketing_campaigns(id) on delete cascade,
  customer_id bigint references customers(id),
  contact_name varchar(160),
  contact_email varchar(160),
  contact_phone varchar(40),
  lead_status varchar(20) not null default 'new',
  source varchar(80),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists customer_service_categories (
  id bigserial primary key,
  code varchar(40) not null unique,
  name_zh varchar(160) not null,
  name_en varchar(160) not null,
  name_vi varchar(160) not null,
  priority varchar(20) not null default 'normal',
  status varchar(20) not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists customer_service_tickets (
  id bigserial primary key,
  ticket_no varchar(80) not null unique,
  customer_id bigint references customers(id),
  customer_contact_id bigint references customer_contacts(id),
  category_id bigint references customer_service_categories(id),
  owner_user_id bigint references users(id),
  source_channel varchar(40) not null default 'manual',
  subject varchar(200) not null,
  description text,
  priority varchar(20) not null default 'normal',
  status varchar(20) not null default 'open',
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists customer_service_ticket_messages (
  id bigserial primary key,
  ticket_id bigint not null references customer_service_tickets(id) on delete cascade,
  sender_user_id bigint references users(id),
  sender_role varchar(40) not null default 'agent',
  message text not null,
  is_internal boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists customer_service_slas (
  id bigserial primary key,
  category_id bigint references customer_service_categories(id),
  priority varchar(20) not null,
  response_minutes integer not null check (response_minutes > 0),
  resolution_minutes integer not null check (resolution_minutes > 0),
  status varchar(20) not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(category_id, priority)
);

alter table departments
  add constraint departments_status_check check (status in ('active', 'inactive', 'voided'));

alter table positions
  add constraint positions_status_check check (status in ('active', 'inactive', 'voided'));

alter table employees
  add constraint employees_status_check check (status in ('active', 'inactive', 'leave', 'terminated', 'voided')),
  add constraint employees_employment_type_check check (employment_type in ('full_time', 'part_time', 'contract', 'intern', 'outsourced'));

alter table employee_shifts
  add constraint employee_shifts_status_check check (status in ('planned', 'working', 'completed', 'missed', 'voided'));

alter table leave_requests
  add constraint leave_requests_status_check check (status in ('draft', 'submitted', 'approved', 'rejected', 'cancelled', 'voided')),
  add constraint leave_requests_type_check check (leave_type in ('annual', 'sick', 'unpaid', 'maternity', 'paternity', 'other'));

alter table training_records
  add constraint training_records_status_check check (status in ('planned', 'in_progress', 'completed', 'failed', 'voided'));

alter table marketing_campaigns
  add constraint marketing_campaigns_status_check check (status in ('draft', 'planned', 'running', 'paused', 'completed', 'cancelled', 'voided'));

alter table marketing_campaign_leads
  add constraint marketing_campaign_leads_status_check check (lead_status in ('new', 'contacted', 'qualified', 'opportunity', 'won', 'lost', 'voided'));

alter table customer_service_categories
  add constraint customer_service_categories_priority_check check (priority in ('low', 'normal', 'high', 'urgent')),
  add constraint customer_service_categories_status_check check (status in ('active', 'inactive', 'voided'));

alter table customer_service_tickets
  add constraint customer_service_tickets_priority_check check (priority in ('low', 'normal', 'high', 'urgent')),
  add constraint customer_service_tickets_status_check check (status in ('open', 'pending', 'waiting_customer', 'resolved', 'closed', 'cancelled', 'voided')),
  add constraint customer_service_tickets_source_check check (source_channel in ('manual', 'email', 'phone', 'wechat', 'zalo', 'web', 'api'));

alter table customer_service_slas
  add constraint customer_service_slas_priority_check check (priority in ('low', 'normal', 'high', 'urgent')),
  add constraint customer_service_slas_status_check check (status in ('active', 'inactive', 'voided'));

create index if not exists idx_departments_parent on departments(parent_id, code);
create index if not exists idx_positions_department on positions(department_id, code);
create index if not exists idx_employees_department on employees(department_id, status);
create index if not exists idx_employees_position on employees(position_id, status);
create index if not exists idx_employee_shifts_employee_date on employee_shifts(employee_id, shift_date desc);
create index if not exists idx_leave_requests_employee on leave_requests(employee_id, status, start_date desc);
create index if not exists idx_training_records_employee on training_records(employee_id, status, completed_at desc);
create index if not exists idx_marketing_campaigns_owner on marketing_campaigns(owner_user_id, status, start_date desc);
create index if not exists idx_marketing_campaign_leads_campaign on marketing_campaign_leads(campaign_id, lead_status, created_at desc);
create index if not exists idx_customer_service_tickets_customer on customer_service_tickets(customer_id, status, opened_at desc);
create index if not exists idx_customer_service_tickets_owner on customer_service_tickets(owner_user_id, status, opened_at desc);
create index if not exists idx_customer_service_ticket_messages_ticket on customer_service_ticket_messages(ticket_id, created_at asc);
create index if not exists idx_customer_service_slas_category on customer_service_slas(category_id, priority);

commit;
