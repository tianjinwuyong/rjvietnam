-- HR Module Demo Seed Data
-- SMT Factory Vietnam - Ruijing

-- ============================================================
-- DEPARTMENTS
-- ============================================================
insert into hr_departments (code, name_zh, name_en, name_vi, head_count, status) values
('SMT', 'SMT部门', 'SMT Department', 'Phòng SMT', 0, 'active'),
('ASSEMBLY', '组装部门', 'Assembly Department', 'Phòng lắp ráp', 0, 'active'),
('QC', '质量部门', 'Quality Control', 'Phòng chất lượng', 0, 'active'),
('WAREHOUSE', '仓库部门', 'Warehouse', 'Phòng kho', 0, 'active'),
('ENGINEERING', '工程部', 'Engineering', 'Phòng kỹ thuật', 0, 'active'),
('HR', '人事部', 'HR & Admin', 'Phòng nhân sự', 0, 'active'),
('PMC', '计划部', 'PMC', 'Phòng kế hoạch', 0, 'active'),
('FINANCE', '财务部', 'Finance', 'Phòng tài chính', 0, 'active'),
('IT', 'IT部', 'IT Department', 'Phòng IT', 0, 'active'),
('MAINTENANCE', '设备维护部', 'Maintenance', 'Phòng bảo trì', 0, 'active')
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- EMPLOYEES (Demo)
-- ============================================================
insert into hr_employees (employee_no, name_zh, name_en, name_vi, gender, phone, email, department_id, position_title, employment_type, join_date, status) values
-- SMT Department
('EMP20260001', '阮文强', 'Nguyen Van Cuong', 'Nguyễn Văn Cường', 'M', '0901234001', 'cuongnv@ruijing.vn', 1, 'SMT技术员', 'full_time', '2024-03-15', 'active'),
('EMP20260002', '陈氏红', 'Tran Thi Hong', 'Trần Thị Hồng', 'F', '0901234002', 'hongtt@ruijing.vn', 1, 'SMT操作员', 'full_time', '2024-06-01', 'active'),
('EMP20260003', '范明光', 'Pham Minh Quang', 'Phạm Minh Quang', 'M', '0901234003', 'quangpm@ruijing.vn', 1, 'SMT班长', 'full_time', '2023-11-20', 'active'),
('EMP20260004', '黎氏红', 'Le Thi Huong', 'Lê Thị Hương', 'F', '0901234004', 'huonglt@ruijing.vn', 1, 'SMT操作员', 'full_time', '2025-01-10', 'active'),
('EMP20260005', '吴文德', 'Vu Van Duc', 'Vũ Văn Đức', 'M', '0901234005', 'ducvv@ruijing.vn', 1, 'SMT操作员', 'contract', '2025-02-15', 'active'),

-- Assembly Department
('EMP20260006', '潘氏红', 'Phan Thi Ha', 'Phan Thị Hà', 'F', '0901234006', 'hapt@ruijing.vn', 2, '组装技术员', 'full_time', '2024-02-01', 'active'),
('EMP20260007', '郑文光', 'Trinh Van Sang', 'Trịnh Văn Sáng', 'M', '0901234007', 'sangtv@ruijing.vn', 2, '组装操作员', 'full_time', '2024-07-20', 'active'),
('EMP20260008', '阮氏红', 'Nguyen Thi Lan', 'Nguyễn Thị Lan', 'F', '0901234008', 'lannt@ruijing.vn', 2, '组装班长', 'full_time', '2023-09-15', 'active'),

-- QC Department
('EMP20260009', '陈文雄', 'Tran Van Hung', 'Trần Văn Hùng', 'M', '0901234009', 'hungtv@ruijing.vn', 3, '质量工程师', 'full_time', '2024-01-05', 'active'),
('EMP20260010', '黎文红', 'Le Van Linh', 'Lê Văn Linh', 'M', '0901234010', 'linhlv@ruijing.vn', 3, '质检员', 'full_time', '2024-05-12', 'active'),

-- Warehouse
('EMP20260011', '武文海', 'Vo Van Hai', 'Võ Văn Hải', 'M', '0901234011', 'haivv@ruijing.vn', 4, '仓库主管', 'full_time', '2023-08-01', 'active'),
('EMP20260012', '丁氏红', 'Dinh Thi Mai', 'Đinh Thị Mai', 'F', '0901234012', 'maidt@ruijing.vn', 4, '仓库管理员', 'full_time', '2024-09-01', 'active'),

