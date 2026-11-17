insert into departments (code, parent_id, name_zh, name_en, name_vi, department_type, status)
values
('DEP-HR', null, 'Human Resources', 'Human Resources', 'Nhan su', 'support', 'active'),
('DEP-MKT', null, 'Marketing', 'Marketing', 'Marketing', 'commercial', 'active'),
('DEP-CS', null, 'Customer Service', 'Customer Service', 'Cham soc khach hang', 'commercial', 'active')
on conflict (code) do nothing;

insert into positions (code, department_id, name_zh, name_en, name_vi, position_level, status)
select v.code, d.id, v.name_zh, v.name_en, v.name_vi, v.position_level, 'active'
from (
  values
    ('POS-HR-MGR', 'DEP-HR', 'HR Manager', 'HR Manager', 'Truong phong nhan su', 'manager'),
    ('POS-MKT-MGR', 'DEP-MKT', 'Marketing Manager', 'Marketing Manager', 'Truong phong marketing', 'manager'),
    ('POS-CS-LEAD', 'DEP-CS', 'Customer Service Lead', 'Customer Service Lead', 'Truong nhom cham soc khach hang', 'lead')
) as v(code, department_code, name_zh, name_en, name_vi, position_level)
join departments d on d.code = v.department_code
on conflict (code) do nothing;

insert into employees (
  employee_no,
  user_id,
  department_id,
  position_id,
  full_name,
  full_name_en,
  full_name_vi,
  employment_type,
  hire_date,
  work_location,
  status
)
select
  v.employee_no,
  u.id,
  d.id,
  p.id,
  v.full_name,
  v.full_name_en,
  v.full_name_vi,
  v.employment_type,
  v.hire_date,
  v.work_location,
  'active'
from (
  values
    ('EMP-0001', 'PMC_CN_01', 'DEP-HR', 'POS-HR-MGR', 'Chen HR', 'Chen HR', 'Tran Nhan su', 'full_time', date '2026-06-01', 'Hanoi'),
    ('EMP-0002', 'VN_WH_010', 'DEP-CS', 'POS-CS-LEAD', 'Tran Service', 'Tran Service', 'Tran Cham soc', 'full_time', date '2026-06-01', 'Hanoi'),
    ('EMP-0003', 'VN_OP_013', 'DEP-MKT', 'POS-MKT-MGR', 'Nguyen Marketing', 'Nguyen Marketing', 'Nguyen Marketing', 'full_time', date '2026-06-01', 'Hanoi')
) as v(employee_no, username, department_code, position_code, full_name, full_name_en, full_name_vi, employment_type, hire_date, work_location)
join users u on u.username = v.username
join departments d on d.code = v.department_code
join positions p on p.code = v.position_code
on conflict (employee_no) do nothing;

insert into employee_shifts (employee_id, shift_date, shift_code, planned_start, planned_end, status)
select e.id, date '2026-06-16', 'DAY', timestamptz '2026-06-16 08:00:00+08', timestamptz '2026-06-16 17:00:00+08', 'planned'
from employees e
where e.employee_no in ('EMP-0001', 'EMP-0002', 'EMP-0003')
on conflict (employee_id, shift_date, shift_code) do nothing;

insert into training_records (training_no, employee_id, training_topic, provider, started_at, completed_at, result, status)
select v.training_no, e.id, v.training_topic, v.provider, v.started_at, v.completed_at, v.result, v.status
from (
  values
    ('TRN-0001', 'EMP-0001', 'Factory policy and leave workflow', 'Internal', date '2026-06-02', date '2026-06-02', 'passed', 'completed'),
    ('TRN-0002', 'EMP-0002', 'Customer handling and escalation', 'Internal', date '2026-06-03', date '2026-06-03', 'passed', 'completed'),
    ('TRN-0003', 'EMP-0003', 'Campaign intake and CRM follow-up', 'Internal', date '2026-06-04', date '2026-06-04', 'passed', 'completed')
) as v(training_no, employee_no, training_topic, provider, started_at, completed_at, result, status)
join employees e on e.employee_no = v.employee_no
on conflict (training_no) do nothing;

insert into customer_service_categories (code, name_zh, name_en, name_vi, priority, status)
values
('CS-DELIVERY', 'Delivery issue', 'Delivery issue', 'Van de giao hang', 'high', 'active'),
('CS-QUALITY', 'Quality complaint', 'Quality complaint', 'Khieu nai chat luong', 'urgent', 'active'),
('CS-INVOICE', 'Invoice question', 'Invoice question', 'Hoi don hang', 'normal', 'active')
on conflict (code) do nothing;

insert into customer_service_slas (category_id, priority, response_minutes, resolution_minutes, status)
select c.id, v.priority, v.response_minutes, v.resolution_minutes, 'active'
from (
  values
    ('CS-DELIVERY', 'high', 60, 480),
    ('CS-QUALITY', 'urgent', 30, 240),
    ('CS-INVOICE', 'normal', 240, 1440)
) as v(category_code, priority, response_minutes, resolution_minutes)
join customer_service_categories c on c.code = v.category_code
on conflict (category_id, priority) do nothing;

insert into marketing_campaigns (campaign_no, owner_user_id, name_zh, name_en, name_vi, channel, start_date, end_date, status, budget_amount)
select 'MKT-2606-0001', u.id, 'Q3 Factory Lead Campaign', 'Q3 Factory Lead Campaign', 'Chien dich Q3', 'email', date '2026-06-10', date '2026-06-30', 'running', 5000.0000
from users u
where u.username = 'VN_OP_013'
on conflict (campaign_no) do nothing;

insert into marketing_campaign_leads (campaign_id, customer_id, contact_name, contact_email, contact_phone, lead_status, source, notes)
select c.id, cu.id, 'Nguyen Thi Hoa', 'hoa@example.com', '+84-900-111-222', 'qualified', 'trade_show', 'Follow up for factory supply discussion'
from marketing_campaigns c
cross join customers cu
where c.campaign_no = 'MKT-2606-0001'
  and cu.code = 'CUST-HANOI-01'
on conflict do nothing;

insert into customer_service_tickets (ticket_no, customer_id, customer_contact_id, category_id, owner_user_id, source_channel, subject, description, priority, status)
select
  'TCK-2606-0001',
  cu.id,
  cc.id,
  cat.id,
  u.id,
  'email',
  'Shipment confirmation request',
  'Customer asked for shipment and invoice confirmation.',
  'normal',
  'open'
from customers cu
join customer_contacts cc on cc.customer_id = cu.id
join customer_service_categories cat on cat.code = 'CS-INVOICE'
cross join users u
where cu.code = 'CUST-HANOI-01'
  and cc.contact_code = 'MAIN'
  and u.username = 'VN_WH_010'
on conflict (ticket_no) do nothing;

insert into customer_service_ticket_messages (ticket_id, sender_user_id, sender_role, message, is_internal)
select t.id, u.id, 'agent', 'Acknowledged. We are checking the shipping record and invoice status.', false
from customer_service_tickets t
cross join users u
where t.ticket_no = 'TCK-2606-0001'
  and u.username = 'VN_WH_010'
on conflict do nothing;
