import type { FactoryModule } from "../_shared/module";

/**
 * HR — Employee records, shift scheduling, attendance clock-in/out,
 * daily and monthly attendance views, leave balances, departments.
 */
export const hrModule: FactoryModule = {
  key: "hr",
  name: "Human Resources",
  owns: [
    "employees",
    "departments",
    "shifts",
    "shift schedules",
    "attendance records",
    "leave balances",
  ],
  routes: [
    // Departments
    { method: "GET",    path: "/hr/departments",       summary: "List departments with manager", requiredPermissions: ["hr.department.manage"] },
    // Employees
    { method: "GET",    path: "/hr/employees",          summary: "List employees with department/position", requiredPermissions: ["hr.employee.view"] },
    { method: "GET",    path: "/hr/employees/:id",     summary: "Get a single employee", requiredPermissions: ["hr.employee.view"] },
    // Shifts
    { method: "GET",    path: "/hr/shifts",             summary: "List active shifts", requiredPermissions: ["hr.attendance.view"] },
    // Shift Schedules
    { method: "GET",    path: "/hr/shift-schedules",    summary: "Get shift schedules by date / employee / department", requiredPermissions: ["hr.attendance.view"] },
    { method: "POST",   path: "/hr/shift-schedules",    summary: "Assign an employee to a shift on a date", requiredPermissions: ["hr.attendance.edit"] },
    { method: "PATCH", path: "/hr/shift-schedules/:id",summary: "Swap a shift assignment", requiredPermissions: ["hr.attendance.edit"] },
    { method: "DELETE", path: "/hr/shift-schedules/:id",summary: "Delete a shift assignment", requiredPermissions: ["hr.attendance.edit"] },
    // Attendance
    { method: "POST",   path: "/hr/attendance/clock-in",  summary: "Employee clock-in", requiredPermissions: ["hr.attendance.edit"] },
    { method: "POST",   path: "/hr/attendance/clock-out",  summary: "Employee clock-out", requiredPermissions: ["hr.attendance.edit"] },
    { method: "GET",    path: "/hr/attendance/daily",      summary: "Daily attendance list", requiredPermissions: ["hr.attendance.view"] },
    { method: "POST",  path: "/hr/attendance/sync",        summary: "Batch sync punch records from attendance machine to attendance_records", requiredPermissions: ["hr.attendance.edit"] },
    { method: "GET",    path: "/hr/attendance/monthly/:employeeId", summary: "Monthly attendance for one employee", requiredPermissions: ["hr.attendance.view"] },
    { method: "GET",    path: "/hr/attendance/shift-summary", summary: "Daily attendance summary grouped by shift", requiredPermissions: ["hr.attendance.view"] },
    // Leave
    { method: "GET",    path: "/hr/leave-balances/:employeeId", summary: "Leave balances for current year", requiredPermissions: ["hr.leave.view"] },
  ],
};
