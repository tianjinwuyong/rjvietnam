import { apiClient, authStorage, type ListEnvelope, type Envelope, type MutateEnvelope } from "./client";

export interface Department {
  id: number;
  code: string;
  name_zh: string;
  name_en: string;
  name_vi: string;
  parentId: number | null;
  deptType: string;
  headcountTarget: number;
  memberCount: number;
  status: string;
  managerId: number | null;
  managerCode: string | null;
  managerNameZh: string | null;
  managerTitleZh: string | null;
  createdAt: string;
}

export interface OrgChartNode {
  id: number;
  code: string;
  name_zh: string;
  name_en: string;
  name_vi: string;
  parent_id: number | null;
  dept_type: string;
  status: string;
  managerId: number | null;
  managerNameZh: string | null;
  managerTitleZh: string | null;
  memberCount: number;
  level: number;
}

export interface Employee {
  id: number;
  code: string;
  displayName: string;
  name_zh: string;
  name_en: string;
  name_vi: string;
  gender: string;
  phone: string;
  email: string;
  hireDate: string;
  dateOfBirth: string | null;
  idCardNo: string | null;
  address: string | null;
  status: string;
  departmentId: number;
  departmentCode: string;
  departmentNameZh: string;
  department_name_zh?: string;
  positionId: number;
  positionTitleZh: string;
  positionTitleEn: string;
  positionTitleVi: string;
  managerId: number | null;
  managerNameZh: string | null;
  avatar_url: string | null;
}

export interface EmployeeDetail extends Employee {
  terminationDate: string | null;
  departmentNameEn: string;
  departmentNameVi: string;
  positionLevel: number;
  managerNameEn: string | null;
  managerNameVi: string | null;
  workHistory: WorkHistoryItem[];
}

export interface WorkHistoryItem {
  id: number;
  eventType: string;
  effectiveDate: string;
  reason: string | null;
  fromDepartmentCode: string | null;
  fromDepartmentName: string | null;
  toDepartmentCode: string | null;
  toDepartmentName: string | null;
  fromPositionTitle: string | null;
  toPositionTitle: string | null;
}

export interface Position {
  id: number;
  code: string;
  title_zh: string;
  title_en: string;
  title_vi: string;
  level: number;
  isShiftLeader: boolean;
  departmentCode: string;
  departmentNameZh: string;
}

export interface LeaveRequest {
  id: number;
  leaveType: string;
  startDate: string;
  endDate: string;
  reason: string | null;
  status: string;
  approvedAt: string | null;
  employeeCode: string;
  employeeNameZh: string;
  departmentName: string;
  positionTitle: string;
  approverCode: string | null;
  approverName: string | null;
}

export interface AttendanceRecord {
  id: number;
  date: string;
  clockIn: string | null;
  clockOut: string | null;
  status: string;
  employeeCode: string;
  employeeNameZh: string;
  departmentName: string;
  positionTitle: string;
}

export interface HrDashboardSummary {
  employees: { status: string; cnt: number }[];
  departments: { deptType: string; cnt: number }[];
  leaveRequests: { status: string; cnt: number }[];
}

function isDemoMode(): boolean {
  // HR is an authoritative production domain. Never substitute fictional
  // employees, attendance, leave, payroll, or organization data.
  return false;
}

function delay<T>(value: T, ms = 150): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

// ── Performance ─────────────────────────────────────────────────────────────

export interface PerformanceReview {
  id: number;
  employee_id: number;
  name_zh: string;
  name_vi: string;
  employee_no: string;
  period_type: "monthly" | "quarterly" | "annual";
  period_value: string;
  review_date: string;
  reviewer_id: number | null;
  reviewer_name_zh: string | null;
  total_score: number;
  rating: "A" | "B" | "C" | "D" | "F" | null;
  status: "draft" | "submitted" | "confirmed";
  overall_comment: string | null;
  promotion_recommendation_level?: number | null;
  promotion_documented_at?: string | null;
  created_at: string;
}

export interface PerformanceReviewItem {
  id?: number;
  review_id?: number;
  kpi_name_zh: string;
  kpi_name_en: string;
  kpi_name_vi: string;
  target: number;
  actual: number;
  unit: string;
  weight: number;
  score: number;
  comment: string;
}

export interface PerformanceKpi {
  id: number;
  name_zh: string;
  name_en: string;
  name_vi: string;
  unit: string;
  target_min: number;
  target_max: number;
  weight: number;
}

// ── Salary ─────────────────────────────────────────────────────────────────

export interface SalaryRecord {
  id: number;
  employee_id: number;
  name_zh: string;
  name_vi: string;
  employee_no: string;
  year: number;
  month: number;
  base_salary: number;
  normal_days: number;
  absent_days: number;
  late_count: number;
  early_count: number;
  ot_hours: number;
  ot_rate: number;
  allowances_total: number;
  bonus_performance: number;
  bonus_attendance: number;
  bonus_other: number;
  deduction_late: number;
  deduction_absent: number;
  deduction_other: number;
  personal_tax: number;
  social_insurance: number;
  health_insurance: number;
  unemployment_ins: number;
  gross_salary: number;
  total_deductions: number;
  net_salary: number;
  status: "draft" | "confirmed" | "paid";
  paid_at: string | null;
}

export interface SalarySummary {
  monthly: Array<{ year: number; month: number; net_salary: number; gross_salary: number; status: string }>;
  totals: { total_net: number; total_gross: number };
}

const DEMO_DEPARTMENTS: Department[] = [
  { id: 1, code: "MGMT", name_zh: "管理层", name_en: "Management", name_vi: "Quản lý", parentId: null, deptType: "management", headcountTarget: 3, memberCount: 1, status: "active", managerId: 1, managerCode: "VN001", managerNameZh: "李伟", managerTitleZh: "厂长", createdAt: "" },
  { id: 2, code: "PMC", name_zh: "计划部", name_en: "Planning", name_vi: "Kế hoạch", parentId: null, deptType: "planning", headcountTarget: 4, memberCount: 3, status: "active", managerId: 2, managerCode: "VN002", managerNameZh: "陈计划", managerTitleZh: "PMC 主管", createdAt: "" },
  { id: 3, code: "WH", name_zh: "仓库部", name_en: "Warehouse", name_vi: "Kho", parentId: null, deptType: "warehouse", headcountTarget: 6, memberCount: 2, status: "active", managerId: 5, managerCode: "VN005", managerNameZh: "阮仓库", managerTitleZh: "仓库主管", createdAt: "" },
  { id: 4, code: "IQC", name_zh: "品质部", name_en: "Quality", name_vi: "Chất lượng", parentId: null, deptType: "quality", headcountTarget: 5, memberCount: 1, status: "active", managerId: 12, managerCode: "VN012", managerNameZh: "阮氏云", managerTitleZh: "品质主管", createdAt: "" },
  { id: 5, code: "SMT", name_zh: "SMT 生产部", name_en: "SMT Production", name_vi: "Sản xuất SMT", parentId: null, deptType: "production", headcountTarget: 12, memberCount: 5, status: "active", managerId: 7, managerCode: "VN007", managerNameZh: "范文龙", managerTitleZh: "SMT 生产主管", createdAt: "" },
  { id: 6, code: "ENG", name_zh: "工程部", name_en: "Engineering", name_vi: "Kỹ thuật", parentId: null, deptType: "engineering", headcountTarget: 4, memberCount: 2, status: "active", managerId: 13, managerCode: "VN013", managerNameZh: "黎工", managerTitleZh: "工程主管", createdAt: "" },
  { id: 7, code: "ADMIN", name_zh: "行政部", name_en: "Admin", name_vi: "Hành chính", parentId: null, deptType: "admin", headcountTarget: 3, memberCount: 1, status: "active", managerId: 15, managerCode: "VN015", managerNameZh: "行政文", managerTitleZh: "行政主管", createdAt: "" },
];

