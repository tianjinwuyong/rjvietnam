-- HR Module: Departments, Employees, Attendance, Leave Management
-- For SMT factory system

-- ============================================================
-- DEPARTMENTS
-- ============================================================
create table hr_departments (
  id bigserial primary key,
  code varchar(40) not null unique,
  name_zh varchar(120) not null,
  name_en varchar(120) not null,
  name_vi varchar(120) not null,
  parent_id bigint references hr_departments(id),
  manager_employee_id bigint,
  head_count integer not null default 0,
  status varchar(20) not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- EMPLOYEES
-- ============================================================
create table hr_employees (
  id bigserial primary key,
  employee_no varchar(20) not null unique,
  name_zh varchar(80) not null,
  name_en varchar(80) not null,
  name_vi varchar(80) not null,
  gender varchar(1) not null check (gender in ('M', 'F')),
  birth_date date,
  phone varchar(20),
  email varchar(120),
  emergency_contact varchar(80),
  emergency_phone varchar(20),
  id_card_no varchar(30),
  home_address text,
  department_id bigint not null references hr_departments(id),
  position_title varchar(80) not null,
  employment_type varchar(20) not null default 'full_time' check (employment_type in ('full_time', 'part_time', 'contract', 'intern', 'temporary')),
  join_date date not null,
  probation_end_date date,
  contract_start_date date,
  contract_end_date date,
  base_salary numeric(12, 2),
  bank_account varchar(40),
  bank_name varchar(80),
  tax_code varchar(20),
  social_insurance_no varchar(30),
  health_insurance_no varchar(30),
  avatar_url varchar(255),
  status varchar(20) not null default 'active' check (status in ('active', 'probation', 'resigned', 'suspended', 'retired')),
  resign_date date,
  resign_reason text,
  probation_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- SHIFTS
-- ============================================================
create table hr_shifts (
  id bigserial primary key,
  code varchar(20) not null unique,
  name_zh varchar(60) not null,
  name_en varchar(60) not null,
  name_vi varchar(60) not null,
  start_time time not null,
  end_time time not null,
  break_minutes integer not null default 0,
  work_hours numeric(4, 2) not null,
  night_shift boolean not null default false,
  status varchar(20) not null default 'active',
  created_at timestamptz not null default now()
);

-- ============================================================
-- ATTENDANCE RECORDS
-- ============================================================
create table hr_attendance_records (
  id bigserial primary key,
  employee_id bigint not null references hr_employees(id),
  shift_id bigint references hr_shifts(id),
  work_date date not null,
  clock_in timestamptz,
  clock_out timestamptz,
  actual_work_hours numeric(4, 2),
  status varchar(20) not null default 'normal' check (status in ('normal', 'late', 'early', 'absent', 'leave', 'holiday', 'ot')),
  late_minutes integer default 0,
  early_minutes integer default 0,
  ot_hours numeric(4, 2) default 0,
  remark text,
  created_at timestamptz not null default now(),
  unique(employee_id, work_date)
);

-- ============================================================
-- LEAVE TYPES
-- ============================================================
create table hr_leave_types (
  id bigserial primary key,
  code varchar(20) not null unique,
  name_zh varchar(60) not null,
  name_en varchar(60) not null,
  name_vi varchar(60) not null,
  paid_leave boolean not null default false,
  requires_approval boolean not null default true,
  max_days_per_year integer,
  min_days_notice integer default 0,
  carry_forward boolean not null default false,
  max_carry_forward_days integer,
  status varchar(20) not null default 'active',
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

-- ============================================================
-- LEAVE REQUESTS
-- ============================================================
create table hr_leave_requests (
  id bigserial primary key,
  request_no varchar(20) not null unique,
  employee_id bigint not null references hr_employees(id),
  leave_type_id bigint not null references hr_leave_types(id),
  start_date date not null,
  end_date date not null,
  total_days numeric(4, 1) not null,
  reason text,
  status varchar(20) not null default 'pending' check (status in ('draft', 'pending', 'approved', 'rejected', 'cancelled')),
  approver_id bigint references hr_employees(id),
  approved_at timestamptz,
  approval_remark text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- LEAVE BALANCES
-- ============================================================
create table hr_leave_balances (
  id bigserial primary key,
  employee_id bigint not null references hr_employees(id),
  leave_type_id bigint not null references hr_leave_types(id),
  year integer not null,
  total_days numeric(4, 1) not null default 0,
  used_days numeric(4, 1) not null default 0,
  pending_days numeric(4, 1) not null default 0,
  available_days numeric(4, 1) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(employee_id, leave_type_id, year)
);

-- ============================================================
-- HOLIDAYS / FACTORY CALENDAR
-- ============================================================
create table hr_holidays (
  id bigserial primary key,
  holiday_date date not null unique,
  name_zh varchar(80) not null,
  name_en varchar(80) not null,
  name_vi varchar(80) not null,
  holiday_type varchar(20) not null default 'public' check (holiday_type in ('public', 'company', 'pto')),
  annual_reset boolean not null default false,
  created_at timestamptz not null default now()
);

-- ============================================================
-- OVERTIME REQUESTS
-- ============================================================
create table hr_overtime_requests (
  id bigserial primary key,
  request_no varchar(20) not null unique,
  employee_id bigint not null references hr_employees(id),
  work_date date not null,
  start_time timestamptz not null,
  end_time timestamptz not null,
  total_hours numeric(4, 2) not null,
  reason text,
  status varchar(20) not null default 'pending' check (status in ('draft', 'pending', 'approved', 'rejected', 'cancelled')),
  approver_id bigint references hr_employees(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- HR PERMISSIONS (extends factory permissions)
-- ============================================================
create table hr_permissions (
  id bigserial primary key,
  code varchar(40) not null unique,
  name_zh varchar(80) not null,
  name_en varchar(80) not null,
  name_vi varchar(80) not null,
  category varchar(30) not null,
  description text,
  created_at timestamptz not null default now()
);

-- Seed default leave types
insert into hr_leave_types (code, name_zh, name_en, name_vi, paid_leave, max_days_per_year, carry_forward, max_carry_forward_days, sort_order) values
('annual', '年假', 'Annual Leave', 'Nghỉ phép năm', true, 12, true, 3, 1),
('sick', '病假', 'Sick Leave', 'Nghỉ ốm', true, 12, false, 0, 2),
('personal', '事假', 'Personal Leave', 'Nghỉ việc riêng', false, 6, false, 0, 3),
('maternity', '产假', 'Maternity Leave', 'Nghỉ thai sản', true, 90, false, 0, 4),
('paternity', '陪产假', 'Paternity Leave', 'Nghỉ cha', true, 5, false, 0, 5),
('marriage', '婚假', 'Marriage Leave', 'Nghỉ cưới', true, 3, false, 0, 6),
('bereavement', '丧假', 'Bereavement Leave', 'Nghỉ tang', true, 3, false, 0, 7),
('unpaid', '无薪假', 'Unpaid Leave', 'Nghỉ không lương', false, null, false, 0, 8);

-- Seed Vietnamese public holidays 2026
insert into hr_holidays (holiday_date, name_zh, name_en, name_vi, holiday_type) values
('2026-01-01', '元旦', 'New Year', 'Tết Dương lịch', 'public'),
('2026-01-28', '春节', 'Vietnamese New Year', 'Tết Nguyên đán', 'public'),
('2026-01-29', '春节', 'Vietnamese New Year', 'Tết Nguyên đán', 'public'),
('2026-01-30', '春节', 'Vietnamese New Year', 'Tết Nguyên đán', 'public'),
('2026-01-31', '春节', 'Vietnamese New Year', 'Tết Nguyên đán', 'public'),
('2026-02-01', '春节', 'Vietnamese New Year', 'Tết Nguyên đán', 'public'),
('2026-02-02', '春节', 'Vietnamese New Year', 'Tết Nguyên đán', 'public'),
('2026-04-30', '解放日', 'Liberation Day', 'Ngày Giải phóng', 'public'),
('2026-05-01', '劳动节', 'Labor Day', 'Ngày Lao động', 'public'),
('2026-09-02', '国庆节', 'National Day', 'Quốc khánh', 'public');

-- Seed default shifts
insert into hr_shifts (code, name_zh, name_en, name_vi, start_time, end_time, break_minutes, work_hours, night_shift) values
('DAY', '常日班', 'Day Shift', 'Ca ngày', '08:00', '17:30', 90, 8.0, false),
('AM', '上午班', 'Morning Shift', 'Ca sáng', '08:00', '14:00', 60, 5.0, false),
('PM', '下午班', 'Afternoon Shift', 'Ca chiều', '14:00', '20:00', 60, 5.0, false),
('NIGHT', '夜班', 'Night Shift', 'Ca đêm', '20:00', '04:00', 60, 7.0, true);

-- Seed HR permissions
insert into hr_permissions (code, name_zh, name_en, name_vi, category, description) values
('hr.employee.view', '查看员工', 'View Employee', 'Xem nhân viên', 'employee', 'View employee records'),
('hr.employee.create', '创建员工', 'Create Employee', 'Tạo nhân viên', 'employee', 'Create new employee'),
('hr.employee.edit', '编辑员工', 'Edit Employee', 'Sửa nhân viên', 'employee', 'Edit employee records'),
('hr.employee.delete', '删除员工', 'Delete Employee', 'Xóa nhân viên', 'employee', 'Delete employee records'),
('hr.attendance.view', '查看考勤', 'View Attendance', 'Xem chấm công', 'attendance', 'View attendance records'),
('hr.attendance.edit', '编辑考勤', 'Edit Attendance', 'Sửa chấm công', 'attendance', 'Edit attendance records'),
('hr.leave.view', '查看请假', 'View Leave', 'Xem nghỉ phép', 'leave', 'View leave requests'),
('hr.leave.approve', '审批请假', 'Approve Leave', 'Phê duyệt nghỉ phép', 'leave', 'Approve or reject leave'),
('hr.report.view', '查看报表', 'View Reports', 'Xem báo cáo', 'report', 'View HR reports'),
('hr.department.manage', '管理部门', 'Manage Department', 'Quản lý phòng ban', 'department', 'Manage departments');