-- Engineering
('EMP20260013', '黄文光', 'Hoang Van Manh', 'Hoàng Văn Mạnh', 'M', '0901234013', 'manhhv@ruijing.vn', 5, '工艺工程师', 'full_time', '2024-04-01', 'active'),
('EMP20260014', '孙文强', 'Ton That Dat', 'Tôn Thất Đạt', 'M', '0901234014', 'dattd@ruijing.vn', 5, '设备工程师', 'full_time', '2024-03-20', 'active'),

-- HR
('EMP20260015', '阮氏红锦', 'Nguyen Thi Kim', 'Nguyễn Thị Kim', 'F', '0901234015', 'kimntn@ruijing.vn', 6, '人事专员', 'full_time', '2024-06-15', 'active'),

-- PMC
('EMP20260016', '刘文光', 'Luong Van Phat', 'Lương Văn Phát', 'M', '0901234016', 'phatlv@ruijing.vn', 7, '计划员', 'full_time', '2024-02-10', 'active'),

-- IT
('EMP20260017', '张文德', 'Truong Van Tai', 'Trương Văn Tài', 'M', '0901234017', 'taitv@ruijing.vn', 8, 'IT工程师', 'full_time', '2024-01-25', 'active'),

-- Maintenance
('EMP20260018', '黄文强', 'Huynh Van Phu', 'Huỳnh Văn Phú', 'M', '0901234018', 'phuhv@ruijing.vn', 9, '设备维护技术员', 'full_time', '2024-08-05', 'active'),

-- Resigned employee (for historical records)
('EMP20250001', '陈文华', 'Tran Van Hoa', 'Trần Văn Hòa', 'M', '0901234500', 'hoatv@ruijing.vn', 1, 'SMT操作员', 'full_time', '2024-01-15', 'resigned'),
('EMP20250002', '范氏红', 'Pham Thi Xuan', 'Phạm Thị Xuân', 'F', '0901234501', 'xuanpt@ruijing.vn', 2, '组装操作员', 'full_time', '2024-02-20', 'resigned')
ON CONFLICT (employee_no) DO NOTHING;

-- ============================================================
-- ATTENDANCE RECORDS (Sample data for current month)
-- ============================================================
-- Get employee IDs for attendance records
do $$
declare
  emp1 bigint := (select id from hr_employees where employee_no = 'EMP20260001');
  emp2 bigint := (select id from hr_employees where employee_no = 'EMP20260002');
  emp3 bigint := (select id from hr_employees where employee_no = 'EMP20260003');
  emp4 bigint := (select id from hr_employees where employee_no = 'EMP20260004');
  emp5 bigint := (select id from hr_employees where employee_no = 'EMP20260005');
  emp6 bigint := (select id from hr_employees where employee_no = 'EMP20260006');
  emp7 bigint := (select id from hr_employees where employee_no = 'EMP20260007');
  emp8 bigint := (select id from hr_employees where employee_no = 'EMP20260008');
  emp9 bigint := (select id from hr_employees where employee_no = 'EMP20260009');
  emp10 bigint := (select id from hr_employees where employee_no = 'EMP20260010');
  shift1 bigint := (select id from hr_shifts where code = 'DAY');