const DEMO_EMPLOYEES: Employee[] = [
  { id: 1, code: "VN001", displayName: "Li Wei", name_zh: "李伟", name_en: "李伟", name_vi: "Lý Vĩ", gender: "M", phone: "+84 90 123 0001", email: "liwei@ruijing.vn", hireDate: "2024-01-15", dateOfBirth: null, idCardNo: null, address: null, status: "active", departmentId: 1, departmentCode: "MGMT", departmentNameZh: "管理层", positionId: 1, positionTitleZh: "厂长", positionTitleEn: "Factory Director", positionTitleVi: "Giám đốc nhà máy", managerId: null, managerNameZh: null, avatar_url: null },
  { id: 2, code: "VN002", displayName: "Chen PMC", name_zh: "陈计划", name_en: "陈计划", name_vi: "Trần Kế Hoạch", gender: "M", phone: "+84 90 123 0002", email: "chen.pmc@ruijing.vn", hireDate: "2024-02-01", dateOfBirth: null, idCardNo: null, address: null, status: "active", departmentId: 2, departmentCode: "PMC", departmentNameZh: "计划部", positionId: 2, positionTitleZh: "PMC 主管", positionTitleEn: "PMC Manager", positionTitleVi: "Trưởng phòng PMC", managerId: 1, managerNameZh: "李伟", avatar_url: null },
  { id: 3, code: "VN003", displayName: "Chen Planner", name_zh: "陈计划员", name_en: "陈计划员", name_vi: "Trần Kế Hoạch Viên", gender: "F", phone: "+84 90 123 0003", email: "chen.planner@ruijing.vn", hireDate: "2024-03-10", dateOfBirth: null, idCardNo: null, address: null, status: "active", departmentId: 2, departmentCode: "PMC", departmentNameZh: "计划部", positionId: 10, positionTitleZh: "PMC 计划员", positionTitleEn: "PMC Planner", positionTitleVi: "Nhân viên kế hoạch", managerId: 2, managerNameZh: "陈计划", avatar_url: null },
  { id: 4, code: "VN004", displayName: "Chen Planner II", name_zh: "陈计划员2", name_en: "陈计划员2", name_vi: "Trần KH2", gender: "F", phone: "+84 90 123 0004", email: "chen.planner2@ruijing.vn", hireDate: "2024-06-20", dateOfBirth: null, idCardNo: null, address: null, status: "active", departmentId: 2, departmentCode: "PMC", departmentNameZh: "计划部", positionId: 10, positionTitleZh: "PMC 计划员", positionTitleEn: "PMC Planner", positionTitleVi: "Nhân viên kế hoạch", managerId: 2, managerNameZh: "陈计划", avatar_url: null },
  { id: 5, code: "VN005", displayName: "Nguyen Warehouse", name_zh: "阮仓库", name_en: "阮仓库", name_vi: "Nguyễn Kho", gender: "M", phone: "+84 90 123 0005", email: "nguyen.wh@ruijing.vn", hireDate: "2024-01-20", dateOfBirth: null, idCardNo: null, address: null, status: "active", departmentId: 3, departmentCode: "WH", departmentNameZh: "仓库部", positionId: 3, positionTitleZh: "仓库主管", positionTitleEn: "Warehouse Manager", positionTitleVi: "Trưởng phòng kho", managerId: 1, managerNameZh: "李伟", avatar_url: null },
  { id: 6, code: "VN006", displayName: "Tran Hong", name_zh: "陈氏红", name_en: "陈氏红", name_vi: "Trần Thị Hồng", gender: "F", phone: "+84 90 123 0006", email: "tran.hong@ruijing.vn", hireDate: "2024-03-05", dateOfBirth: null, idCardNo: null, address: null, status: "active", departmentId: 3, departmentCode: "WH", departmentNameZh: "仓库部", positionId: 11, positionTitleZh: "仓管员", positionTitleEn: "Warehouse Staff", positionTitleVi: "Nhân viên kho", managerId: 5, managerNameZh: "阮仓库", avatar_url: null },
  { id: 7, code: "VN007", displayName: "Pham Van Long", name_zh: "范文龙", name_en: "范文龙", name_vi: "Phạm Văn Long", gender: "M", phone: "+84 90 123 0007", email: "pham.long@ruijing.vn", hireDate: "2024-02-15", dateOfBirth: null, idCardNo: null, address: null, status: "active", departmentId: 5, departmentCode: "SMT", departmentNameZh: "SMT 生产部", positionId: 8, positionTitleZh: "SMT 技术员", positionTitleEn: "SMT Technician", positionTitleVi: "Kỹ thuật viên SMT", managerId: 5, managerNameZh: "阮仓库", avatar_url: null },
  { id: 8, code: "VN008", displayName: "Le Thi Mai", name_zh: "黎氏梅", name_en: "黎氏梅", name_vi: "Lê Thị Mai", gender: "F", phone: "+84 90 123 0008", email: "le.mai@ruijing.vn", hireDate: "2024-04-01", dateOfBirth: null, idCardNo: null, address: null, status: "active", departmentId: 5, departmentCode: "SMT", departmentNameZh: "SMT 生产部", positionId: 13, positionTitleZh: "操作员", positionTitleEn: "Operator", positionTitleVi: "Nhân viên vận hành", managerId: 7, managerNameZh: "范文龙", avatar_url: null },
  { id: 9, code: "VN009", displayName: "Hoang Van Cuong", name_zh: "黄文强", name_en: "黄文强", name_vi: "Hoàng Văn Cường", gender: "M", phone: "+84 90 123 0009", email: "hoang.cuong@ruijing.vn", hireDate: "2024-04-01", dateOfBirth: null, idCardNo: null, address: null, status: "active", departmentId: 5, departmentCode: "SMT", departmentNameZh: "SMT 生产部", positionId: 13, positionTitleZh: "操作员", positionTitleEn: "Operator", positionTitleVi: "Nhân viên vận hành", managerId: 7, managerNameZh: "范文龙", avatar_url: null },
  { id: 10, code: "VN010", displayName: "Vu Thi Huong", name_zh: "武氏香", name_en: "武氏香", name_vi: "Vũ Thị Hương", gender: "F", phone: "+84 90 123 0010", email: "vu.huong@ruijing.vn", hireDate: "2024-04-15", dateOfBirth: null, idCardNo: null, address: null, status: "active", departmentId: 5, departmentCode: "SMT", departmentNameZh: "SMT 生产部", positionId: 13, positionTitleZh: "操作员", positionTitleEn: "Operator", positionTitleVi: "Nhân viên vận hành", managerId: 7, managerNameZh: "范文龙", avatar_url: null },
  { id: 11, code: "VN011", displayName: "Dang Van Nam", name_zh: "邓文南", name_en: "邓文南", name_vi: "Đặng Văn Nam", gender: "M", phone: "+84 90 123 0011", email: "dang.nam@ruijing.vn", hireDate: "2024-05-01", dateOfBirth: null, idCardNo: null, address: null, status: "active", departmentId: 5, departmentCode: "SMT", departmentNameZh: "SMT 生产部", positionId: 13, positionTitleZh: "操作员", positionTitleEn: "Operator", positionTitleVi: "Nhân viên vận hành", managerId: 7, managerNameZh: "范文龙", avatar_url: null },
  { id: 12, code: "VN012", displayName: "Nguyen Thi Van", name_zh: "阮氏云", name_en: "阮氏云", name_vi: "Nguyễn Thị Vân", gender: "F", phone: "+84 90 123 0012", email: "nguyen.van@ruijing.vn", hireDate: "2024-02-20", dateOfBirth: null, idCardNo: null, address: null, status: "active", departmentId: 4, departmentCode: "IQC", departmentNameZh: "品质部", positionId: 12, positionTitleZh: "IQC 检验员", positionTitleEn: "IQC Inspector", positionTitleVi: "Nhân viên IQC", managerId: 1, managerNameZh: "李伟", avatar_url: null },
  { id: 13, code: "VN013", displayName: "Le Engineer", name_zh: "黎工", name_en: "黎工", name_vi: "Lê Kỹ Sư", gender: "M", phone: "+84 90 123 0013", email: "le.eng@ruijing.vn", hireDate: "2024-03-01", dateOfBirth: null, idCardNo: null, address: null, status: "active", departmentId: 6, departmentCode: "ENG", departmentNameZh: "工程部", positionId: 14, positionTitleZh: "工艺工程师", positionTitleEn: "Process Engineer", positionTitleVi: "Kỹ sư quy trình", managerId: 1, managerNameZh: "李伟", avatar_url: null },
  { id: 14, code: "VN014", displayName: "Pham Van Toan", name_zh: "范文全", name_en: "范文全", name_vi: "Phạm Văn Toàn", gender: "M", phone: "+84 90 123 0014", email: "pham.toan@ruijing.vn", hireDate: "2024-05-10", dateOfBirth: null, idCardNo: null, address: null, status: "active", departmentId: 6, departmentCode: "ENG", departmentNameZh: "工程部", positionId: 15, positionTitleZh: "设备工程师", positionTitleEn: "Equipment Engineer", positionTitleVi: "Kỹ sư thiết bị", managerId: 13, managerNameZh: "黎工", avatar_url: null },
  { id: 15, code: "VN015", displayName: "Admin Van", name_zh: "行政文", name_en: "行政文", name_vi: "Hành Chính Văn", gender: "F", phone: "+84 90 123 0015", email: "admin.van@ruijing.vn", hireDate: "2024-06-01", dateOfBirth: null, idCardNo: null, address: null, status: "active", departmentId: 7, departmentCode: "ADMIN", departmentNameZh: "行政部", positionId: 16, positionTitleZh: "行政专员", positionTitleEn: "Admin Officer", positionTitleVi: "Nhân viên hành chính", managerId: 1, managerNameZh: "李伟", avatar_url: null },
];

const DEMO_ATTENDANCE: AttendanceRecord[] = [
  { id: 1, date: "2026-06-16", clockIn: "07:55", clockOut: "17:05", status: "normal", employeeCode: "VN001", employeeNameZh: "李伟", departmentName: "管理层", positionTitle: "厂长" },
  { id: 2, date: "2026-06-16", clockIn: "07:50", clockOut: "17:10", status: "normal", employeeCode: "VN002", employeeNameZh: "陈计划", departmentName: "计划部", positionTitle: "PMC 主管" },
  { id: 3, date: "2026-06-16", clockIn: "08:05", clockOut: "17:00", status: "normal", employeeCode: "VN003", employeeNameZh: "陈计划员", departmentName: "计划部", positionTitle: "PMC 计划员" },
  { id: 4, date: "2026-06-16", clockIn: "08:30", clockOut: "17:15", status: "late", employeeCode: "VN004", employeeNameZh: "陈计划员2", departmentName: "计划部", positionTitle: "PMC 计划员" },
  { id: 5, date: "2026-06-16", clockIn: "07:45", clockOut: "16:55", status: "normal", employeeCode: "VN005", employeeNameZh: "阮仓库", departmentName: "仓库部", positionTitle: "仓库主管" },
  { id: 6, date: "2026-06-16", clockIn: "07:50", clockOut: "17:00", status: "normal", employeeCode: "VN006", employeeNameZh: "陈氏红", departmentName: "仓库部", positionTitle: "仓管员" },
  { id: 7, date: "2026-06-16", clockIn: "07:55", clockOut: "17:30", status: "normal", employeeCode: "VN007", employeeNameZh: "范文龙", departmentName: "SMT 生产部", positionTitle: "SMT 技术员" },
  { id: 8, date: "2026-06-16", clockIn: "07:40", clockOut: "16:50", status: "normal", employeeCode: "VN008", employeeNameZh: "黎氏梅", departmentName: "SMT 生产部", positionTitle: "操作员" },
  { id: 9, date: "2026-06-16", clockIn: "09:00", clockOut: "17:00", status: "late", employeeCode: "VN009", employeeNameZh: "黄文强", departmentName: "SMT 生产部", positionTitle: "操作员" },
  { id: 10, date: "2026-06-16", clockIn: "07:50", clockOut: "17:05", status: "normal", employeeCode: "VN010", employeeNameZh: "武氏香", departmentName: "SMT 生产部", positionTitle: "操作员" },
  { id: 11, date: "2026-06-16", clockIn: "07:55", clockOut: "17:00", status: "normal", employeeCode: "VN011", employeeNameZh: "邓文南", departmentName: "SMT 生产部", positionTitle: "操作员" },
  { id: 12, date: "2026-06-16", clockIn: "07:48", clockOut: "17:02", status: "normal", employeeCode: "VN012", employeeNameZh: "阮氏云", departmentName: "品质部", positionTitle: "IQC 检验员" },
  { id: 13, date: "2026-06-16", clockIn: "08:15", clockOut: "17:20", status: "normal", employeeCode: "VN013", employeeNameZh: "黎工", departmentName: "工程部", positionTitle: "工艺工程师" },
  { id: 14, date: "2026-06-16", clockIn: "07:50", clockOut: "17:10", status: "normal", employeeCode: "VN014", employeeNameZh: "范文全", departmentName: "工程部", positionTitle: "设备工程师" },
  { id: 15, date: "2026-06-16", clockIn: "07:55", clockOut: "16:45", status: "early", employeeCode: "VN015", employeeNameZh: "行政文", departmentName: "行政部", positionTitle: "行政专员" },
];

