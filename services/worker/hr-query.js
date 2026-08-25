/**
 * hr-query.js
 * Direct PostgreSQL queries for HR module.
 * Follows watchdog-query.js pattern exactly.
 *
 * Usage: node hr-query.js [query-name]
 *   query-name: employees | attendance | leave | ot | compliance | all
 */

import pg from "pg";
const { Pool } = pg;

const pool = new Pool({
  host: process.env.PGHOST ?? "127.0.0.1",
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? "postgres",
  password: process.env.PGPASSWORD ?? "postgres",
  database: process.env.PGDATABASE ?? "smt_factory",
  max: 3,
});

// ── Argument parsing ──────────────────────────────────────────────────────
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i].startsWith("--")) {
    args[process.argv[i].slice(2)] = process.argv[i + 1] ?? null;
    i++;
  }
}
const argv = process.argv[2] ?? "all";

async function query(sql, params = []) {
  const client = await pool.connect();
  try {
    const result = await client.query(sql, params);
    return result.rows;
  } finally {
    client.release();
  }
}

// ── Employees ─────────────────────────────────────────────────────────────
async function getEmployees() {
  const rows = await query(`
    SELECT
      e.id,
      e.employee_no,
      e.name_zh,
      e.name_en,
      e.name_vi,
      e.gender,
      e.phone,
      e.email,
      e.department_id,
      d.name_zh AS dept_name_zh,
      d.name_en AS dept_name_en,
      e.position_title,
      e.employment_type,
      e.status,
      e.join_date,
      e.probation_end_date,
      e.contract_end_date,
      e.base_salary,
      e.tax_code,
      e.social_insurance_no
    FROM hr_employees e
    LEFT JOIN hr_departments d ON d.id = e.department_id
    ORDER BY e.status, e.name_zh
    LIMIT 200
  `);
  return rows;
}

async function getProbationExpiring(days = 14) {
  const rows = await query(`
    SELECT
      id, employee_no, name_zh, name_en, name_vi,
      probation_end_date, department_id, position_title
    FROM hr_employees
    WHERE status = 'probation'
      AND probation_end_date IS NOT NULL
      AND probation_end_date <= CURRENT_DATE + ($1 || ' days')::interval
      AND probation_end_date >= CURRENT_DATE
    ORDER BY probation_end_date
  `, [days]);
  return rows;
}

async function getContractExpiring(days = 30) {
  // System table hr_employees, not the 004 employees table
  const rows = await query(`
    SELECT
      id, employee_no, name_zh, name_en, name_vi,
      contract_end_date, department_id, position_title
    FROM hr_employees
    WHERE status = 'active'
      AND contract_end_date IS NOT NULL
      AND contract_end_date <= CURRENT_DATE + ($1 || ' days')::interval
      AND contract_end_date >= CURRENT_DATE
    ORDER BY contract_end_date
  `, [days]);
  return rows;
}

async function getResignedRecent(days = 7) {
  const rows = await query(`
    SELECT
      id, employee_no, name_zh, name_en, name_vi,
      resign_date, resign_reason, department_id
    FROM hr_employees
    WHERE status = 'resigned'
      AND resign_date >= CURRENT_DATE - ($1 || ' days')::interval
    ORDER BY resign_date DESC
  `, [days]);
  return rows;
}

// ── Attendance ────────────────────────────────────────────────────────────
async function getTodayAttendance() {
  const today = new Date().toISOString().slice(0, 10);
  const rows = await query(`
    SELECT
      a.id,
      a.employee_id,
      e.employee_no,
      e.name_zh,
      e.name_vi,
      d.name_zh AS dept_name_zh,
      s.code AS shift_code,
      s.start_time,
      s.end_time,
      a.clock_in,
      a.clock_out,
      a.status,
      a.late_minutes,
      a.early_minutes,
      a.ot_hours
    FROM hr_attendance_records a
    JOIN hr_employees e ON e.id = a.employee_id
    LEFT JOIN hr_departments d ON d.id = e.department_id
    LEFT JOIN hr_shifts s ON s.id = a.shift_id
    WHERE a.work_date = CURRENT_DATE
    ORDER BY a.status, d.name_zh, e.name_zh
  `);
  return rows;
}

async function getMissedClockIn() {
  // Employees scheduled for today who haven't clocked in
  const rows = await query(`
    SELECT
      ss.id,
      ss.employee_id,
      e.employee_no,
      e.name_zh,
      e.name_vi,
      d.name_zh AS dept_name_zh,
      s.code AS shift_code,
      s.start_time,
      ss.schedule_date
    FROM hr_shift_schedules ss
    JOIN hr_employees e ON e.id = ss.employee_id
    LEFT JOIN hr_departments d ON d.id = e.department_id
    JOIN hr_shifts s ON s.id = ss.shift_id
    LEFT JOIN hr_attendance_records a ON a.employee_id = ss.employee_id AND a.work_date = ss.schedule_date
    WHERE ss.schedule_date = CURRENT_DATE
      AND ss.status = 'scheduled'
      AND a.id IS NULL
      AND s.start_time < CURRENT_TIME
    ORDER BY d.name_zh, e.name_zh
  `);
  return rows;
}

