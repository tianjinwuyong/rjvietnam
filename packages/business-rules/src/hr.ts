// HR Business Rules
// Employee number generation, attendance calculations, leave balance validation

import type { Employee, AttendanceRecord, LeaveRequest, LeaveBalance, Shift } from "../../shared-types/src/factory";

// ── Employee Number Generation ───────────────────────────────────

const employeeCounter = new Map<string, number>();

/**
 * Generate employee number.
 * Format: EMP + YYYY + 4-digit serial (e.g., EMP20260001)
 * Resets annually.
 */
export function generateEmployeeNo(year?: number): string {
  const yy = String(year ?? new Date().getFullYear()).slice(-4);
  const key = `emp_${yy}`;
  const next = (employeeCounter.get(key) ?? 0) + 1;
  employeeCounter.set(key, next);
  return `EMP${yy}${String(next).padStart(4, "0")}`;
}

/**
 * Validate employee number format.
 */
export function isValidEmployeeNo(employeeNo: string): boolean {
  return /^EMP\d{8}$/.test(employeeNo);
}

// ── Attendance Calculations ──────────────────────────────────────

export type AttendanceInput = {
  clockIn?: string;
  clockOut?: string;
  shiftStart: string; // HH:mm
  shiftEnd: string;
  breakMinutes: number;
};

/**
 * Calculate attendance status and hours.
 */
export function calculateAttendance(input: AttendanceInput): {
  status: AttendanceRecord["status"];
  lateMinutes: number;
  earlyMinutes: number;
  actualWorkHours: number;
} {
  const { clockIn, clockOut, shiftStart, shiftEnd, breakMinutes } = input;

  // If no clock in, mark as absent
  if (!clockIn) {
    return { status: "absent", lateMinutes: 0, earlyMinutes: 0, actualWorkHours: 0 };
  }

  const shiftStartMinutes = timeToMinutes(shiftStart);
  const shiftEndMinutes = timeToMinutes(shiftEnd);
  const clockInMinutes = timeToMinutes(clockIn.slice(11, 16)); // Extract HH:mm from ISO
  const lateMinutes = Math.max(0, clockInMinutes - shiftStartMinutes);

  let earlyMinutes = 0;
  let actualWorkHours = 0;

  if (clockOut) {
    const clockOutMinutes = timeToMinutes(clockOut.slice(11, 16));
    earlyMinutes = Math.max(0, shiftEndMinutes - clockOutMinutes);
    const totalMinutes = clockOutMinutes - clockInMinutes - breakMinutes;
    actualWorkHours = Math.max(0, totalMinutes / 60);
  }

  let status: AttendanceRecord["status"] = "normal";
  if (lateMinutes > 0) status = "late";
  else if (earlyMinutes > 0) status = "early";

  return { status, lateMinutes, earlyMinutes, actualWorkHours };
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

// ── Leave Balance Validation ─────────────────────────────────────

export type LeaveValidationResult = {
  valid: boolean;
  error?: string;
};

/**
 * Validate leave request against available balance.
 */
export function validateLeaveRequest(
  request: LeaveRequest,
  balance: LeaveBalance
): LeaveValidationResult {
  // Check if sufficient balance
  if ((request.totalDays ?? 0) > (balance.availableDays ?? 0)) {
    return {
      valid: false,
      error: `Insufficient leave balance. Available: ${balance.availableDays ?? 0} days, Requested: ${request.totalDays ?? 0} days`,
    };
  }

  // Check if pending + used exceeds total
  const projectedUsed = (balance.usedDays ?? 0) + (balance.pendingDays ?? 0) + (request.totalDays ?? 0);
  if (projectedUsed > (balance.totalDays ?? 0)) {
    return {
      valid: false,
      error: `Leave would exceed annual allowance. Total: ${balance.totalDays ?? 0} days, Projected: ${projectedUsed} days`,
    };
  }

  // Check date validity
  if (request.startDate && request.endDate && new Date(request.startDate) > new Date(request.endDate)) {
    return {
      valid: false,
      error: "Start date must be before or equal to end date",
    };
  }

  return { valid: true };
}

/**
 * Calculate leave balance after approval/usage.
 */
export function calculateLeaveBalance(
  currentBalance: LeaveBalance,
  daysUsed: number,
  pendingDays: number = 0
): LeaveBalance {
  return {
    ...currentBalance,
    usedDays: (currentBalance.usedDays ?? 0) + daysUsed,
    pendingDays: (currentBalance.pendingDays ?? 0) + pendingDays,
    availableDays: (currentBalance.totalDays ?? 0) - (currentBalance.usedDays ?? 0) - daysUsed - pendingDays,
  };
}

// ── Annual Leave Calculation (Vietnam Labor Law) ──────────────────

/**
 * Calculate annual leave entitlement based on employment duration.
 * Per Vietnamese Labor Code:
 * - < 1 year: 12 days
 * - 1-5 years: 14 days
 * - 5-10 years: 16 days
 * - 10-20 years: 20 days
 * - 20+ years: 24 days
 */
export function calculateAnnualLeaveEntitlement(joinDate: Date): number {
  const now = new Date();
  const yearsOfService = Math.floor(
    (now.getTime() - joinDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000)
  );

  if (yearsOfService < 1) return 12;
  if (yearsOfService < 5) return 14;
  if (yearsOfService < 10) return 16;
  if (yearsOfService < 20) return 20;
  return 24;
}

/**
 * Prorate annual leave for mid-year joining.
 */
export function prorateAnnualLeave(joinDate: Date, totalEntitlement: number): number {
  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const monthsRemaining = 12 - joinDate.getMonth();

  return Math.round((totalEntitlement * monthsRemaining) / 12 * 10) / 10;
}

// ── Overtime Calculation ─────────────────────────────────────────

/**
 * Calculate overtime hours.
 * In Vietnam:
 * - Normal OT: beyond scheduled hours on weekdays
 * - Weekend OT: Saturday/Sunday
 * - Holiday OT: public holidays (1.5x or 2x depending on OT hour position)
 */
export function calculateOvertimeHours(
  workDate: Date,
  regularHours: number,
  actualHours: number
): { otHours: number; otRate: number } {
  const dayOfWeek = workDate.getDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  const isHoliday = false; // Would check against holidays table

  if (actualHours <= regularHours) {
    return { otHours: 0, otRate: 1 };
  }

  const otHours = actualHours - regularHours;
  let otRate = 1.5; // Default weekday OT

  if (isWeekend) otRate = 2.0;
  if (isHoliday) otRate = 3.0;

  return { otHours, otRate };
}

// ── Department Head Count ─────────────────────────────────────────

/**
 * Calculate department head count from employee list.
 */
export function calculateDepartmentHeadcount(
  employees: Employee[],
  departmentId: string
): number {
  return employees.filter(
    (e) => e.departmentId === departmentId && e.status === "active"
  ).length;
}