const DEMO_LEAVE: LeaveRequest[] = [
  { id: 1, leaveType: "annual", startDate: "2026-06-20", endDate: "2026-06-25", reason: "Family vacation", status: "approved", approvedAt: "2026-06-15T09:00:00Z", employeeCode: "VN003", employeeNameZh: "陈计划员", departmentName: "计划部", positionTitle: "PMC 计划员", approverCode: "VN002", approverName: "陈计划" },
  { id: 2, leaveType: "sick", startDate: "2026-06-18", endDate: "2026-06-18", reason: "Doctor appointment", status: "approved", approvedAt: "2026-06-17T08:00:00Z", employeeCode: "VN008", employeeNameZh: "黎氏梅", departmentName: "SMT 生产部", positionTitle: "操作员", approverCode: "VN002", approverName: "陈计划" },
  { id: 3, leaveType: "personal", startDate: "2026-06-23", endDate: "2026-06-23", reason: "Personal matter", status: "pending", approvedAt: null, employeeCode: "VN009", employeeNameZh: "黄文强", departmentName: "SMT 生产部", positionTitle: "操作员", approverCode: null, approverName: null },
  { id: 4, leaveType: "annual", startDate: "2026-07-01", endDate: "2026-07-05", reason: "Home visit", status: "pending", approvedAt: null, employeeCode: "VN004", employeeNameZh: "陈计划员2", departmentName: "计划部", positionTitle: "PMC 计划员", approverCode: null, approverName: null },
];

// ── Org chart data from dm/组织架构.md ──────────────────────────
const DEMO_ORG_NODES: OrgChartNode[] = [
  { id: 1, code: "HQ", name_zh: "公司总负责人", name_en: "Headquarters", name_vi: "Tổng công ty", parent_id: null, dept_type: "management", status: "active", managerId: null, managerNameZh: "张先生", managerTitleZh: "CEO", memberCount: 1, level: 0 },
  { id: 2, code: "HN", name_zh: "华南工厂", name_en: "South China Factory", name_vi: "Nhà máy Hoa Nam", parent_id: 1, dept_type: "management", status: "active", managerId: null, managerNameZh: "赵明军", managerTitleZh: "总负责人", memberCount: 1, level: 1 },
  { id: 3, code: "PROD", name_zh: "生产部", name_en: "Production", name_vi: "Sản xuất", parent_id: 1, dept_type: "production", status: "active", managerId: null, managerNameZh: "***", managerTitleZh: "负责人（精干）", memberCount: 3, level: 1 },
  { id: 4, code: "ENG", name_zh: "工程部", name_en: "Engineering", name_vi: "Kỹ thuật", parent_id: 1, dept_type: "engineering", status: "active", managerId: null, managerNameZh: "黎管", managerTitleZh: "负责人（中干）", memberCount: 5, level: 1 },
  { id: 5, code: "QC", name_zh: "品质部", name_en: "Quality", name_vi: "Chất lượng", parent_id: 1, dept_type: "quality", status: "active", managerId: null, managerNameZh: "***", managerTitleZh: "负责人（中干）", memberCount: 6, level: 1 },
  { id: 6, code: "SUPPLY", name_zh: "供应货部", name_en: "Supply", name_vi: "Cung ứng", parent_id: 1, dept_type: "warehouse", status: "active", managerId: null, managerNameZh: "Tina", managerTitleZh: "负责人", memberCount: 3, level: 1 },
  { id: 7, code: "FIN", name_zh: "财务部", name_en: "Finance", name_vi: "Tài chính", parent_id: 1, dept_type: "finance", status: "active", managerId: null, managerNameZh: "", managerTitleZh: "负责人", memberCount: 2, level: 1 },
  // 生产部下属
  { id: 31, code: "SMTL", name_zh: "SMT组长", name_en: "SMT Leader", name_vi: "Tổ trưởng SMT", parent_id: 3, dept_type: "production", status: "active", managerId: null, managerNameZh: "", managerTitleZh: "", memberCount: 1, level: 2 },
  { id: 32, code: "AUTOL", name_zh: "自动/线线组长", name_en: "Auto Line Leader", name_vi: "Tổ trưởng dây chuyền", parent_id: 3, dept_type: "production", status: "active", managerId: null, managerNameZh: "", managerTitleZh: "", memberCount: 1, level: 2 },
  { id: 33, code: "CLERK", name_zh: "文员/考勤", name_en: "Clerk", name_vi: "Văn thư", parent_id: 3, dept_type: "production", status: "active", managerId: null, managerNameZh: "", managerTitleZh: "", memberCount: 1, level: 2 },
  // 工程部下属
  { id: 41, code: "PE", name_zh: "PE / 维修", name_en: "PE / Maintenance", name_vi: "PE / Bảo trì", parent_id: 4, dept_type: "engineering", status: "active", managerId: null, managerNameZh: "", managerTitleZh: "", memberCount: 1, level: 2 },
  { id: 42, code: "SMTT", name_zh: "SMT技术负责人", name_en: "SMT Tech Lead", name_vi: "Kỹ thuật SMT", parent_id: 4, dept_type: "engineering", status: "active", managerId: null, managerNameZh: "", managerTitleZh: "", memberCount: 1, level: 2 },
  { id: 43, code: "TE", name_zh: "TE", name_en: "Test Engineering", name_vi: "Kỹ thuật thử nghiệm", parent_id: 4, dept_type: "engineering", status: "active", managerId: null, managerNameZh: "", managerTitleZh: "", memberCount: 1, level: 2 },
  { id: 44, code: "ME", name_zh: "ME", name_en: "Manufacturing Engineering", name_vi: "Kỹ thuật sản xuất", parent_id: 4, dept_type: "engineering", status: "active", managerId: null, managerNameZh: "", managerTitleZh: "", memberCount: 2, level: 2 },
  { id: 45, code: "SYSADM", name_zh: "系统维护", name_en: "System Admin", name_vi: "Quản trị hệ thống", parent_id: 4, dept_type: "engineering", status: "active", managerId: null, managerNameZh: "", managerTitleZh: "", memberCount: 1, level: 2 },
  // 品质部下属
  { id: 51, code: "DEP_IQC", name_zh: "IQC", name_en: "IQC", name_vi: "IQC", parent_id: 5, dept_type: "quality", status: "active", managerId: null, managerNameZh: "", managerTitleZh: "", memberCount: 2, level: 2 },
  { id: 52, code: "IPQC", name_zh: "IPQC", name_en: "IPQC", name_vi: "IPQC", parent_id: 5, dept_type: "quality", status: "active", managerId: null, managerNameZh: "", managerTitleZh: "", memberCount: 1, level: 2 },
  { id: 53, code: "OQC", name_zh: "OQC", name_en: "OQC", name_vi: "OQC", parent_id: 5, dept_type: "quality", status: "active", managerId: null, managerNameZh: "", managerTitleZh: "", memberCount: 2, level: 2 },
  { id: 54, code: "PQC", name_zh: "PQC", name_en: "PQC", name_vi: "PQC", parent_id: 5, dept_type: "quality", status: "active", managerId: null, managerNameZh: "", managerTitleZh: "", memberCount: 1, level: 2 },
  { id: 55, code: "QMS", name_zh: "体系管理", name_en: "QMS", name_vi: "Quản lý hệ thống", parent_id: 5, dept_type: "quality", status: "active", managerId: null, managerNameZh: "", managerTitleZh: "", memberCount: 1, level: 2 },
  // 供应货部下属
  { id: 61, code: "PMC", name_zh: "PC / MC", name_en: "PC / MC", name_vi: "PC / MC", parent_id: 6, dept_type: "planning", status: "active", managerId: null, managerNameZh: "", managerTitleZh: "", memberCount: 1, level: 2 },
  { id: 62, code: "WHMAT", name_zh: "材料仓管员", name_en: "Material Keeper", name_vi: "Thủ kho vật tư", parent_id: 6, dept_type: "warehouse", status: "active", managerId: null, managerNameZh: "", managerTitleZh: "", memberCount: 1, level: 2 },
  { id: 63, code: "WHFIN", name_zh: "成品仓管员", name_en: "Finished Goods Keeper", name_vi: "Thủ kho thành phẩm", parent_id: 6, dept_type: "warehouse", status: "active", managerId: null, managerNameZh: "", managerTitleZh: "", memberCount: 1, level: 2 },
  // 财务部下属
  { id: 71, code: "ACC", name_zh: "会计 / 出纳", name_en: "Accountant", name_vi: "Kế toán", parent_id: 7, dept_type: "finance", status: "active", managerId: null, managerNameZh: "", managerTitleZh: "", memberCount: 2, level: 2 },
];