begin
  -- Idempotent: clear these demo attendance records before re-inserting
  delete from hr_attendance_records where employee_id in (emp1,emp2,emp3,emp4,emp5,emp6,emp7,emp8,emp9,emp10);
  
  -- Week 1 - June 2026
  -- Monday June 15
  insert into hr_attendance_records (employee_id, shift_id, work_date, clock_in, clock_out, actual_work_hours, status, late_minutes)
  values (emp1, shift1, '2026-06-15', '2026-06-15 07:55:00', '2026-06-15 17:35:00', 8.0, 'normal', 0);
  insert into hr_attendance_records (employee_id, shift_id, work_date, clock_in, clock_out, actual_work_hours, status, late_minutes)
  values (emp2, shift1, '2026-06-15', '2026-06-15 08:05:00', '2026-06-15 17:40:00', 7.75, 'late', 5);
  insert into hr_attendance_records (employee_id, shift_id, work_date, clock_in, clock_out, actual_work_hours, status, late_minutes)
  values (emp3, shift1, '2026-06-15', '2026-06-15 07:50:00', '2026-06-15 17:30:00', 8.0, 'normal', 0);
  insert into hr_attendance_records (employee_id, shift_id, work_date, clock_in, clock_out, actual_work_hours, status, late_minutes)
  values (emp4, shift1, '2026-06-15', '2026-06-15 08:00:00', '2026-06-15 17:35:00', 7.92, 'normal', 0);
  insert into hr_attendance_records (employee_id, shift_id, work_date, clock_in, clock_out, actual_work_hours, status, late_minutes)
  values (emp5, shift1, '2026-06-15', '2026-06-15 08:02:00', '2026-06-15 17:30:00', 7.8, 'late', 2);
  insert into hr_attendance_records (employee_id, shift_id, work_date, clock_in, clock_out, actual_work_hours, status, late_minutes)
  values (emp6, shift1, '2026-06-15', '2026-06-15 07:58:00', '2026-06-15 17:32:00', 7.97, 'normal', 0);
  insert into hr_attendance_records (employee_id, shift_id, work_date, clock_in, clock_out, actual_work_hours, status, late_minutes)
  values (emp7, shift1, '2026-06-15', '2026-06-15 08:10:00', '2026-06-15 17:35:00', 7.67, 'late', 10);
  insert into hr_attendance_records (employee_id, shift_id, work_date, clock_in, clock_out, actual_work_hours, status, late_minutes)
  values (emp8, shift1, '2026-06-15', '2026-06-15 07:52:00', '2026-06-15 17:28:00', 8.0, 'normal', 0);
  insert into hr_attendance_records (employee_id, shift_id, work_date, clock_in, clock_out, actual_work_hours, status, late_minutes)
  values (emp9, shift1, '2026-06-15', '2026-06-15 08:00:00', '2026-06-15 17:30:00', 7.83, 'normal', 0);
  insert into hr_attendance_records (employee_id, shift_id, work_date, clock_in, clock_out, actual_work_hours, status, late_minutes)
  values (emp10, shift1, '2026-06-15', '2026-06-15 08:08:00', '2026-06-15 17:40:00', 7.77, 'late', 8);

  -- Tuesday June 16
  insert into hr_attendance_records (employee_id, shift_id, work_date, clock_in, clock_out, actual_work_hours, status, late_minutes)
  values (emp1, shift1, '2026-06-16', '2026-06-16 07:58:00', '2026-06-16 17:30:00', 8.0, 'normal', 0);
  insert into hr_attendance_records (employee_id, shift_id, work_date, clock_in, clock_out, actual_work_hours, status, late_minutes)
  values (emp2, shift1, '2026-06-16', '2026-06-16 08:00:00', '2026-06-16 17:35:00', 7.92, 'normal', 0);
  insert into hr_attendance_records (employee_id, shift_id, work_date, clock_in, clock_out, actual_work_hours, status, late_minutes)
  values (emp3, shift1, '2026-06-16', '2026-06-16 07:55:00', '2026-06-16 17:30:00', 8.0, 'normal', 0);
  insert into hr_attendance_records (employee_id, shift_id, work_date, clock_in, clock_out, actual_work_hours, status, late_minutes)
  values (emp4, shift1, '2026-06-16', '2026-06-16 08:03:00', '2026-06-16 17:38:00', 7.83, 'late', 3);
  insert into hr_attendance_records (employee_id, shift_id, work_date, clock_in, clock_out, actual_work_hours, status, late_minutes)
  values (emp5, shift1, '2026-06-16', '2026-06-16 08:00:00', '2026-06-16 17:30:00', 7.83, 'normal', 0);
  insert into hr_attendance_records (employee_id, shift_id, work_date, clock_in, clock_out, actual_work_hours, status, late_minutes)
  values (emp6, shift1, '2026-06-16', '2026-06-16 08:00:00', '2026-06-16 17:30:00', 7.83, 'normal', 0);
  insert into hr_attendance_records (employee_id, shift_id, work_date, clock_in, clock_out, actual_work_hours, status, late_minutes)
  values (emp7, shift1, '2026-06-16', '2026-06-16 08:00:00', '2026-06-16 17:30:00', 7.83, 'normal', 0);
  insert into hr_attendance_records (employee_id, shift_id, work_date, clock_in, clock_out, actual_work_hours, status, late_minutes)
  values (emp8, shift1, '2026-06-16', '2026-06-16 07:58:00', '2026-06-16 17:30:00', 8.0, 'normal', 0);
  insert into hr_attendance_records (employee_id, shift_id, work_date, clock_in, clock_out, actual_work_hours, status, late_minutes)
  values (emp9, shift1, '2026-06-16', '2026-06-16 08:00:00', '2026-06-16 17:30:00', 7.83, 'normal', 0);
  insert into hr_attendance_records (employee_id, shift_id, work_date, clock_in, clock_out, actual_work_hours, status, late_minutes)
  values (emp10, shift1, '2026-06-16', '2026-06-16 08:00:00', '2026-06-16 17:30:00', 7.83, 'normal', 0);

  -- Wednesday June 17
  insert into hr_attendance_records (employee_id, shift_id, work_date, clock_in, clock_out, actual_work_hours, status, late_minutes)
  values (emp1, shift1, '2026-06-17', '2026-06-17 07:55:00', '2026-06-17 17:30:00', 8.0, 'normal', 0);
  insert into hr_attendance_records (employee_id, shift_id, work_date, clock_in, clock_out, actual_work_hours, status, late_minutes)
  values (emp2, shift1, '2026-06-17', '2026-06-17 08:00:00', '2026-06-17 17:30:00', 7.83, 'normal', 0);
  insert into hr_attendance_records (employee_id, shift_id, work_date, clock_in, clock_out, actual_work_hours, status, late_minutes)
  values (emp3, shift1, '2026-06-17', '2026-06-17 07:50:00', '2026-06-17 17:25:00', 8.0, 'normal', 0);
  insert into hr_attendance_records (employee_id, shift_id, work_date, clock_in, clock_out, actual_work_hours, status, late_minutes)
  values (emp4, shift1, '2026-06-17', '2026-06-17 08:00:00', '2026-06-17 17:30:00', 7.83, 'normal', 0);
  insert into hr_attendance_records (employee_id, shift_id, work_date, clock_in, clock_out, actual_work_hours, status, late_minutes)
  values (emp5, shift1, '2026-06-17', '2026-06-17 08:05:00', '2026-06-17 17:30:00', 7.67, 'late', 5);
  insert into hr_attendance_records (employee_id, shift_id, work_date, clock_in, clock_out, actual_work_hours, status, late_minutes)
  values (emp6, shift1, '2026-06-17', '2026-06-17 07:58:00', '2026-06-17 17:30:00', 7.97, 'normal', 0);
  insert into hr_attendance_records (employee_id, shift_id, work_date, clock_in, clock_out, actual_work_hours, status, late_minutes)
  values (emp7, shift1, '2026-06-17', '2026-06-17 08:00:00', '2026-06-17 17:30:00', 7.83, 'normal', 0);
  insert into hr_attendance_records (employee_id, shift_id, work_date, clock_in, clock_out, actual_work_hours, status, late_minutes)
  values (emp8, shift1, '2026-06-17', '2026-06-17 07:55:00', '2026-06-17 17:30:00', 8.0, 'normal', 0);
  insert into hr_attendance_records (employee_id, shift_id, work_date, clock_in, clock_out, actual_work_hours, status, late_minutes)
  values (emp9, shift1, '2026-06-17', '2026-06-17 08:00:00', '2026-06-17 17:30:00', 7.83, 'normal', 0);
  insert into hr_attendance_records (employee_id, shift_id, work_date, clock_in, clock_out, actual_work_hours, status, late_minutes)
  values (emp10, shift1, '2026-06-17', '2026-06-17 08:00:00', '2026-06-17 17:30:00', 7.83, 'normal', 0);

  -- Thursday June 18
  insert into hr_attendance_records (employee_id, shift_id, work_date, clock_in, clock_out, actual_work_hours, status, late_minutes)
  values (emp1, shift1, '2026-06-18', '2026-06-18 07:58:00', '2026-06-18 17:30:00', 7.97, 'normal', 0);
  insert into hr_attendance_records (employee_id, shift_id, work_date, clock_in, clock_out, actual_work_hours, status, late_minutes)
  values (emp2, shift1, '2026-06-18', '2026-06-18 08:00:00', '2026-06-18 17:30:00', 7.83, 'normal', 0);
  insert into hr_attendance_records (employee_id, shift_id, work_date, clock_in, clock_out, actual_work_hours, status, late_minutes)
  values (emp3, shift1, '2026-06-18', '2026-06-18 07:52:00', '2026-06-18 17:30:00', 8.0, 'normal', 0);
  insert into hr_attendance_records (employee_id, shift_id, work_date, clock_in, clock_out, actual_work_hours, status, late_minutes)
  values (emp4, shift1, '2026-06-18', '2026-06-18 08:00:00', '2026-06-18 17:30:00', 7.83, 'normal', 0);
  insert into hr_attendance_records (employee_id, shift_id, work_date, clock_in, clock_out, actual_work_hours, status, late_minutes)
  values (emp5, shift1, '2026-06-18', '2026-06-18 08:00:00', '2026-06-18 17:30:00', 7.83, 'normal', 0);
  insert into hr_attendance_records (employee_id, shift_id, work_date, clock_in, clock_out, actual_work_hours, status, late_minutes)
  values (emp6, shift1, '2026-06-18', '2026-06-18 08:00:00', '2026-06-18 17:30:00', 7.83, 'normal', 0);
  insert into hr_attendance_records (employee_id, shift_id, work_date, clock_in, clock_out, actual_work_hours, status, late_minutes)
  values (emp7, shift1, '2026-06-18', '2026-06-18 08:00:00', '2026-06-18 17:30:00', 7.83, 'normal', 0);
  insert into hr_attendance_records (employee_id, shift_id, work_date, clock_in, clock_out, actual_work_hours, status, late_minutes)
  values (emp8, shift1, '2026-06-18', '2026-06-18 07:58:00', '2026-06-18 17:30:00', 7.97, 'normal', 0);
  insert into hr_attendance_records (employee_id, shift_id, work_date, clock_in, clock_out, actual_work_hours, status, late_minutes)
  values (emp9, shift1, '2026-06-18', '2026-06-18 08:00:00', '2026-06-18 17:30:00', 7.83, 'normal', 0);
  insert into hr_attendance_records (employee_id, shift_id, work_date, clock_in, clock_out, actual_work_hours, status, late_minutes)
  values (emp10, shift1, '2026-06-18', '2026-06-18 08:00:00', '2026-06-18 17:30:00', 7.83, 'normal', 0);

  -- Friday June 19
  insert into hr_attendance_records (employee_id, shift_id, work_date, clock_in, clock_out, actual_work_hours, status, late_minutes)
  values (emp1, shift1, '2026-06-19', '2026-06-19 07:55:00', '2026-06-19 17:30:00', 8.0, 'normal', 0);
  insert into hr_attendance_records (employee_id, shift_id, work_date, clock_in, clock_out, actual_work_hours, status, late_minutes)
  values (emp2, shift1, '2026-06-19', '2026-06-19 08:00:00', '2026-06-19 17:30:00', 7.83, 'normal', 0);
  insert into hr_attendance_records (employee_id, shift_id, work_date, clock_in, clock_out, actual_work_hours, status, late_minutes)
  values (emp3, shift1, '2026-06-19', '2026-06-19 07:50:00', '2026-06-19 17:25:00', 8.0, 'normal', 0);
  insert into hr_attendance_records (employee_id, shift_id, work_date, clock_in, clock_out, actual_work_hours, status, late_minutes)
  values (emp4, shift1, '2026-06-19', '2026-06-19 08:00:00', '2026-06-19 17:30:00', 7.83, 'normal', 0);
  insert into hr_attendance_records (employee_id, shift_id, work_date, clock_in, clock_out, actual_work_hours, status, late_minutes)
  values (emp5, shift1, '2026-06-19', '2026-06-19 08:00:00', '2026-06-19 17:30:00', 7.83, 'normal', 0);
  insert into hr_attendance_records (employee_id, shift_id, work_date, clock_in, clock_out, actual_work_hours, status, late_minutes)
  values (emp6, shift1, '2026-06-19', '2026-06-19 07:58:00', '2026-06-19 17:30:00', 7.97, 'normal', 0);
  insert into hr_attendance_records (employee_id, shift_id, work_date, clock_in, clock_out, actual_work_hours, status, late_minutes)
  values (emp7, shift1, '2026-06-19', '2026-06-19 08:00:00', '2026-06-19 17:30:00', 7.83, 'normal', 0);
  insert into hr_attendance_records (employee_id, shift_id, work_date, clock_in, clock_out, actual_work_hours, status, late_minutes)
  values (emp8, shift1, '2026-06-19', '2026-06-19 07:55:00', '2026-06-19 17:30:00', 8.0, 'normal', 0);
  insert into hr_attendance_records (employee_id, shift_id, work_date, clock_in, clock_out, actual_work_hours, status, late_minutes)
  values (emp9, shift1, '2026-06-19', '2026-06-19 08:00:00', '2026-06-19 17:30:00', 7.83, 'normal', 0);
  insert into hr_attendance_records (employee_id, shift_id, work_date, clock_in, clock_out, actual_work_hours, status, late_minutes)
  values (emp10, shift1, '2026-06-19', '2026-06-19 08:00:00', '2026-06-19 17:30:00', 7.83, 'normal', 0);