async function getWeeklyAttendanceStats() {
  const rows = await query(`
    SELECT
      a.employee_id,
      e.employee_no,
      e.name_zh,
      e.name_vi,
      d.name_zh AS dept_name_zh,
      COUNT(*) AS total_days,
      COUNT(CASE WHEN a.status = 'late' THEN 1 END) AS late_days,
      COUNT(CASE WHEN a.status = 'early' THEN 1 END) AS early_days,
      COUNT(CASE WHEN a.status = 'absent' THEN 1 END) AS absent_days,
      COUNT(CASE WHEN a.status = 'leave' THEN 1 END) AS leave_days,
      SUM(COALESCE(a.late_minutes, 0)) AS total_late_minutes,
      SUM(COALESCE(a.ot_hours, 0)) AS total_ot_hours
    FROM hr_attendance_records a
    JOIN hr_employees e ON e.id = a.employee_id
    LEFT JOIN hr_departments d ON d.id = e.department_id
    WHERE a.work_date >= CURRENT_DATE - INTERVAL '7 days'
      AND a.work_date <= CURRENT_DATE
    GROUP BY a.employee_id, e.employee_no, e.name_zh, e.name_vi, d.name_zh
    HAVING COUNT(CASE WHEN a.status IN ('late', 'early', 'absent') THEN 1 END) > 0
    ORDER BY absent_days DESC, late_days DESC
    LIMIT 50
  `);
  return rows;
}

// ── Leave ─────────────────────────────────────────────────────────────────
async function getPendingLeaves() {
  const rows = await query(`
    SELECT
      lr.id,
      lr.request_no,
      lr.employee_id,
      e.employee_no,
      e.name_zh,
      e.name_vi,
      d.name_zh AS dept_name_zh,
      lt.code AS leave_type_code,
      lt.name_zh AS leave_type_name_zh,
      lr.start_date,
      lr.end_date,
      lr.total_days,
      lr.reason,
      lr.created_at
    FROM hr_leave_requests lr
    JOIN hr_employees e ON e.id = lr.employee_id
    LEFT JOIN hr_departments d ON d.id = e.department_id
    JOIN hr_leave_types lt ON lt.id = lr.leave_type_id
    WHERE lr.status = 'pending'
    ORDER BY lr.created_at DESC
  `);
  return rows;
}

async function getLowLeaveBalances(thresholdDays = 1) {
  const rows = await query(`
    SELECT
      lb.id,
      lb.employee_id,
      e.employee_no,
      e.name_zh,
      e.name_vi,
      lt.code AS leave_type_code,
      lt.name_zh AS leave_type_name_zh,
      lb.total_days,
      lb.used_days,
      lb.available_days,
      lb.pending_days
    FROM hr_leave_balances lb
    JOIN hr_employees e ON e.id = lb.employee_id
    JOIN hr_leave_types lt ON lt.id = lb.leave_type_id
    WHERE lb.available_days <= $1
      AND lb.year = EXTRACT(YEAR FROM CURRENT_DATE)
    ORDER BY lb.available_days
  `, [thresholdDays]);
  return rows;
}

// ── Overtime ──────────────────────────────────────────────────────────────
async function getPendingOvertime() {
  const rows = await query(`
    SELECT
      ot.id,
      ot.request_no,
      ot.employee_id,
      e.employee_no,
      e.name_zh,
      e.name_vi,
      d.name_zh AS dept_name_zh,
      ot.work_date,
      ot.start_time,
      ot.end_time,
      ot.total_hours,
      ot.reason,
      ot.created_at
    FROM hr_overtime_requests ot
    JOIN hr_employees e ON e.id = ot.employee_id
    LEFT JOIN hr_departments d ON d.id = e.department_id
    WHERE ot.status = 'pending'
    ORDER BY ot.created_at DESC
  `);
  return rows;
}

async function getOvertimeThisWeek() {
  const rows = await query(`
    SELECT
      ot.employee_id,
      e.employee_no,
      e.name_zh,
      e.name_vi,
      d.name_zh AS dept_name_zh,
      SUM(ot.total_hours) AS weekly_hours,
      COUNT(*) AS ot_days
    FROM hr_overtime_requests ot
    JOIN hr_employees e ON e.id = ot.employee_id
    LEFT JOIN hr_departments d ON d.id = e.department_id
    WHERE ot.status = 'approved'
      AND ot.work_date >= CURRENT_DATE - INTERVAL '7 days'
    GROUP BY ot.employee_id, e.employee_no, e.name_zh, e.name_vi, d.name_zh
    HAVING SUM(ot.total_hours) > 20
    ORDER BY weekly_hours DESC
  `);
  return rows;
}