export const hrApi = {
  async getDepartments(): Promise<ListEnvelope<Department>> {
    return apiClient.get<ListEnvelope<Department>>("/hr/departments");
  },

  async getOrgChart(): Promise<Envelope<{ items: OrgChartNode[] }>> {
    if (isDemoMode()) {
      return delay({ data: { items: DEMO_ORG_NODES }, meta: { serverTime: new Date().toISOString() } });
    }
    return apiClient.get<Envelope<{ items: OrgChartNode[] }>>("/hr/org-chart");
  },

  async getEmployees(params?: { departmentId?: number; status?: string; q?: string; limit?: number; offset?: number }): Promise<ListEnvelope<Employee>> {
      const qs = new URLSearchParams();
      if (params?.departmentId) qs.set("departmentId", String(params.departmentId));
      if (params?.status) qs.set("status", params.status);
      if (params?.q) qs.set("q", params.q);
      if (params?.limit != null) qs.set("limit", String(params.limit));
      if (params?.offset != null) qs.set("offset", String(params.offset));
      const query = qs.toString();
      try {
        return await apiClient.get<ListEnvelope<Employee>>(`/hr/employees${query ? `?${query}` : ""}`);
      } catch {
        // Never substitute fictional staff when the authoritative HR service is unavailable.
        return delay({ items: [], total: 0 });
      }
    },

  async getEmployee(code: string): Promise<EmployeeDetail> {
    if (isDemoMode()) {
      const emp = DEMO_EMPLOYEES.find((e) => e.code === code);
      if (!emp) throw new Error("Employee not found");
      return { ...emp, terminationDate: null, departmentNameEn: emp.departmentNameZh, departmentNameVi: emp.name_vi, positionLevel: 3, managerNameEn: emp.managerNameZh ?? null, managerNameVi: emp.managerNameZh ?? null, workHistory: [] };
    }
    return apiClient.get<EmployeeDetail>(`/hr/employees/${code}`);
  },

  async getPositions(departmentId?: number): Promise<ListEnvelope<Position>> {
    if (isDemoMode()) {
      const DEMO_POSITIONS: Position[] = [
        { id: 1, code: "DIR-01", title_zh: "厂长", title_en: "Factory Director", title_vi: "Giám đốc nhà máy", level: 5, isShiftLeader: false, departmentCode: "MGMT", departmentNameZh: "管理层" },
        { id: 2, code: "MGR-02", title_zh: "PMC 主管", title_en: "PMC Manager", title_vi: "Trưởng phòng PMC", level: 4, isShiftLeader: false, departmentCode: "PMC", departmentNameZh: "计划部" },
        { id: 10, code: "STAFF-01", title_zh: "PMC 计划员", title_en: "PMC Planner", title_vi: "Nhân viên kế hoạch", level: 1, isShiftLeader: false, departmentCode: "PMC", departmentNameZh: "计划部" },
        { id: 3, code: "MGR-03", title_zh: "仓库主管", title_en: "Warehouse Manager", title_vi: "Trưởng phòng kho", level: 4, isShiftLeader: false, departmentCode: "WH", departmentNameZh: "仓库部" },
        { id: 11, code: "STAFF-02", title_zh: "仓管员", title_en: "Warehouse Staff", title_vi: "Nhân viên kho", level: 1, isShiftLeader: false, departmentCode: "WH", departmentNameZh: "仓库部" },
        { id: 4, code: "MGR-04", title_zh: "SMT 生产主管", title_en: "SMT Production Manager", title_vi: "Trưởng phòng SMT", level: 4, isShiftLeader: false, departmentCode: "SMT", departmentNameZh: "SMT 生产部" },
        { id: 8, code: "SUP-01", title_zh: "SMT 技术员", title_en: "SMT Technician", title_vi: "Kỹ thuật viên SMT", level: 3, isShiftLeader: false, departmentCode: "SMT", departmentNameZh: "SMT 生产部" },
        { id: 13, code: "STAFF-04", title_zh: "操作员", title_en: "Operator", title_vi: "Nhân viên vận hành", level: 1, isShiftLeader: false, departmentCode: "SMT", departmentNameZh: "SMT 生产部" },
        { id: 12, code: "STAFF-03", title_zh: "IQC 检验员", title_en: "IQC Inspector", title_vi: "Nhân viên IQC", level: 1, isShiftLeader: false, departmentCode: "IQC", departmentNameZh: "品质部" },
        { id: 14, code: "STAFF-05", title_zh: "工艺工程师", title_en: "Process Engineer", title_vi: "Kỹ sư quy trình", level: 1, isShiftLeader: false, departmentCode: "ENG", departmentNameZh: "工程部" },
        { id: 15, code: "STAFF-06", title_zh: "设备工程师", title_en: "Equipment Engineer", title_vi: "Kỹ sư thiết bị", level: 1, isShiftLeader: false, departmentCode: "ENG", departmentNameZh: "工程部" },
        { id: 16, code: "STAFF-07", title_zh: "行政专员", title_en: "Admin Officer", title_vi: "Nhân viên hành chính", level: 1, isShiftLeader: false, departmentCode: "ADMIN", departmentNameZh: "行政部" },
      ];
      const items = departmentId ? DEMO_POSITIONS.filter((p) => p.id === departmentId) : DEMO_POSITIONS;
      return delay({ items, total: items.length });
    }
    const qs = departmentId ? `?departmentId=${departmentId}` : "";
    return apiClient.get<ListEnvelope<Position>>(`/hr/positions${qs}`);
  },

  async getLeaveRequests(params?: { status?: string; employeeId?: number; limit?: number; offset?: number }): Promise<ListEnvelope<LeaveRequest>> {
    if (isDemoMode()) {
      let items = [...DEMO_LEAVE];
      if (params?.status) items = items.filter((l) => l.status === params.status);
      return delay({ items, total: items.length });
    }
    const qs = new URLSearchParams();
    if (params?.status) qs.set("status", params.status);
    if (params?.employeeId) qs.set("employeeId", String(params.employeeId));
    if (params?.limit != null) qs.set("limit", String(params.limit));
    if (params?.offset != null) qs.set("offset", String(params.offset));
    const query = qs.toString();
    return apiClient.get<ListEnvelope<LeaveRequest>>(`/hr/leave-requests${query ? `?${query}` : ""}`);
  },

  async createLeaveRequest(payload: { leaveType: string; startDate: string; endDate: string; reason?: string }): Promise<{ item: LeaveRequest }> {
    if (isDemoMode()) {
      return delay({ item: { id: Date.now(), ...payload, reason: payload.reason ?? null, status: "pending", approvedAt: null, employeeCode: "VN001", employeeNameZh: "Current User", departmentName: "SMT 生产部", positionTitle: "操作员", approverCode: null, approverName: null } });
    }
    return apiClient.post<{ item: LeaveRequest }>("/hr/leave-requests", { payload });
  },

  async updateLeaveRequest(id: number, status: "approved" | "rejected"): Promise<MutateEnvelope<{ id: number; status: string }>> {
    if (isDemoMode()) return delay({ item: { id, status }, auditEventId: id });
    return apiClient.patch<MutateEnvelope<{ id: number; status: string }>>(`/hr/leave-requests/${id}`, { payload: { status } });
  },

  async getAttendance(params?: { date?: string; employeeId?: number; limit?: number; offset?: number }): Promise<ListEnvelope<AttendanceRecord>> {
    if (isDemoMode()) {
      let items = [...DEMO_ATTENDANCE];
      if (params?.date) items = items.filter((a) => a.date === params.date);
      if (params?.employeeId) items = items.filter((a) => a.id === params.employeeId);
      return delay({ items, total: items.length });
    }
    const qs = new URLSearchParams();
    if (params?.date) qs.set("date", params.date);
    if (params?.employeeId) qs.set("employeeId", String(params.employeeId));
    if (params?.limit != null) qs.set("limit", String(params.limit));
    if (params?.offset != null) qs.set("offset", String(params.offset));
    const query = qs.toString();
    return apiClient.get<ListEnvelope<AttendanceRecord>>(`/hr/attendance${query ? `?${query}` : ""}`);
  },

  async getDashboard(): Promise<HrDashboardSummary> {
    if (isDemoMode()) {
      return delay({
        employees: [
          { status: "active", cnt: 14 },
          { status: "inactive", cnt: 1 },
        ],
        departments: [
          { deptType: "production", cnt: 1 },
          { deptType: "quality", cnt: 1 },
          { deptType: "engineering", cnt: 1 },
          { deptType: "warehouse", cnt: 1 },
          { deptType: "admin", cnt: 1 },
          { deptType: "management", cnt: 1 },
          { deptType: "planning", cnt: 1 },
        ],
        leaveRequests: [
          { status: "approved", cnt: 2 },
          { status: "pending", cnt: 2 },
        ],
      });
    }
    return apiClient.get<HrDashboardSummary>("/hr/dashboard");
  },

  async createDepartment(payload: {
    code: string;
    name_zh: string;
    name_en: string;
    name_vi: string;
    deptType: string;
    parentId?: number;
    managerId?: number;
  }): Promise<MutateEnvelope<Department>> {
    if (isDemoMode()) {
      const newDept: Department = {
        id: Date.now(),
        code: payload.code,
        name_zh: payload.name_zh,
        name_en: payload.name_en,
        name_vi: payload.name_vi,
        parentId: payload.parentId ?? null,
        deptType: payload.deptType,
        headcountTarget: 0,
        memberCount: 0,
        status: "active",
        managerId: payload.managerId ?? null,
        managerCode: null,
        managerNameZh: null,
        managerTitleZh: null,
        createdAt: new Date().toISOString(),
      };
      DEMO_DEPARTMENTS.push(newDept);
      return delay({ item: newDept, auditEventId: Date.now() });
    }
    return apiClient.post<MutateEnvelope<Department>>("/hr/departments", { payload });
  },

  async updateDepartment(id: number, payload: Partial<{
    name_zh: string;
    name_en: string;
    name_vi: string;
    deptType: string;
    parentId: number | null;
    managerId: number | null;
    status: string;
  }>): Promise<MutateEnvelope<Department>> {
    if (isDemoMode()) {
      const idx = DEMO_DEPARTMENTS.findIndex((d) => d.id === id);
      if (idx === -1) throw new Error("Department not found");
      DEMO_DEPARTMENTS[idx] = { ...DEMO_DEPARTMENTS[idx], ...payload };
      return delay({ item: DEMO_DEPARTMENTS[idx], auditEventId: id });
    }
    return apiClient.patch<MutateEnvelope<Department>>(`/hr/departments/${id}`, { payload });
  },

  async deleteDepartment(id: number): Promise<MutateEnvelope<{ id: number }>> {
    if (isDemoMode()) {
      const idx = DEMO_DEPARTMENTS.findIndex((d) => d.id === id);
      if (idx !== -1) {
        DEMO_DEPARTMENTS.splice(idx, 1);
      }
      return delay({ item: { id }, auditEventId: id });
    }
    return apiClient.delete<MutateEnvelope<{ id: number }>>(`/hr/departments/${id}`);
  },

  // ── Performance ───────────────────────────────────────────────

  async getPerformanceReviews(params?: {
    employee_id?: number; period_type?: string; period_value?: string; status?: string;
  }): Promise<ListEnvelope<PerformanceReview>> {
    const q = new URLSearchParams();
    if (params?.employee_id)  q.set("employee_id", String(params.employee_id));
    if (params?.period_type)  q.set("period_type", params.period_type);
    if (params?.period_value) q.set("period_value", params.period_value);
    if (params?.status)       q.set("status", params.status);
    const path = `/hr/performance/reviews${q.toString() ? `?${q}` : ""}`;
    return apiClient.get<ListEnvelope<PerformanceReview>>(path);
  },

  async createPerformanceReview(payload: {
    employee_id: number; period_type: string; period_value: string; review_date: string;
    reviewer_id?: number; items?: PerformanceReviewItem[];
  }): Promise<{ review: PerformanceReview }> {
    return apiClient.post(`/hr/performance/reviews`, payload);
  },

  async updatePerformanceReview(id: number, payload: Partial<{
    total_score: number; rating: string; status: string; overall_comment: string; promotion_recommendation_level: number; items: PerformanceReviewItem[];
  }>): Promise<PerformanceReview> {
    return apiClient.put(`/hr/performance/reviews/${id}`, payload);
  },

  async getPerformanceKpis(): Promise<ListEnvelope<PerformanceKpi>> {
    return apiClient.get(`/hr/performance/kpis`);
  },
  async getPromotionAppraisalGates(reviewId: number): Promise<{ items: any[] }> {
    return apiClient.get(`/hr/performance/reviews/${reviewId}/promotion-gates`);
  },
  async updatePromotionAppraisalGate(reviewId: number, gateId: number, payload: { status: "passed" | "failed" | "waived"; evidence_note?: string }): Promise<any> {
    return apiClient.put(`/hr/performance/reviews/${reviewId}/promotion-gates/${gateId}`, payload);
  },

  // ── Salary ────────────────────────────────────────────────────

  async getSalaryRecords(params?: {
    employee_id?: number; year?: number; month?: number; status?: string;
  }): Promise<ListEnvelope<SalaryRecord>> {
    const q = new URLSearchParams();
    if (params?.employee_id) q.set("employee_id", String(params.employee_id));
    if (params?.year)        q.set("year", String(params.year));
    if (params?.month)       q.set("month", String(params.month));
    if (params?.status)      q.set("status", params.status);
    const path = `/hr/salary/records${q.toString() ? `?${q}` : ""}`;
    return apiClient.get<ListEnvelope<SalaryRecord>>(path);
  },

  async upsertSalaryRecord(payload: Omit<SalaryRecord, "id" | "name_zh" | "name_vi" | "employee_no" | "gross_salary" | "total_deductions" | "net_salary" | "status" | "paid_at">): Promise<{ record: SalaryRecord; calculated: { gross_salary: number; total_deductions: number; net_salary: number } }> {
    return apiClient.post(`/hr/salary/records`, payload);
  },

  async confirmSalaryRecord(id: number, status: "confirmed" | "paid"): Promise<SalaryRecord> {
    return apiClient.patch(`/hr/salary/records/${id}`, { status });
  },

  async getSalarySummary(employeeId: number, year: number): Promise<SalarySummary> {
    return apiClient.get(`/hr/salary/employees/${employeeId}/summary?year=${year}`);
  },

  async generateEmployeeQr(employeeId: number, validDays = 365) {
    return apiClient.post<{ item: QrGenerated; auditEventId?: number }>(`/hr/employees/${employeeId}/qr-code`, { validDays });
  },
  async getEmployeeQr(employeeId: number): Promise<QrStatus> {
    return apiClient.get<QrStatus>(`/hr/employees/${employeeId}/qr-code`);
  },
  async revokeEmployeeQr(employeeId: number) {
    return apiClient.delete<{ item: { employeeId: number; revoked: boolean } }>(`/hr/employees/${employeeId}/qr-code`);
  },
  async getEmployeeQrAudit(employeeId: number, limit = 50, offset = 0) {
    return apiClient.get<{ items: any[]; total: number }>(`/hr/employees/${employeeId}/qr-code/audit?limit=${limit}&offset=${offset}`);
  },
  async getEmployeeQrBatch(ids: number[]) {
    return apiClient.get<{ items: any[]; total: number }>(`/hr/employees/qr-code/batch?ids=${ids.join(',')}`);
  },

  /** Employee panel: get own profile */
  async getEmployeeById(employeeId: number) {
    const res = await apiClient.get<{ item: any }>(`/hr/employees/${employeeId}`);
    return res.item;
  },

  /** Employee panel: attendance today summary */
  async getAttendanceSummary(employeeId: number, limit = 30) {
    return apiClient.get<ListEnvelope<any>>(`/hr/attendance?employeeId=${employeeId}&limit=${limit}`);
  },

  /** Employee panel: clock in */
  async clockIn(employeeId: number) {
    return apiClient.post<{ item: any }>(`/hr/attendance/clock-in`, { payload: { employeeId } });
  },

  /** Employee panel: clock out */
  async clockOut(employeeId: number) {
    return apiClient.post<{ item: any }>(`/hr/attendance/clock-out`, { payload: { employeeId } });
  },

  /** Employee panel: upload avatar */
  async uploadAvatar(employeeId: number, formData: FormData) {
    const resp = await fetch(`/api/hr/employees/${employeeId}/avatar`, {
      method: "POST",
      body: formData,
      headers: { "Authorization": `Bearer ${authStorage.getToken()}` },
    });
    if (!resp.ok) throw new Error(`Upload failed: ${resp.status}`);
    return resp.json();
  },

  // ── Training ────────────────────────────────────────────────────────
  async getTrainingCourses(params?: { category?: string; status?: string }): Promise<ListEnvelope<TrainingCourse>> {
    return apiClient.get("/hr/training/courses", params);
  },
  async getTrainingPlans(params?: { year?: number; status?: string }): Promise<ListEnvelope<TrainingPlan>> {
    return apiClient.get("/hr/training/plans", params);
  },
  async getTrainingSessions(params?: { plan_id?: number; status?: string; date_from?: string; date_to?: string }): Promise<ListEnvelope<TrainingSession>> {
    return apiClient.get("/hr/training/sessions", params);
  },
  async getTrainingRecords(params?: { employee_id?: number; session_id?: number; status?: string }): Promise<ListEnvelope<TrainingRecord>> {
    return apiClient.get("/hr/training/records", params);
  },
  async createTrainingRecord(payload: { employee_id: number; session_id?: number; course_id: number; plan_id?: number }): Promise<Envelope<TrainingRecord>> {
    return apiClient.post("/hr/training/records", payload);
  },
  async updateTrainingRecord(id: number, payload: { assessment_score?: number; rating?: string; status?: string; certificate_no?: string }): Promise<Envelope<TrainingRecord>> {
    return apiClient.patch("/hr/training/records/" + id, payload);
  },
  async getTrainingVideos(params?: TrainingVideoQuery): Promise<ListEnvelope<TrainingVideo>> {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params || {})) {
      if (value !== undefined && value !== "") search.set(key, String(value));
    }
    return apiClient.get(`/hr/training/videos${search.size ? `?${search.toString()}` : ""}`);
  },
  async createTrainingVideo(payload: CreateTrainingVideoPayload): Promise<MutateEnvelope<TrainingVideo>> {
    return apiClient.post("/hr/training/videos", payload);
  },
  async publishTrainingVideo(id: number): Promise<MutateEnvelope<TrainingVideo>> {
    return apiClient.post(`/hr/training/videos/${id}/publish`, {});
  },

  // ── Onboarding ───────────────────────────────────────────────────────
  async getOnboardingTemplates(): Promise<ListEnvelope<OnboardingTemplate>> {
    return apiClient.get("/hr/onboarding/templates");
  },
  async getOnboardingEmployees(params?: { status?: string }): Promise<ListEnvelope<OnboardingEmployee>> {
    return apiClient.get("/hr/onboarding/employees", params);
  },
  async getOnboardingTasks(employeeId: number): Promise<ListEnvelope<OnboardingTaskInstance>> {
    return apiClient.get("/hr/onboarding/employees/" + employeeId + "/tasks");
  },
  async startOnboarding(employeeId: number, payload: { template_id?: number; join_date?: string; mentor_id?: number }): Promise<Envelope<OnboardingEmployee>> {
    return apiClient.post("/hr/onboarding/employees/" + employeeId + "/start", payload);
  },
  async completeOnboardingTask(taskId: number, payload?: { remarks?: string }): Promise<Envelope<OnboardingTaskInstance>> {
    return apiClient.patch("/hr/onboarding/tasks/" + taskId + "/complete", payload || {});
  },

  // ── Offboarding ──────────────────────────────────────────────────────
  async getOffboardingEmployees(params?: { status?: string; termination_type?: string }): Promise<ListEnvelope<OffboardingEmployee>> {
    return apiClient.get("/hr/offboarding/employees", params);
  },
  async getOffboardingTasks(employeeId: number): Promise<ListEnvelope<OffboardingTaskInstance>> {
    return apiClient.get("/hr/offboarding/employees/" + employeeId + "/tasks");
  },
  async startOffboarding(employeeId: number, payload: { template_id?: number; termination_type?: string; last_work_date?: string; exit_interview_by?: number }): Promise<Envelope<OffboardingEmployee>> {
    return apiClient.post("/hr/offboarding/employees/" + employeeId + "/start", payload);
  },
  async completeOffboardingTask(taskId: number, payload?: { remarks?: string }): Promise<Envelope<OffboardingTaskInstance>> {
    return apiClient.patch("/hr/offboarding/tasks/" + taskId + "/complete", payload || {});
  },

  // ── Attendance Stats & Rules ─────────────────────────────────────────
  async getAttendanceStats(params?: { employee_id?: number; year?: number; month?: number }): Promise<ListEnvelope<AttendanceMonthlyStat>> {
    return apiClient.get("/hr/attendance/stats", params);
  },
  async computeAttendanceStats(year: number, month: number): Promise<{ success: boolean; message: string }> {
    return apiClient.post("/hr/attendance/stats/compute", { year, month });
  },
  async getAttendanceClockDetail(params?: { employee_id?: number; date_from?: string; date_to?: string }): Promise<ListEnvelope<AttendanceClockDetail>> {
    return apiClient.get("/hr/attendance/clock-detail", params);
  },
  async upsertAttendanceClock(payload: { employee_id: number; work_date: string; clock_in?: string; clock_out?: string; clock_in_method?: string; device_id?: string; remark?: string }): Promise<Envelope<AttendanceClockDetail>> {
    return apiClient.post("/hr/attendance/clock-detail", payload);
  },
  async getAttendanceRules(): Promise<ListEnvelope<AttendanceRule>> {
    return apiClient.get("/hr/attendance/rules");
  },

  // ── Performance KPI ─────────────────────────────────────────────────
  async getPerfKpiTemplates(): Promise<ListEnvelope<PerfKpiTemplate>> {
    return apiClient.get("/hr/performance/kpi-templates");
  },
  async getPerfKpiTemplateItems(templateId: number): Promise<ListEnvelope<PerfKpiTemplateItem>> {
    return apiClient.get("/hr/performance/kpi-templates/" + templateId + "/items");
  },
  async getPerfResults(params?: { employee_id?: number; year?: number; month?: number }): Promise<ListEnvelope<EmpKpiResult>> {
    return apiClient.get("/hr/performance/results", params);
  },
  async createPerfResult(payload: { employee_id: number; template_id?: number; period_year: number; period_month?: number; item_id?: number; item_name_zh?: string; item_category?: string; target_value?: number; actual_value?: number; score?: number; weight?: number; auto_computed?: boolean }): Promise<Envelope<EmpKpiResult>> {
    return apiClient.post("/hr/performance/results", payload);
  },
  async getPerfSummary(params?: { year?: number; month?: number; department_id?: number }): Promise<ListEnvelope<PerfScoreSummary>> {
    return apiClient.get("/hr/performance/summary", params);
  },
  async computePerfSummary(year: number, month: number): Promise<{ success: boolean; message: string }> {
    return apiClient.post("/hr/performance/summary/compute", { year, month });
  },

  // ── Rewards ─────────────────────────────────────────────────────────
  async getRewardCategories(): Promise<ListEnvelope<RewardCategory>> {
    return apiClient.get("/hr/rewards/categories");
  },
  async getRewards(params?: { employee_id?: number; category_id?: number; payment_status?: string; year?: number; month?: number }): Promise<ListEnvelope<EmployeeReward>> {
    return apiClient.get("/hr/rewards", params);
  },
  async createReward(payload: { employee_id: number; category_id: number; reward_date: string; amount?: number; reason_zh: string; reason_en?: string; reason_vi?: string; award_level?: string; issued_by?: number; approver_id?: number; period_year?: number; period_month?: number; remark?: string }): Promise<Envelope<EmployeeReward>> {
    return apiClient.post("/hr/rewards", payload);
  },
  async updateRewardPayment(id: number, payment_status: string): Promise<Envelope<EmployeeReward>> {
    return apiClient.patch("/hr/rewards/" + id + "/payment", { payment_status });
  },

  // ── Periodic Bonus ──────────────────────────────────────────────────
  async getPeriodicBonuses(params?: { employee_id?: number; bonus_type?: string; year?: number; status?: string }): Promise<ListEnvelope<PeriodicBonus>> {
    return apiClient.get("/hr/bonus/periodic", params);
  },
  async createPeriodicBonus(payload: { employee_id: number; bonus_type: string; period_year: number; period_quarter?: number; base_amount?: number; coefficient?: number; final_amount?: number; performance_rating?: string; approved_by?: number; remark?: string }): Promise<Envelope<PeriodicBonus>> {
    return apiClient.post("/hr/performance/periodic-bonus", payload);
  },

  // ── Training Plan Details ──────────────────────────────────────────────────
  async getTrainingPlanDetails(params?: { plan_id?: number; date_from?: string; date_to?: string; status?: string }): Promise<{ data: any[] }> {
    return apiClient.get("/hr/training/plan-details", params);
  },
  async createTrainingPlanDetail(payload: any): Promise<{ data: any }> {
    return apiClient.post("/hr/training/plan-details", payload);
  },
  async updateTrainingPlanDetail(id: number, payload: any): Promise<{ data: any }> {
    return apiClient.put("/hr/training/plan-details/" + id, payload);
  },
  async deleteTrainingPlanDetail(id: number): Promise<{ success: boolean }> {
    return apiClient.delete("/hr/training/plan-details/" + id);
  },

  // ── Certification Types ────────────────────────────────────────────────────
  async getCertTypes(params?: { is_active?: number; station_code?: string }): Promise<{ data: any[] }> {
    return apiClient.get("/hr/cert/types", params);
  },
  async createCertType(payload: any): Promise<{ data: any }> {
    return apiClient.post("/hr/cert/types", payload);
  },
  async updateCertType(id: number, payload: any): Promise<{ data: any }> {
    return apiClient.put("/hr/cert/types/" + id, payload);
  },

  // ── Employee Certifications ────────────────────────────────────────────────
  async getEmployeeCertifications(params?: { employee_id?: number; cert_type_id?: number; status?: string }): Promise<{ data: any[] }> {
    return apiClient.get("/hr/cert/employee", params);
  },
  async createEmployeeCertification(payload: any): Promise<{ data: any }> {
    return apiClient.post("/hr/cert/employee", payload);
  },
  async updateEmployeeCertification(id: number, payload: any): Promise<{ data: any }> {
    return apiClient.put("/hr/cert/employee/" + id, payload);
  },

  // ── Certification Exams ────────────────────────────────────────────────────
  async getExams(params?: { cert_type_id?: number; status?: string; date_from?: string; date_to?: string }): Promise<{ data: any[] }> {
    return apiClient.get("/hr/exam", params);
  },
  async createExam(payload: any): Promise<{ data: any }> {
    return apiClient.post("/hr/exam", payload);
  },
  async updateExam(id: number, payload: any): Promise<{ data: any }> {
    return apiClient.put("/hr/exam/" + id, payload);
  },

  // ── Exam Enrollments ───────────────────────────────────────────────────────
  async getExamEnrollments(params?: { exam_id?: number; employee_id?: number; exam_status?: string }): Promise<{ data: any[] }> {
    return apiClient.get("/hr/exam/enrollments", params);
  },
  async createExamEnrollment(payload: { exam_id: number; employee_id: number }): Promise<{ data: any }> {
    return apiClient.post("/hr/exam/enrollments", payload);
  },
  async gradeExamEnrollment(id: number, payload: { score_obtained: number; is_passed: boolean; result_remarks?: string }): Promise<{ data: any }> {
    return apiClient.patch("/hr/exam/enrollments/" + id + "/grade", payload);
  },

  // ── Question Bank ──────────────────────────────────────────────────────────
  async getExamQuestions(params?: { cert_type_id?: number; is_active?: number; difficulty?: string }): Promise<{ data: any[] }> {
    return apiClient.get("/hr/exam/questions", params);
  },
  async createExamQuestion(payload: any): Promise<{ data: any }> {
    return apiClient.post("/hr/exam/questions", payload);
  },

  // ── Certification Approval ─────────────────────────────────────────────────
  async getCertApprovals(params?: { employee_id?: number; cert_type_id?: number; current_status?: string; date_from?: string; date_to?: string }): Promise<{ data: any[] }> {
    return apiClient.get("/hr/cert/approval", params);
  },
  async createCertApproval(payload: { employee_id: number; cert_type_id: number; cert_type_name: string; request_type: string; request_reason?: string; training_record_id?: number; exam_enrollment_id?: number; exam_score?: number }): Promise<{ data: any }> {
    return apiClient.post("/hr/cert/approval", payload);
  },
  async approveCertStep(id: number, payload: { step_no: number; decision: string; remarks?: string }): Promise<{ data: any }> {
    return apiClient.patch("/hr/cert/approval/" + id + "/step", payload);
  },
  async getCertApprovalSteps(id: number): Promise<{ data: any[] }> {
    return apiClient.get("/hr/cert/approval/" + id + "/steps");
  },

  // ── Training Real-time Attendance ─────────────────────────────────────────
  async getTrainingAttendance(params?: { session_id?: number; attendance_status?: string }): Promise<{ data: any[] }> {
    return apiClient.get("/hr/training/attendance", params);
  },
  async signInTraining(session_id: number, employee_id: number): Promise<{ data: any }> {
    return apiClient.post("/hr/training/attendance/sign-in", { session_id, employee_id });
  },
  async signOutTraining(session_id: number, employee_id: number): Promise<{ data: any }> {
    return apiClient.post("/hr/training/attendance/sign-out", { session_id, employee_id });
  },

  // ── Training Tracking ──────────────────────────────────────────────────────
  async getTrainingTracking(params?: { employee_id?: number; tracking_type?: string; date_from?: string; date_to?: string }): Promise<{ data: any[] }> {
    return apiClient.get("/hr/training/tracking", params);
  },
  async createTrainingTracking(payload: any): Promise<{ data: any }> {
    return apiClient.post("/hr/training/tracking", payload);
  },
  async updatePeriodicBonusStatus(id: number, status: string): Promise<Envelope<PeriodicBonus>> {
    return apiClient.patch("/hr/bonus/periodic/" + id + "/status", { status });
  },

  // ── Shift Swap ──────────────────────────────────────────────────────────
  async getSwapRequests(params?: { status?: string; requester_id?: number; date_from?: string; date_to?: string }): Promise<{ items: SwapRequest[] }> {
    return apiClient.get("/hr/swap/requests", params);
  },
  async getSwapRecords(params?: { employee_id?: number; date_from?: string; date_to?: string }): Promise<{ items: SwapRecord[] }> {
    return apiClient.get("/hr/swap/records", params);
  },
  async createSwapRequest(payload: { requester_id: number; swap_partner_id?: number; original_shift_date: string; original_shift_type?: string; target_shift_date: string; target_shift_type?: string; reason_zh?: string }): Promise<{ item: SwapRequest }> {
    return apiClient.post("/hr/swap/requests", payload);
  },
  async approveSwapRequest(id: number, payload?: { approver_id?: number; approver_name_zh?: string }): Promise<{ item: SwapRequest }> {
    return apiClient.patch("/hr/swap/requests/" + id + "/approve", payload || {});
  },
  async rejectSwapRequest(id: number, remark?: string): Promise<{ item: SwapRequest }> {
    return apiClient.patch("/hr/swap/requests/" + id + "/reject", { remark });
  },
  async markSwapPerformed(id: number, payload?: { actual_performer_id?: number; actual_performer_name?: string }): Promise<{ item: SwapRecord }> {
    return apiClient.patch("/hr/swap/records/" + id + "/performed", payload || {});
  },

  // ── OT Pay ──────────────────────────────────────────────────────────────
  async getOtRules(): Promise<{ items: OtPayRule[] }> {
    return apiClient.get("/hr/ot/rules");
  },
  async getOtRecords(params?: { employee_id?: number; ot_date_from?: string; ot_date_to?: string; applied_month?: string; status?: string }): Promise<{ items: OtRecord[] }> {
    return apiClient.get("/hr/ot/records", params);
  },
  async createOtRecord(payload: { employee_id: number; ot_date: string; ot_hours: number; ot_type: string; hourly_base: number; remark?: string }): Promise<{ item: OtRecord }> {
    return apiClient.post("/hr/ot/records", payload);
  },
  async batchCreateOtRecords(records: { employee_id: number; ot_date: string; ot_hours: number; ot_type?: string; hourly_base: number }[]): Promise<{ items: OtRecord[] }> {
    return apiClient.post("/hr/ot/records/batch", { records });
  },

  // ── Skill Rating ────────────────────────────────────────────────────────
  async getSkillCategories(): Promise<{ items: SkillCategory[] }> {
    return apiClient.get("/hr/skill/categories");
  },
  async getSkillLevels(categoryId?: number): Promise<{ items: SkillLevel[] }> {
    return apiClient.get("/hr/skill/levels", categoryId ? { category_id: categoryId } : undefined);
  },
  async getSkillItems(categoryId?: number): Promise<{ items: SkillItem[] }> {
    return apiClient.get("/hr/skill/items", categoryId ? { category_id: categoryId } : undefined);
  },
  async getSkillRatings(params?: { employee_id?: number; category_id?: number; year?: number; month?: number }): Promise<{ items: EmployeeSkillRating[] }> {
    return apiClient.get("/hr/skill/ratings", params);
  },
  async getSkillRatingDetails(ratingId: number): Promise<{ items: SkillRatingDetail[] }> {
    return apiClient.get("/hr/skill/ratings/" + ratingId + "/details");
  },
  async createSkillRating(payload: { employee_id: number; category_id: number; period_year: number; period_month: number; details: { skill_item_id: number; item_name_zh?: string; max_score?: number; actual_score: number; weight?: number; data_source?: string; data_value?: number }[]; rated_by?: number; rater_name?: string }): Promise<{ item: EmployeeSkillRating }> {
    return apiClient.post("/hr/skill/ratings", payload);
  },

  // ── Teamwork Light ──────────────────────────────────────────────────────
  async getTeamworkMetrics(): Promise<{ items: TeamworkMetric[] }> {
    return apiClient.get("/hr/teamwork/metrics");
  },
  async getTeamworkRatings(params?: { employee_id?: number; year?: number; month?: number }): Promise<{ items: EmployeeTeamworkRating[] }> {
    return apiClient.get("/hr/teamwork/ratings", params);
  },
  async createTeamworkRating(payload: { employee_id: number; period_year: number; period_month: number; details: { metric_id: number; metric_name_zh?: string; target_value?: number; actual_value: number; metric_score: number }[]; rater_id?: number; rater_name?: string }): Promise<{ item: EmployeeTeamworkRating }> {
    return apiClient.post("/hr/teamwork/ratings", payload);
  },

  // ── Reward Programs & Peer Recognition ─────────────────────────────────
  async getRewardPrograms(params?: { status?: string }): Promise<{ items: RewardProgram[] }> {
    return apiClient.get("/hr/rewards/programs", params);
  },
  async getRewardNominations(params?: { program_id?: number; nominee_id?: number; status?: string }): Promise<{ items: RewardNomination[] }> {
    return apiClient.get("/hr/rewards/nominations", params);
  },
  async createRewardNomination(payload: { program_id?: number; nominator_id: number; nominator_name?: string; nominee_id: number; category_id: number; cat_name_zh?: string; nomination_date?: string; reason_zh: string }): Promise<{ item: RewardNomination }> {
    return apiClient.post("/hr/rewards/nominations", payload);
  },
  async approveRewardNomination(id: number, payload: { approver_id?: number; approver_name?: string; final_amount?: number; final_reason?: string }): Promise<{ item: RewardNomination }> {
    return apiClient.patch("/hr/rewards/nominations/" + id + "/approve", payload);
  },
  async getPeerRecognitions(params?: { recognized_id?: number }): Promise<{ items: PeerRecognition[] }> {
    return apiClient.get("/hr/rewards/peer", params);
  },
  async createPeerRecognition(payload: { recognizing_id: number; recognizing_name?: string; recognized_id: number; recognized_name?: string; recognized_dept?: string; recognition_type?: string; message?: string }): Promise<{ item: PeerRecognition }> {
    return apiClient.post("/hr/rewards/peer", payload);
  },
  async likePeerRecognition(id: number): Promise<{ item: PeerRecognition }> {
    return apiClient.post("/hr/rewards/peer/" + id + "/like", {});
  },
};