end $$;

-- ============================================================
-- LEAVE BALANCES (2026)
-- ============================================================
do $$
declare
  emp1 bigint := (select id from hr_employees where employee_no = 'EMP20260001');
  emp2 bigint := (select id from hr_employees where employee_no = 'EMP20260002');
  emp3 bigint := (select id from hr_employees where employee_no = 'EMP20260003');
  lt_annual bigint := (select id from hr_leave_types where code = 'annual');
  lt_sick bigint := (select id from hr_leave_types where code = 'sick');
  lt_personal bigint := (select id from hr_leave_types where code = 'personal');
begin
  delete from hr_leave_balances where employee_id in (emp1,emp2,emp3) and year = 2026;
  -- Annual leave
  insert into hr_leave_balances (employee_id, leave_type_id, year, total_days, used_days, pending_days, available_days)
  values (emp1, lt_annual, 2026, 12, 2, 0, 10);
  insert into hr_leave_balances (employee_id, leave_type_id, year, total_days, used_days, pending_days, available_days)
  values (emp2, lt_annual, 2026, 12, 0, 0, 12);
  insert into hr_leave_balances (employee_id, leave_type_id, year, total_days, used_days, pending_days, available_days)
  values (emp3, lt_annual, 2026, 14, 3, 2, 9);

  -- Sick leave
  insert into hr_leave_balances (employee_id, leave_type_id, year, total_days, used_days, pending_days, available_days)
  values (emp1, lt_sick, 2026, 12, 1, 0, 11);
  insert into hr_leave_balances (employee_id, leave_type_id, year, total_days, used_days, pending_days, available_days)
  values (emp2, lt_sick, 2026, 12, 2, 0, 10);
  insert into hr_leave_balances (employee_id, leave_type_id, year, total_days, used_days, pending_days, available_days)
  values (emp3, lt_sick, 2026, 12, 0, 0, 12);

  -- Personal leave
  insert into hr_leave_balances (employee_id, leave_type_id, year, total_days, used_days, pending_days, available_days)
  values (emp1, lt_personal, 2026, 6, 1, 0, 5);
  insert into hr_leave_balances (employee_id, leave_type_id, year, total_days, used_days, pending_days, available_days)
  values (emp2, lt_personal, 2026, 6, 0, 0, 6);
  insert into hr_leave_balances (employee_id, leave_type_id, year, total_days, used_days, pending_days, available_days)
  values (emp3, lt_personal, 2026, 6, 2, 0, 4);