// ── Compliance ────────────────────────────────────────────────────────────
async function getComplianceIssues() {
  // Combined: missing SI numbers, missing contracts, expired contract batches
  const missingSi = await query(`
    SELECT id, employee_no, name_zh, name_vi, social_insurance_no
    FROM hr_employees
    WHERE status IN ('active', 'probation')
      AND (social_insurance_no IS NULL OR social_insurance_no = '')
    ORDER BY name_zh
  `);
  const expiredContracts = await query(`
    SELECT id, employee_no, name_zh, name_vi, contract_end_date
    FROM hr_employees
    WHERE status = 'active'
      AND contract_end_date < CURRENT_DATE
    ORDER BY contract_end_date
  `);
  return { missingSi, expiredContracts };
}

// ── Monthly summary ──────────────────────────────────────────────────────
async function getMonthlySummary() {
  const year = Number(args.year ?? new Date().getFullYear());
  const month = Number(args.month ?? new Date().getMonth() + 1);
  const rows = await query(`
    SELECT
      COUNT(DISTINCT employee_id) AS total_employees,
      SUM(normal_days) AS total_normal,
      SUM(late_days) AS total_late,
      SUM(early_days) AS total_early,
      SUM(absent_days) AS total_absent,
      SUM(leave_days) AS total_leave,
      SUM(total_ot_hours) AS total_ot,
      SUM(total_late_minutes) AS total_late_minutes
    FROM v_hr_monthly_attendance
    WHERE year = $1 AND month = $2
  `, [year, month]);
  return rows[0] ?? {};
}

// ── Dashboard stats ──────────────────────────────────────────────────────
async function getDashboardStats() {
  const [active, byDept, pendingLeave, pendingOt, todayAtt, monthly] = await Promise.all([
    query(`SELECT COUNT(*) AS count FROM hr_employees WHERE status IN ('active','probation')`),
    query(`SELECT d.name_zh, COUNT(e.id) AS count FROM hr_employees e JOIN hr_departments d ON d.id = e.department_id WHERE e.status IN ('active','probation') GROUP BY d.name_zh ORDER BY count DESC`),
    query(`SELECT COUNT(*) AS count FROM hr_leave_requests WHERE status = 'pending'`),
    query(`SELECT COUNT(*) AS count FROM hr_overtime_requests WHERE status = 'pending'`),
    query(`SELECT status, COUNT(*) AS count FROM hr_attendance_records WHERE work_date = CURRENT_DATE GROUP BY status`),
    query(`SELECT COUNT(DISTINCT employee_id) AS total, SUM(COALESCE(total_ot_hours, 0)) AS ot FROM v_hr_monthly_attendance WHERE year = EXTRACT(YEAR FROM CURRENT_DATE) AND month = EXTRACT(MONTH FROM CURRENT_DATE)`),
  ]);
  return {
    activeEmployees: Number(active[0]?.count ?? 0),
    byDepartment: byDept,
    pendingLeaves: Number(pendingLeave[0]?.count ?? 0),
    pendingOt: Number(pendingOt[0]?.count ?? 0),
    todayAttendance: todayAtt,
    monthlyStats: monthly[0] ?? {},
  };
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  try {
    let data = {};

    if (argv === "employees" || argv === "all") {
      data.employees = await getEmployees();
      data.probationExpiring = await getProbationExpiring();
      data.contractExpiring = await getContractExpiring();
      data.resignedRecent = await getResignedRecent();
    }
    if (argv === "attendance" || argv === "all") {
      data.todayAttendance = await getTodayAttendance();
      data.missedClockIn = await getMissedClockIn();
      data.weeklyAttendance = await getWeeklyAttendanceStats();
    }
    if (argv === "leave" || argv === "all") {
      data.pendingLeaves = await getPendingLeaves();
      data.lowLeaveBalances = await getLowLeaveBalances();
    }
    if (argv === "ot" || argv === "all") {
      data.pendingOvertime = await getPendingOvertime();
      data.overtimeExcessive = await getOvertimeThisWeek();
    }
    if (argv === "compliance" || argv === "all") {
      data.compliance = await getComplianceIssues();
    }
    if (argv === "dashboard" || argv === "all") {
      data.dashboard = await getDashboardStats();
      data.monthly = await getMonthlySummary();
    }

    console.log(JSON.stringify(data, null, 2));
  } catch (err) {
    console.error(JSON.stringify({ error: err.message }));
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