// ── Training ──────────────────────────────────────────────────────────────────
export type CertType = Record<string, unknown>;
export type EmployeeCertification = Record<string, unknown>;
export type CertificationExam = Record<string, unknown>;
export type ExamEnrollment = Record<string, unknown>;
export type ExamQuestion = Record<string, unknown>;
export type CertApproval = Record<string, unknown>;
export type ApprovalStep = Record<string, unknown>;
export type TrainingPlanDetail = Record<string, unknown>;
export type TrainingAttendance = Record<string, unknown>;
export type TrainingTracking = Record<string, unknown>;

export interface TrainingCourse {
  id: number; code: string; name_zh: string; name_en: string; name_vi: string;
  category: string; trainer_name: string | null; duration_hours: number;
  method: string; description: string | null; status: string;
  created_at: string;
}
export interface TrainingPlan {
  id: number; plan_no: string; name_zh: string; name_en: string; name_vi: string;
  plan_year: number; plan_month: number | null; department_id: number | null;
  department_name_zh: string | null; course_id: number; course_name_zh: string;
  course_category: string; target_count: number; trainer_id: number | null;
  planned_hours: number; actual_hours: number; status: string; created_by: number | null;
  created_at: string;
}
export interface TrainingSession {
  id: number; session_no: string; plan_id: number; course_id: number;
  course_name_zh: string; plan_name_zh: string; scheduled_date: string;
  start_time: string | null; end_time: string | null; location: string | null;
  method: string; trainer_id: number | null; trainer_name: string | null;
  max_attendees: number; actual_attendees: number; status: string;
  completion_date: string | null; created_at: string;
}
export interface TrainingRecord {
  id: number; employee_id: number; employee_name_zh: string; employee_no: string;
  session_id: number | null; course_id: number; course_name_zh: string;
  plan_id: number | null; enrolled_at: string; attended_at: string | null;
  assessment_score: number | null; rating: string | null; certificate_no: string | null;
  certificate_issued_at: string | null; status: string; remarks: string | null;
}