end $$;

-- ============================================================
-- LEAVE REQUESTS (Sample pending/approved)
-- ============================================================
do $$
declare
  emp1 bigint := (select id from hr_employees where employee_no = 'EMP20260001');
  emp2 bigint := (select id from hr_employees where employee_no = 'EMP20260002');
  emp3 bigint := (select id from hr_employees where employee_no = 'EMP20260003');
  lt_annual bigint := (select id from hr_leave_types where code = 'annual');
  lt_sick bigint := (select id from hr_leave_types where code = 'sick');
  lt_personal bigint := (select id from hr_leave_types where code = 'personal');
begin
  -- Pending annual leave
  insert into hr_leave_requests (request_no, employee_id, leave_type_id, start_date, end_date, total_days, reason, status)
  values ('LR202606001', emp3, lt_annual, '2026-06-25', '2026-06-26', 2, 'Family trip', 'pending')
  ON CONFLICT (request_no) DO NOTHING;

  -- Approved sick leave
  insert into hr_leave_requests (request_no, employee_id, leave_type_id, start_date, end_date, total_days, reason, status, approved_at)
  values ('LR202606002', emp2, lt_sick, '2026-06-10', '2026-06-10', 1, 'Doctor appointment', 'approved', '2026-06-09 10:00:00')
  ON CONFLICT (request_no) DO NOTHING;

  -- Pending personal leave
  insert into hr_leave_requests (request_no, employee_id, leave_type_id, start_date, end_date, total_days, reason, status)
  values ('LR202606003', emp1, lt_personal, '2026-06-23', '2026-06-23', 1, 'Personal matters', 'pending')
ON CONFLICT (request_no) DO NOTHING;

  -- Approved annual leave
  insert into hr_leave_requests (request_no, employee_id, leave_type_id, start_date, end_date, total_days, reason, status, approved_at)
  values ('LR202606004', emp1, lt_annual, '2026-05-01', '2026-05-02', 2, 'Holiday travel', 'approved', '2026-04-25 14:00:00')
ON CONFLICT (request_no) DO NOTHING;
end $$;
