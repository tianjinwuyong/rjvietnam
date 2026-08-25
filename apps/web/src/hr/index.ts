export type HrTabKey = "dashboard" | "governance" | "payroll" | "employees" | "profileUpdates" | "orgChart" | "attendance" | "leave" | "performance" | "promotionAppraisals" | "salary" | "training" | "lifecycle" | "attStats" | "swap" | "otPay" | "skillRating" | "teamwork" | "rewardPrograms" | "grievances" | "pdaDomains";

export const hrTabKeys: HrTabKey[] = ["dashboard", "governance", "payroll", "employees", "profileUpdates", "orgChart", "attendance", "leave", "performance", "promotionAppraisals", "salary", "training", "lifecycle", "attStats", "swap", "otPay", "skillRating", "teamwork", "rewardPrograms", "grievances", "pdaDomains"];

export const hrTabTranslationKeys: Record<HrTabKey, string> = {
  dashboard: "hr.subnav.dashboard",
  governance: "hr.subnav.governance",
  payroll: "hr.subnav.payroll",
  employees: "hr.subnav.employees",
  profileUpdates: "hr.subnav.profileUpdates",
  orgChart: "nav.orgChart",
  attendance: "hr.subnav.attendance",
  leave: "hr.subnav.leave",
  performance: "hr.subnav.performance",
  promotionAppraisals: "Promotion Appraisals",
  salary: "hr.subnav.salary",
  training: "hr.subnav.training",
  lifecycle: "hr.subnav.lifecycle",
  attStats: "hr.subnav.attStats",
  swap: "hr.subnav.swap",
  otPay: "hr.subnav.otPay",
  skillRating: "hr.subnav.skillRating",
  teamwork: "hr.subnav.teamwork",
  rewardPrograms: "hr.subnav.rewardPrograms",
  grievances: "hr.subnav.grievances",
  pdaDomains: "hr.subnav.pdaDomains",
};

export { HrDashboard } from "./HrDashboard";
export { HrEmployeeList } from "./HrEmployeeList";
export { HrProfileUpdates } from "./HrProfileUpdates";
export { HrOrgChart } from "./HrOrgChart";
export { HrAttendance } from "./HrAttendance";
export { HrLeave } from "./HrLeave";
export { HrPerformance } from "./HrPerformance";
export { HrPromotionAppraisals } from "./HrPromotionAppraisals";
export { HrSalary } from "./HrSalary";
export { HrTraining } from "./HrTraining";
export { HrLifecycle } from "./HrLifecycle";
export { HrAttendanceStats } from "./HrAttendanceStats";
export { HrSwap } from "./HrSwap";
export { HrOtPay } from "./HrOtPay";
export { HrSkillRating } from "./HrSkillRating";
export { HrTeamwork } from "./HrTeamwork";
export { HrRewardPrograms } from "./HrRewardPrograms";
export { HrGovernance } from "./HrGovernance";
export { HrGrievanceCases } from "./HrGrievanceCases";
export { HrPayroll } from "./HrPayroll";
export { HrPdaDomains } from "./HrPdaDomains";