// ── Onboarding / Offboarding ───────────────────────────────────────────────────
export interface OnboardingTemplate {
  id: number; code: string; name_zh: string; name_en: string; name_vi: string;
  department_id: number | null; position_id: number | null;
  dept_name_zh: string | null; pos_name_zh: string | null; probation_months: number; status: string;
}
export interface OnboardingEmployee {
  id: number; employee_id: number; employee_name_zh: string; employee_no: string;
  department_id: number; dept_name_zh: string; template_id: number | null;
  template_name_zh: string | null; join_date: string; mentor_id: number | null;
  mentor_name_zh: string | null; probation_end_date: string | null;
  overall_status: string; completed_at: string | null; created_at: string;
}
export interface OnboardingTaskInstance {
  id: number; onboarding_id: number; template_task_id: number | null;
  task_name_zh: string; task_category: string; assignee_id: number | null;
  assignee_name: string | null; assignee_role: string; due_date: string;
  completed_at: string | null; status: string; remarks: string | null;
}
export interface OffboardingEmployee {
  id: number; employee_id: number; employee_name_zh: string; employee_no: string;
  department_id: number; dept_name_zh: string; template_id: number | null;
  template_name_zh: string | null; termination_type: string;
  last_work_date: string; exit_interview_date: string | null;
  exit_interview_by: number | null; interviewer_name: string | null;
  exit_interview_notes: string | null; final_settlement_date: string | null;
  overall_status: string; completed_at: string | null; created_at: string;
}
export interface OffboardingTaskInstance {
  id: number; offboarding_id: number; template_task_id: number | null;
  task_name_zh: string; task_category: string; assignee_id: number | null;
  assignee_name: string | null; assignee_role: string; due_date: string;
  completed_at: string | null; status: string; remarks: string | null;
}

