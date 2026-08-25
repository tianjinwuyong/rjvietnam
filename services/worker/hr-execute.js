/**
 * hr-execute.js — HR AI Manager executor
 * Bridges Ornith's HR decisions to API calls and database operations.
 *
 * Usage:
 *   node hr-execute.js <action> [options]
 *
 * Actions:
 *   attendance-alert    --employee-id <id> --type absent|late|early --date YYYY-MM-DD
 *   leave-decision      --employee-id <id> --leave-type annual|sick|unpaid --start YYYY-MM-DD --days N --approve|deny
 *   overtime-decision   --employee-id <id> --hours N --date YYYY-MM-DD --approve|deny
 *   compliance-reminder  --employee-id <id> --item health-check|work-permit|contract --due YYYY-MM-DD
 *   employee-onboard    --employee-id <id> --department <code>
 *   training-assign     --employee-id <id> --course-id <id>
 *   patrol
 *   help
 */

import jwt from "jsonwebtoken";
import pg from "pg";
import { readFileSync, existsSync } from "fs";

const { Pool } = pg;

const JWT_SECRET = process.env.JWT_SECRET ?? "smt-factory-secret-2026";
const API_BASE   = process.env.API_BASE   ?? "http://127.0.0.1:8080";

const pool = new Pool({
  host:     process.env.PGHOST     || "127.0.0.1",
  port:     Number(process.env.PGPORT) || 5432,
  database: process.env.PGDATABASE || "smt_factory",
  user:     process.env.PGUSER     || "postgres",
  password: process.env.PGPASSWORD || "postgres",
});

function log(level, msg) {
  const ts = new Date().toISOString().slice(0, 19).replace("T", " ");
  console.log(`${ts} [${level}] ${msg}`);
}

function jwtSign(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "2h" });
}

