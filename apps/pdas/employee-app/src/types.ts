export type Locale = "zh-CN" | "vi-VN" | "en-US";

export interface Employee {
  id: number;
  code: string;
  name_zh: string;
  name_vi: string;
  name_en: string;
  gender: string;
  phone: string;
  dept_name: string;
  position: string;
  hire_date: string;
  avatar_url: string | null;
  status: string;
}

export interface CheckinRecord {
  id: number;
  checkin_type: string;
  checkin_time: string;
  face_result: string;
  face_score: number | null;
  location_type: string;
}

export interface LeaveBalance {
  leave_type: string;
  leave_name: string;
  total_days: number;
  used_days: number;
  remaining_days: number;
}

export interface LeaveRecord {
  id: number;
  leave_type: string;
  leave_name: string;
  start_date: string;
  end_date: string;
  days_count: number;
  reason: string | null;
  status: string;
  created_at: string;
}

export interface AttendanceStats {
  year: number;
  month: number;
  normal_days: number;
  late_days: number;
  early_days: number;
  absent_days: number;
  total_days: number;
}

export interface SalaryRecord {
  id: number;
  year: number;
  month: number;
  base_salary: number;
  gross_salary: number;
  total_deductions: number;
  net_salary: number;
  status: string;
}

export interface AppNotification {
  id: number;
  type: string;
  title_zh: string;
  body_zh: string;
  is_read: number;
  sent_at: string;
}