// ── Attendance ────────────────────────────────────────────────────────────────
export interface AttendanceMonthlyStat {
  id: number; employee_id: number; emp_name: string; employee_no: string;
  dept_name: string; year: number; month: number; normal_days: number;
  absent_days: number; late_count: number; late_minutes: number;
  early_count: number; early_minutes: number; ot_hours: number;
  leave_days: number; holiday_days: number; work_days: number;
  attendance_rate: number; punctuality_rate: number; computed_at: string;
}
export interface AttendanceClockDetail {
  id: number; employee_id: number; emp_name: string; employee_no: string;
  work_date: string; clock_in: string | null; clock_out: string | null;
  clock_in_method: string; clock_out_method: string; device_id: string | null; remark: string | null;
}
export interface AttendanceRule {
  id: number; rule_code: string; name_zh: string; name_en: string; name_vi: string;
  rule_type: string; threshold_value: number | null; threshold_unit: string | null;
  amount: number; amount_type: string; currency: string; is_active: boolean;
  effective_from: string; effective_to: string | null;
}

// ── Performance KPI ───────────────────────────────────────────────────────────
export interface PerfKpiTemplate {
  id: number; code: string; name_zh: string; name_en: string; name_vi: string;
  category: string; department_id: number | null; position_id: number | null;
  dept_name: string | null; pos_name: string | null;
  period_type: string; weight_total: number; pass_score: number; status: string;
}
export interface PerfKpiTemplateItem {
  id: number; template_id: number; kpi_name_zh: string; kpi_name_en: string; kpi_name_vi: string;
  category: string; target_type: string; target_value: number; target_max: number | null;
  weight: number; data_source: string | null; sort_order: number;
}
export interface EmpKpiResult {
  id: number; employee_id: number; emp_name: string; employee_no: string; dept_name: string;
  template_id: number | null; period_year: number; period_month: number | null;
  period_quarter: number | null; item_id: number | null; item_name_zh: string;
  item_category: string; target_value: number; actual_value: number;
  score: number; weight: number; auto_computed: boolean; computed_at: string | null;
}
export interface PerfScoreSummary {
  id: number; employee_id: number; emp_name: string; employee_no: string; dept_name: string;
  period_year: number; period_month: number | null; period_quarter: number | null;
  total_score: number; rating: string; rank_in_dept: number | null;
  review_status: string; self_score_at: string | null; manager_score_at: string | null;
  published_at: string | null;
}