async function apiCall(method, path, body, token) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${method} ${path} failed ${res.status}: ${text}`);
  }
  return res.json().catch(() => ({}));
}

async function lineNotify(message) {
  const tokenPath = "services/worker/line_token.txt";
  if (!existsSync(tokenPath)) { log("WARN", "LINE token not found"); return; }
  const token = readFileSync(tokenPath, "utf-8").trim();
  try {
    await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        to: process.env.LINE_GROUP_ID ?? "Cxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        messages: [{ type: "text", text: `[HR] ${message}` }],
      }),
    });
  } catch (e) {
    log("WARN", `LINE notify failed: ${e.message}`);
  }
}

async function attendanceAlert(employeeId, type, date, token) {
  log("INFO", `Processing attendance alert: ${employeeId} ${type} on ${date}`);
  try {
    const result = await apiCall("POST", "/api/hr/attendance/alert",
      { employee_id: employeeId, alert_type: type, date }, token);
    if (result.alert_level === "CRITICAL") {
      await lineNotify(`[CRITICAL] 员工 ${employeeId} 连续旷工/迟到 ${date}`);
    }
    return result;
  } catch (err) {
    log("ERROR", `Attendance alert failed: ${err.message}`);
    return { error: err.message };
  }
}

async function leaveDecision(employeeId, leaveType, startDate, days, decision, reason, token) {
  log("INFO", `Leave decision: ${employeeId} ${leaveType} ${startDate} ${days}d — ${decision}`);
  try {
    const result = await apiCall("POST", "/api/hr/leave/decision",
      { employee_id: employeeId, leave_type: leaveType, start_date: startDate, days, decision, reason },
      token);
    if (decision === "deny") {
      await lineNotify(`请假申请被驳回: 员工 ${employeeId} ${leaveType} ${startDate} - ${reason}`);
    }
    return result;
  } catch (err) {
    log("ERROR", `Leave decision failed: ${err.message}`);
    return { error: err.message };
  }
}

async function overtimeDecision(employeeId, hours, date, decision, reason, token) {
  log("INFO", `OT decision: ${employeeId} ${hours}h on ${date} — ${decision}`);
  // Check Vietnam labor law CU28 limits: max 200h/year, 40h/month
  try {
    const check = await apiCall("GET", `/api/hr/employee/${employeeId}/ot-balance`, null, token);
    if (check.ot_balance !== undefined && check.ot_balance + hours > 40) {
      await lineNotify(`[WARN] 员工 ${employeeId} 加班超月限: 当前余额 ${check.ot_balance}h + 申请 ${hours}h`);
    }
    const result = await apiCall("POST", "/api/hr/overtime/decision",
      { employee_id: employeeId, hours, date, decision, reason }, token);
    return result;
  } catch (err) {
    log("ERROR", `OT decision failed: ${err.message}`);
    return { error: err.message };
  }
}

async function complianceReminder(employeeId, item, dueDate, token) {
  log("INFO", `Compliance reminder: ${employeeId} ${item} due ${dueDate}`);
  try {
    const result = await apiCall("POST", "/api/hr/compliance/reminder",
      { employee_id: employeeId, item, due_date: dueDate }, token);
    if (result.days_until_due !== undefined && result.days_until_due <= 7) {
      await lineNotify(`[提醒] 员工 ${employeeId} ${item} 还有 ${result.days_until_due} 天到期`);
    }
    return result;
  } catch (err) {
    log("ERROR", `Compliance reminder failed: ${err.message}`);
    return { error: err.message };
  }
}

async function employeeOnboard(employeeId, department, token) {
  log("INFO", `Onboarding employee: ${employeeId} department ${department}`);
  try {
    const result = await apiCall("POST", "/api/hr/onboard",
      { employee_id: employeeId, department }, token);
    await lineNotify(`新员工入职完成: ${employeeId} 部门 ${department}`);
    return result;
  } catch (err) {
    log("ERROR", `Onboard failed: ${err.message}`);
    return { error: err.message };
  }
}

async function trainingAssign(employeeId, courseId, token) {
  log("INFO", `Assigning training: ${employeeId} course ${courseId}`);
  try {
    const result = await apiCall("POST", "/api/hr/training/assign",
      { employee_id: employeeId, course_id: courseId }, token);
    return result;
  } catch (err) {
    log("ERROR", `Training assign failed: ${err.message}`);
    return { error: err.message };
  }
}

async function patrol(token) {
  log("INFO", "HR patrol starting...");
  // Patrol: check today's attendance anomalies, pending leave, upcoming compliance
  const attendance = await apiCall("GET", "/api/hr/attendance/today", null, token);
  const pendingLeave = await apiCall("GET", "/api/hr/leave/pending", null, token);
  const complianceDue = await apiCall("GET", "/api/hr/compliance/due-soon", null, token);
  log("INFO", "HR patrol complete.");
  return { attendance, pending_leave: pendingLeave, compliance_due: complianceDue };
}

// CLI
const [action, ...restArgs] = process.argv.slice(2);
const args = {};
for (let i = 0; i < restArgs.length; i++) {
  if (restArgs[i].startsWith("--")) {
    args[restArgs[i].slice(2)] = restArgs[i + 1] ?? null;
    i++;
  }
}

async function main() {
  const token = jwtSign({ agent: "hr-ai", role: "executor" });

  switch (action) {
    case "attendance-alert": {
      console.log(JSON.stringify(await attendanceAlert(args["employee-id"], args["type"], args["date"], token), null, 2));
      break;
    }
    case "leave-decision": {
      const decision = args["approve"] ? "approve" : args["deny"] ? "deny" : "pending";
      console.log(JSON.stringify(await leaveDecision(args["employee-id"], args["leave-type"], args["start"], Number(args["days"]), decision, args["reason"] || "", token), null, 2));
      break;
    }
    case "overtime-decision": {
      const decision = args["approve"] ? "approve" : args["deny"] ? "deny" : "pending";
      console.log(JSON.stringify(await overtimeDecision(args["employee-id"], Number(args["hours"]), args["date"], decision, args["reason"] || "", token), null, 2));
      break;
    }
    case "compliance-reminder": {
      console.log(JSON.stringify(await complianceReminder(args["employee-id"], args["item"], args["due"], token), null, 2));
      break;
    }
    case "employee-onboard": {
      console.log(JSON.stringify(await employeeOnboard(args["employee-id"], args["department"], token), null, 2));
      break;
    }
    case "training-assign": {
      console.log(JSON.stringify(await trainingAssign(args["employee-id"], args["course-id"], token), null, 2));
      break;
    }
    case "patrol": {
      console.log(JSON.stringify(await patrol(token), null, 2));
      break;
    }
    default:
      console.log(`HR Executor Usage:
  node hr-execute.js attendance-alert --employee-id <id> --type absent|late|early --date YYYY-MM-DD
  node hr-execute.js leave-decision --employee-id <id> --leave-type annual|sick|unpaid --start YYYY-MM-DD --days N [--approve|--deny] [--reason <text>]
  node hr-execute.js overtime-decision --employee-id <id> --hours N --date YYYY-MM-DD [--approve|--deny]
  node hr-execute.js compliance-reminder --employee-id <id> --item health-check|work-permit|contract --due YYYY-MM-DD
  node hr-execute.js employee-onboard --employee-id <id> --department <code>
  node hr-execute.js training-assign --employee-id <id> --course-id <id>
  node hr-execute.js patrol`);
  }

  await pool.end();
}

main().catch(async err => {
  console.error(JSON.stringify({ error: err.message }));
  await pool.end().catch(() => {});
  process.exit(1);
});