// ── Rewards ───────────────────────────────────────────────────────────────────
export interface RewardCategory {
  id: number; code: string; name_zh: string; name_en: string; name_vi: string;
  category_type: string; amount_min: number | null; amount_max: number | null;
  currency: string; approver_role: string; is_active: boolean;
}
export interface EmployeeReward {
  id: number; employee_id: number; emp_name: string; employee_no: string; dept_name: string;
  category_id: number; cat_name_zh: string; category_type: string;
  reward_date: string; amount: number; currency: string;
  reason_zh: string; reason_en: string | null; reason_vi: string | null;
  award_level: string | null; issued_by: number | null; issuer_name: string | null;
  approver_id: number | null; status: string; payment_status: string;
  paid_at: string | null; period_year: number | null; period_month: number | null; remark: string | null;
}
export interface PeriodicBonus {
  id: number; employee_id: number; emp_name: string; employee_no: string; dept_name: string;
  bonus_type: string; period_year: number; period_quarter: number | null;
  base_amount: number; coefficient: number; final_amount: number; currency: string;
  performance_rating: string | null; status: string; approved_by: number | null;
  approver_name: string | null; paid_at: string | null; remark: string | null;
}

// ── Shift Swap ──────────────────────────────────────────────────────────────────
export interface SwapRequest {
  id: number; request_no: string; requester_id: number; requester_name_zh: string;
  requester_emp_no: string; requester_dept_id: number | null; swap_partner_id: number | null;
  swap_partner_name_zh: string | null; original_shift_date: string; original_shift_type: string;
  original_shift_start: string | null; original_shift_end: string | null; target_shift_date: string;
  target_shift_type: string; target_shift_start: string | null; target_shift_end: string | null;
  reason_zh: string | null; status: string; approver_id: number | null; approver_name_zh: string | null;
  approved_at: string | null; remark: string | null; created_at: string;
}
export interface SwapRecord {
  id: number; swap_request_id: number; original_worker_id: number; original_worker_name: string;
  original_shift_date: string; original_shift_type: string; swap_worker_id: number; swap_worker_name: string;
  swap_shift_date: string; swap_shift_type: string; actual_performer_id: number | null;
  actual_performer_name: string | null; actual_performed_at: string | null; swap_status: string; created_at: string;
}

// ── OT Pay ─────────────────────────────────────────────────────────────────────
export interface OtPayRule {
  id: number; rule_code: string; name_zh: string; name_en: string | null; name_vi: string | null;
  ot_type: string; multiplier: number; currency: string; min_hours: number; max_hours: number | null;
  night_allowance: number; is_active: boolean; effective_from: string; effective_to: string | null;
}
export interface OtRecord {
  id: number; employee_id: number; emp_name: string | null; emp_no: string | null; dept_name: string | null;
  ot_date: string; ot_hours: number; ot_type: string; pay_rule_id: number | null; hourly_base: number;
  multiplier: number; ot_pay_amount: number; night_allowance: number; total_pay: number; currency: string;
  applied_month: string | null; approved_by: number | null; approver_name: string | null; approved_at: string | null;
  status: string; remark: string | null; created_at: string;
}

// ── Skill Rating ───────────────────────────────────────────────────────────────
export interface SkillCategory {
  id: number; code: string; name_zh: string; name_en: string | null; name_vi: string | null;
  description: string | null; item_count?: number; is_active: boolean;
}
export interface SkillLevel {
  id: number; category_id: number; level_code: string; level_name_zh: string; level_name_en: string | null;
  level_name_vi: string | null; score_min: number; score_max: number; salary_ratio: number;
  description: string | null; sort_order: number; category_name_zh?: string;
}
export interface SkillItem {
  id: number; category_id: number; station_code: string | null; station_name_zh: string | null;
  item_code: string; item_name_zh: string; item_name_en: string | null; item_name_vi: string | null;
  max_score: number; weight: number; data_source: string | null; sort_order: number; is_active: boolean;
  category_name_zh?: string;
}
export interface EmployeeSkillRating {
  id: number; employee_id: number; emp_name: string | null; emp_no: string | null; dept_name: string | null;
  category_id: number; category_name_zh: string | null; period_year: number; period_month: number;
  total_score: number; skill_level_id: number | null; skill_level_name: string | null;
  rated_by: number | null; rater_name: string | null; rated_at: string | null; status: string; created_at: string;
}
export interface SkillRatingDetail {
  id: number; skill_rating_id: number; skill_item_id: number; item_name_zh: string | null;
  max_score: number; actual_score: number; weight: number; weighted_score: number;
  data_source: string | null; data_value: number | null; remark: string | null;
}

// ── Teamwork Light ─────────────────────────────────────────────────────────────
export interface TeamworkMetric {
  id: number; metric_code: string; name_zh: string; name_en: string | null; name_vi: string | null;
  description: string | null; data_source: string; target_value: number | null; target_max: number | null;
  is_active: boolean; sort_order: number;
}
export interface EmployeeTeamworkRating {
  id: number; employee_id: number; emp_name: string | null; emp_no: string | null; dept_name: string | null;
  period_year: number; period_month: number; overall_score: number; light_status: string;
  light_reason: string | null; rater_id: number | null; rater_name: string | null; rated_at: string | null;
  created_at: string; updated_at: string;
}

// ── Reward Programs & Peer ────────────────────────────────────────────────────
export interface RewardProgram {
  id: number; program_code: string; name_zh: string; name_en: string | null; name_vi: string | null;
  program_type: string; start_date: string; end_date: string | null; target_dept_ids: string | null;
  budget_total: number | null; budget_used: number; currency: string; status: string;
  created_by: number | null; created_at: string; updated_at: string;
}
export interface RewardNomination {
  id: number; program_id: number | null; nominator_id: number; nominator_name: string | null;
  nominee_id: number; nominee_name: string | null; nominee_dept: string | null;
  category_id: number; cat_name_zh: string | null; nomination_date: string;
  reason_zh: string | null; reason_en: string | null; reason_vi: string | null;
  evidence_urls: string | null; status: string; approver_id: number | null; approver_name: string | null;
  decided_at: string | null; final_amount: number | null; final_reason: string | null; created_at: string;
}
export interface PeerRecognition {
  id: number; recognizing_id: number; recognizing_name: string | null;
  recognized_id: number; recognized_name: string | null; recognized_dept: string | null;
  recognition_type: string; message: string | null; likes_count: number; created_at: string;
}
export interface QrStatus {
  employeeId: number;
  employeeCode: string;
  employeeNameZh: string;
  hasActiveQr: boolean;
  qrContent: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
}

export interface QrGenerated {
  employeeId: number;
  employeeCode: string;
  employeeNameZh: string;
  qrContent: string;
  expiresAt: string;
  validDays: number;
  hasActiveQr: true;
}
export interface TrainingVideo {
  id: number;
  videoCode: string;
  titleZh: string;
  titleEn: string | null;
  titleVi: string | null;
  businessDomain: string;
  topicCode: string;
  stationCode: string | null;
  languageCode: string;
  versionNo: number;
  fileUrl: string;
  thumbnailUrl: string | null;
  mimeType: string;
  durationSeconds: number | null;
  tags: string[];
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  routeKeys: string[];
  createdAt: string;
  approvedAt: string | null;
}

export interface TrainingVideoQuery {
  domain?: string;
  topic?: string;
  stationCode?: string;
  language?: string;
  routeKey?: string;
  status?: string;
  q?: string;
}

export interface CreateTrainingVideoPayload {
  videoCode: string;
  titleZh: string;
  titleEn?: string;
  titleVi?: string;
  businessDomain: string;
  topicCode: string;
  stationCode?: string;
  languageCode?: string;
  versionNo?: number;
  fileUrl: string;
  thumbnailUrl?: string;
  mimeType?: string;
  durationSeconds?: number;
  tags?: string[];
  status?: "DRAFT" | "PUBLISHED";
  routeKeys?: string[];
}
