/**
 * hr-manager.js — HR AI Manager Brain
 *
 * Ornith-powered HR patrol agent for factory employee management.
 * Follows wms-manager.js architecture exactly.
 * Runs on schedule via Windows Task Scheduler or continuous loop.
 *
 * Usage:
 *   node hr-manager.js patrol         # One-shot HR patrol cycle
 *   node hr-manager.js morning        # Morning HR digest + LINE
 *   node hr-manager.js watch          # Continuous loop (every 30min)
 *   node hr-manager.js digest         # HR summary report
 */

import { spawn } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

const PROJECT_ROOT = process.cwd();
const HR_QUERY_SCRIPT = join(PROJECT_ROOT, "services/worker/hr-query.js");
const ORNITH_MODEL    = "hf.co/deepreinforce-ai/Ornith-1.0-9B-GGUF:Q5_K_M";
const OPENCODE_EXE    = `${process.env.APPDATA}\\npm\\node_modules\\opencode-ai\\bin\\opencode.exe`;
const LINE_TOKEN      = join(PROJECT_ROOT, "services/worker/line_hr_group.txt");
const STATE_FILE      = join(PROJECT_ROOT, "services/worker/hr-last-state.json");
const LOG_FILE        = join(PROJECT_ROOT, "services/worker/hr-manager.log");

// ── Agent Bus (inter-agent communication) ─────────────────────────────────────
import { createMemoryClient, memoryHealth } from "../_shared/memory-client.js";
import { createManagerBus } from "../_shared/manager-bus.js";
import { completeAgentMessage } from "../_shared/agent-bus.js";
import { askLLM, askLLMWithFallback, scoreResponse } from "../_shared/llm-router.js";

const mem = createMemoryClient({ agentId: "hr-ai" });

const MESSAGE_HANDLERS = {
  // MES → HR
  "line_understaffed":        handleLineUnderstaffed,
  "operator_performance":     handleOperatorPerformance,
  "station_cert_gap":         handleStationCertGap,
  "training_needed":          handleTrainingNeeded,
  // WMS → HR
  "work_order_critical":      handleWorkOrderCritical,
  "material_shortage":        handleMaterialShortage,
  "material_shortage_alert":  handleMaterialShortageAlert,
  // BOM → HR
  "bom_updated":              handleBomUpdated,
  "bom_operator_impact":      handleBomOperatorImpact,
  "material_spec_change":     handleMaterialSpecChange,
  // RDA → HR
  "report_ready":             handleReportReady,
  "anomaly_detected":         handleAnomalyDetected,
  "attendance_anomaly_report": handleAttendanceAnomalyReport,
  "workload_analysis":       handleWorkloadAnalysis,
  "hr_data_request":         handleHrDataRequest,
  // Broadcast
  "system_alert":             handleSystemAlert,
  // Plant Manager
  "plant_directive":          handlePlantDirective,
  "plant_status_request":     handlePlantStatusRequest,
};

// ── Manager Bus ────────────────────────────────────────────────────────────
const bus = createManagerBus({
  agentId: "hr-ai",
  log,
  logPrefix: "[BUS] ",
  handlers: MESSAGE_HANDLERS,
});

// ── Agent Bus — process inbound messages ──────────────────────────────────────
async function processAgentMessages() {
  await bus.init();
  await bus.poll(20);
}

// ── Agent Bus — Outbound Senders ───────────────────────────────────────────────

async function informMesOperatorAbsent(employeeId, name, shiftType, lineCode, stationType) {
  await bus.init();
  await bus.send("mes-ai", "operator_absent", {
    employee_id: employeeId,
    name,
    shift_type: shiftType,
    line_code: lineCode,
    station_type: stationType,
  });
}

async function informMesShiftChange(lineCode, oldOperator, newOperator, stationCode, effectiveFrom) {
  await ensureBusInit();
  await bus.send("mes-ai", "shift_change", {
    line_code: lineCode,
    old_operator: oldOperator,
    new_operator: newOperator,
    station_code: stationCode,
    effective_from: effectiveFrom,
  });
}

async function informMesCertificationExpiring(employeeId, name, certification, expiresAt, stationType) {
  await ensureBusInit();
  await bus.send("mes-ai", "certification_expiring", {
    employee_id: employeeId,
    name,
    certification,
    expires_at: expiresAt,
    station_type: stationType,
  });
}

async function informMesNewOperatorAssigned(employeeId, name, lineCode, stationType, certifications, startDate) {
  await ensureBusInit();
  await bus.send("mes-ai", "new_operator_assigned", {
    employee_id: employeeId,
    name,
    line_code: lineCode,
    station_type: stationType,
    certifications,
    start_date: startDate,
  });
}

async function informMesOtLimitWarning(employeeId, name, otThisMonth, legalLimit, lineCode) {
  await ensureBusInit();
  await bus.send("mes-ai", "ot_limit_warning", {
    employee_id: employeeId,
    name,
    ot_this_month: otThisMonth,
    legal_limit: legalLimit,
    line_code: lineCode,
  });
}

async function informWmsOperatorLeaveCoverage(lineCode, operatorEmployeeNo, leaveDates, coverageNeeded) {
  await ensureBusInit();
  await bus.send("wms-ai", "operator_leave_coverage", {
    line_code: lineCode,
    operator_employee_no: operatorEmployeeNo,
    leave_dates: leaveDates,
    coverage_needed: coverageNeeded,
  });
}

async function informBomTrainingAffectedMaterials(lineCode, trainingTopic, affectedMaterials) {
  await ensureBusInit();
  await bus.send("bom-ai", "training_material_impact", {
    line_code: lineCode,
    training_topic: trainingTopic,
    affected_materials: affectedMaterials,
  });
}

async function informRdaAttendanceDataRequest(period, dataPoints) {
  await ensureBusInit();
  await bus.send("rda-ai", "hr_data_for_analysis", {
    period,
    data_points: dataPoints,
  });
}

// ── Agent Bus — send outbound messages after Ornith analysis ─────────────────
async function sendOutboundMessages(analysis, hrData) {
  const results = [];

  // Operator absent alerts → MES
  for (const a of (analysis.attendance_alerts ?? [])) {
    if (a.severity === "critical" && a.issue === "absent" && a.action === "flag_manager") {
      await informMesOperatorAbsent(
        a.employee_id, a.name_zh,
        hrData.todayAttendance?.find(r => r.employee_id === a.employee_id)?.shift_code ?? "DAY",
        hrData.todayAttendance?.find(r => r.employee_id === a.employee_id)?.line_code ?? "SMT-01",
        hrData.todayAttendance?.find(r => r.employee_id === a.employee_id)?.station_type ?? "AOI"
      );
      results.push({ type: "operator_absent", employee_id: a.employee_id });
    }
  }

  // Shift changes → MES
  for (const l of (analysis.leave_decisions ?? [])) {
    if (l.decision === "approve" && l.auto_execute) {
      // Inform MES that this operator will be absent
      await informMesOperatorAbsent(
        l.employee_id,
        hrData.pendingLeaves?.find(p => p.id === l.request_no)?.name_zh ?? "unknown",
        "DAY", "SMT-01", "AOI"
      );
      results.push({ type: "leave_approved", request_no: l.request_no });
    }
  }

  // OT limit warnings → MES
  for (const o of (analysis.overtime_decisions ?? [])) {
    if (o.decision === "flag" || o.decision === "approve") {
      const emp = hrData.pendingOvertime?.find(p => p.employee_id === o.employee_id);
      if (emp) {
        await informMesOtLimitWarning(
          o.employee_id, emp.name_zh,
          emp.ot_hours_this_month ?? 0, 40, emp.line_code ?? "SMT-01"
        );
        results.push({ type: "ot_warning", employee_id: o.employee_id });
      }
    }
  }

  // Compliance issues → MES (certification expiry)
  for (const c of (analysis.compliance_reminders ?? [])) {
    if (c.issue === "probation_ending" || c.issue === "contract_expiring") {
      const emp = hrData.compliance?.missingSi?.find(e => e.employee_id === c.employee_id);
      if (emp) {
        await informMesCertificationExpiring(
          c.employee_id, emp.name_zh,
          c.issue, new Date(Date.now() + 30 * 86400000).toISOString(), "AOI"
        );
        results.push({ type: "cert_expiry", employee_id: c.employee_id });
      }
    }
  }

  // Weekly escalations → MES (shift change needed)
  for (const w of (analysis.weekly_escalations ?? [])) {
    if (w.severity === "critical" && w.issue === "连续缺勤") {
      await informMesShiftChange(
        w.line_code ?? "SMT-01",
        w.employee_id, null, "SM01", new Date().toISOString()
      );
      results.push({ type: "shift_change", employee_id: w.employee_id });
    }
  }

  // RDA: request attendance analysis if there are anomalies
  const anomalyCount = (analysis.attendance_alerts?.length ?? 0) + (analysis.weekly_escalations?.length ?? 0);
  if (anomalyCount >= 3) {
    await informRdaAttendanceDataRequest("last_7d", ["attendance_rate", "ot_trend", "absence_pattern"]);
    results.push({ type: "rda_request" });
  }

  return results;
}

// ── Logging ───────────────────────────────────────────────────────────
function log(level, msg) {
  const ts = new Date().toISOString().slice(0, 19).replace("T", " ");
  const line = `${ts} [${level}] ${msg}`;
  console.log(line);
  try {
    const { appendFileSync } = require("fs");
    appendFileSync(LOG_FILE, line + "\n");
  } catch (_) {}
}

// ── Run external script (args as array, no shell injection) ──────────
function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", args, {
      cwd: PROJECT_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "", err = "";
    child.stdout.on("data", d => (out += d));
    child.stderr.on("data", d => (err += d));
    child.on("close", code => {
      if (code !== 0) reject(new Error(`${out}\n${err}`));
      else resolve(out);
    });
  });
}

// ── Run opencode (args as array, uses cmd /c on Windows) ─────────────
function runOpencode(args) {
  return new Promise((resolve, reject) => {
    const cmdLine = `opencode ${args.join(" ")}`;
    const child = spawn("cmd", ["/c", cmdLine], {
      cwd: PROJECT_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PATH: process.env.PATH },
    });
    let out = "", err = "";
    child.stdout.on("data", d => (out += d));
    child.stderr.on("data", d => (err += d));
    child.on("close", code => {
      if (code !== 0) reject(new Error(`${out}\n${err}`));
      else resolve(out);
    });
  });
}

// ── Parse Ornith JSON output ──────────────────────────────────────────
/** Extract balanced-brace JSON object starting at `start` index in `str`. */
function extractJsonObject(str, start) {
  if (str[start] !== '{') {
    while (start >= 0 && str[start] !== '{') start--;
  }
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < str.length; i++) {
    if (str[i] === '{') depth++;
    else if (str[i] === '}') { depth--; if (depth === 0) return str.slice(start, i + 1); }
    else if (str[i] === '"') { i++; while (i < str.length && str[i] !== '"') { if (str[i] === '\\') i++; i++; } }
  }
  return null;
}

function parseOrnithOutput(raw) {
  if (!raw) return null;
  let clean = raw
    .replace(/Thinking Process:[\s\S]*?(?:Final Answer:|Actual JSON:|<\/think>)/i, "")
    .replace(/<\/?think>[\s\S]*?<\/think>/gi, "")
    .replace(/^(?:Final Answer:|Actual JSON:)\s*/gim, "")
    .trim();

  // Strategy 0: direct full JSON parse (most common clean output)
  try { return JSON.parse(clean); } catch (_) {}

  // Strategy 1: <ANALYSIS>...</ANALYSIS> block
  const tagMatch = clean.match(/<ANALYSIS>\s*(\{[\s\S]*?\})\s*<\/ANALYSIS>/i);
  if (tagMatch) {
    try { return JSON.parse(tagMatch[1]); } catch (_) {}
  }
  // Strategy 2: bare JSON with attendance_alerts and summary
  const jsonMatch = clean.match(/\{[\s\S]*"attendance_alerts"[\s\S]*"summary"[\s\S]*\}/);
  if (jsonMatch) {
    try { return JSON.parse(jsonMatch[0]); } catch (_) {}
  }
  // Strategy 3: any JSON with attendance_alerts (brace-counting)
  const altMatch = clean.match(/"attendance_alerts"\s*:\s*\[/);
  if (altMatch) {
    const objStr = extractJsonObject(clean, clean.indexOf('"attendance_alerts"'));
    if (objStr) { try { return JSON.parse(objStr); } catch (_) {} }
  }
  // Strategy 4: find "anomalies" field (Ornith alternative schema)
  const anomaliesMatch = clean.match(/"anomalies"\s*:\s*\[/);
  if (anomaliesMatch) {
    const objStr = extractJsonObject(clean, clean.indexOf('"anomalies"'));
    if (objStr) { try { return JSON.parse(objStr); } catch (_) {} }
  }
  // Strategy 5: find any JSON object with "summary" (string)
  const summaryMatch = clean.match(/"summary"\s*:\s*"[^"]*"/);
  if (summaryMatch) {
    const objStr = extractJsonObject(clean, clean.indexOf('"summary"'));
    if (objStr) { try { return JSON.parse(objStr); } catch (_) {} }
  }
  return null;
}

// ── LINE notification (fallback to line_token.txt if group token missing) ─
async function sendLINE(message) {
  let tokenPath = LINE_TOKEN;
  if (!existsSync(tokenPath)) {
    tokenPath = join(PROJECT_ROOT, "services/worker/line_token.txt");
  }
  if (!existsSync(tokenPath)) {
    log("WARN", "LINE token not found, skipping notification");
    return;
  }
  const token = readFileSync(tokenPath, "utf8").trim();
  if (!token) return;

  const res = await fetch("https://notify-api.line.me/api/notify", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
  if (!res.ok) log("WARN", `LINE notification failed: ${res.status}`);
  else log("INFO", "LINE notification sent");
}

// ── State management (mem0-backed, with JSON file fallback) ─────────
async function loadState() {
  try {
    const results = await mem.search("most recent HR manager state", 1);
    if (results.results?.length > 0) {
      const latest = results.results[0];
      const st = latest.metadata?.state;
      if (st) return st;
    }
  } catch (_) {}
  try {
    if (existsSync(STATE_FILE)) return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch (_) {}
  return {
    attendanceAnomalies: [],
    pendingLeaves: [],
    pendingOvertime: [],
    complianceIssues: [],
    lastCycle: null,
  };
}

async function saveState(state) {
  try {
    const label = `HR cycle — ${state.lastCycle?.slice(0, 10) || "?"}`;
    await mem.store(`${label} — ${(state.attendanceAnomalies || []).length} attendance issues, ${(state.pendingLeaves || []).length} leaves`, { type: "hr_state", state, ts: state.lastCycle || new Date().toISOString() });
  } catch (e) {
    log("WARN", `mem0 saveState failed: ${e.message}`);
  }
  try { require("fs").writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); } catch (_) {}
}

// ── Delta detection ───────────────────────────────────────────────────
async function detectChanges(currentData) {
  const prev = await loadState();
  const changes = { newAnomalies: [], newLeaves: [], newOt: [], newCompliance: [] };

  // Attendance anomalies (new absences/late)
  const prevAttendance = new Set((prev.attendanceAnomalies || []).map(a => `${a.employee_id}:${a.work_date || ""}`));
  for (const a of (currentData.todayAttendance || [])) {
    const key = `${a.employee_id}:${new Date().toISOString().slice(0, 10)}`;
    if ((a.status === "absent" || a.status === "late") && !prevAttendance.has(key)) {
      changes.newAnomalies.push(a);
    }
  }
  // Missed clock-in is always new if it exists
  for (const m of (currentData.missedClockIn || [])) {
    changes.newAnomalies.push({
      employee_id: m.employee_id,
      employee_no: m.employee_no,
      name_zh: m.name_zh,
      dept_name_zh: m.dept_name_zh,
      shift_code: m.shift_code,
      status: "no_clock_in",
    });
  }

  // Pending leaves (compare IDs)
  const prevLeaveIds = new Set((prev.pendingLeaves || []).map(l => l.id));
  for (const l of (currentData.pendingLeaves || [])) {
    if (!prevLeaveIds.has(l.id)) {
      changes.newLeaves.push(l);
    }
  }

  // Pending OT (compare IDs)
  const prevOtIds = new Set((prev.pendingOvertime || []).map(o => o.id));
  for (const o of (currentData.pendingOvertime || [])) {
    if (!prevOtIds.has(o.id)) {
      changes.newOt.push(o);
    }
  }

  // Compliance issues (compare counts)
  if (currentData.compliance) {
    changes.newCompliance = currentData.compliance;
  }

  return changes;
}

// ── Build Ornith prompt ────────────────────────────────────────────────
function buildPrompt(data, changes) {
  const ts = new Date().toLocaleString("zh-CN");
  const today = new Date().toISOString().slice(0, 10);
  const dayOfWeek = new Date().getDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  // Skip TOTAY_ATTENDANCE section on weekends to prevent false "全员缺勤" alerts
  const attendanceBlock = !isWeekend
    ? `<TODAY_ATTENDANCE>\n${JSON.stringify(data.todayAttendance ?? [], null, 2)}\n</TODAY_ATTENDANCE>\n\n<MISSED_CLOCK_IN>\n${JSON.stringify(data.missedClockIn ?? [], null, 2)}\n</MISSED_CLOCK_IN>`
    : `<TODAY_ATTENDANCE>今日是休息日，无考勤要求</TODAY_ATTENDANCE>\n\n<MISSED_CLOCK_IN>休息日无需打卡</MISSED_CLOCK_IN>`;

  return `工厂HR巡逻报告 — ${ts}
日期: ${today} (${isWeekend ? "周末休息日" : "工作日"})

<EMPLOYEES>
总员工数: ${data.dashboard?.activeEmployees ?? "?"}
待处理请假: ${data.dashboard?.pendingLeaves ?? 0}
待处理加班: ${data.dashboard?.pendingOt ?? 0}
</EMPLOYEES>

${attendanceBlock}

<WEEKLY_ATTENDANCE_ISSUES>
${JSON.stringify(data.weeklyAttendance ?? [], null, 2)}
</WEEKLY_ATTENDANCE_ISSUES>

<PENDING_LEAVES>
${JSON.stringify(data.pendingLeaves ?? [], null, 2)}
</PENDING_LEAVES>

<PENDING_OVERTIME>
${JSON.stringify(data.pendingOvertime ?? [], null, 2)}
</PENDING_OVERTIME>

<OVERTIME_EXCESSIVE>
${JSON.stringify(data.overtimeExcessive ?? [], null, 2)}
</OVERTIME_EXCESSIVE>

<LOW_LEAVE_BALANCES>
${JSON.stringify(data.lowLeaveBalances ?? [], null, 2)}
</LOW_LEAVE_BALANCES>

<PROBATION_EXPIRING>
${JSON.stringify(data.probationExpiring ?? [], null, 2)}
</PROBATION_EXPIRING>

<CONTRACT_EXPIRING>
${JSON.stringify(data.contractExpiring ?? [], null, 2)}
</CONTRACT_EXPIRING>

<COMPLIANCE_ISSUES>
${JSON.stringify(data.compliance ?? {}, null, 2)}
</COMPLIANCE_ISSUES>

你是一个SMT电子工厂的HR AI管理员。基于以上数据，做出智能人事决策。

严格按照以下JSON格式返回（只返回JSON，不要其他文字）：

<ANALYSIS>
{
  "attendance_alerts": [
    {
      "severity": "critical|warning|info",
      "employee_id": 123,
      "employee_no": "EMP001",
      "name_zh": "姓名",
      "issue": "no_clock_in|late|absent|early_leave",
      "detail": "详细描述",
      "action": "send_reminder|flag_manager|auto_deduct",
      "auto_execute": true
    }
  ],
  "leave_decisions": [
    {
      "request_no": "LV202606001",
      "employee_id": 123,
      "employee_no": "EMP001",
      "leave_type": "annual|sick|personal",
      "total_days": 2.5,
      "decision": "approve|reject|flag",
      "reason": "判定原因",
      "auto_execute": true
    }
  ],
  "overtime_decisions": [
    {
      "request_no": "OT202606001",
      "employee_id": 123,
      "decision": "approve|reject|flag",
      "reason": "判定原因",
      "auto_execute": true
    }
  ],
  "compliance_reminders": [
    {
      "employee_id": 123,
      "issue": "missing_si|contract_expired|probation_ending",
      "detail": "缺少社保号等",
      "action": "send_notice|flag_supervisor",
      "auto_execute": true
    }
  ],
  "weekly_escalations": [
    {
      "employee_id": 123,
      "name_zh": "姓名",
      "issue": "频繁迟到|连续缺勤|OT超限",
      "detail": "本周累计迟到X次等",
      "severity": "warning|critical",
      "action": "escalate_to_manager"
    }
  ],
  "summary": "一句话总结今日HR巡逻重点"
}
</ANALYSIS>`;
}

// ── Execute attendance alerts ─────────────────────────────────────────
async function executeAttendanceAlerts(alerts) {
  const results = [];
  for (const a of alerts ?? []) {
    if (!a.auto_execute) {
      log("INFO", `[ATTENDANCE] ${a.name_zh} ${a.issue} — auto=false, skipping`);
      continue;
    }
    log("INFO", `[ATTENDANCE] ${a.employee_no} ${a.issue}: ${a.action}`);
    // Cross-manager: notify MES about operator absence
    if (a.issue === "absent" || a.issue === "no_clock_in") {
      await ensureBusInit();
  await bus.send("mes-ai", "operator_absent", {
        employee_no: a.employee_no,
        name_zh: a.name_zh,
        issue: a.issue,
        detail: a.detail,
        action: a.action,
      }, { priority: a.severity === "critical" ? "critical" : "normal" });
    }
    results.push({
      employee_id: a.employee_id,
      employee_no: a.employee_no,
      issue: a.issue,
      action: a.action,
      result: "ok",
    });
  }
  return results;
}

// ── Execute leave decisions ───────────────────────────────────────────
async function executeLeaveDecisions(decisions) {
  const results = [];
  for (const d of decisions ?? []) {
    if (!d.auto_execute) {
      log("INFO", `[LEAVE] ${d.request_no} ${d.decision} — auto=false, skipping`);
      continue;
    }
    log("INFO", `[LEAVE] ${d.request_no} → ${d.decision}: ${d.reason}`);
    results.push({
      request_no: d.request_no,
      decision: d.decision,
      result: "ok",
    });
  }
  return results;
}

// ── Execute OT decisions ──────────────────────────────────────────────
async function executeOvertimeDecisions(decisions) {
  const results = [];
  for (const d of decisions ?? []) {
    if (!d.auto_execute) {
      log("INFO", `[OT] ${d.request_no} ${d.decision} — auto=false, skipping`);
      continue;
    }
    log("INFO", `[OT] ${d.request_no} → ${d.decision}: ${d.reason}`);
    // Cross-manager: warn MES if OT is rejected (line may need staffing adjustment)
    if (d.decision === "reject" || d.decision === "flag") {
      await ensureBusInit();
  await bus.send("mes-ai", "ot_limit_warning", {
        request_no: d.request_no,
        employee_no: d.employee_no,
        decision: d.decision,
        reason: d.reason,
      }, { priority: "normal" });
    }
    results.push({
      request_no: d.request_no,
      decision: d.decision,
      result: "ok",
    });
  }
  return results;
}

// ── Execute compliance reminders ──────────────────────────────────────
async function executeCompliance(reminders) {
  const results = [];
  for (const r of reminders ?? []) {
    log("INFO", `[COMPLIANCE] Employee #${r.employee_id} ${r.issue}: ${r.action}`);
    results.push({
      employee_id: r.employee_id,
      issue: r.issue,
      action: r.action,
      result: "ok",
    });
  }
  return results;
}

// ── Agent Bus: Inbound message handlers ─────────────────────────────────────

async function handleLineUnderstaffed(payload) {
  const { line_code, required_operators, actual_operators, station_type, shift } = payload;
  log("INFO", `[MES→HR] line_understaffed: ${line_code} ${station_type} shift ${shift} — 需要${required_operators}人/实际${actual_operators}人`);
  // Flag for HR to arrange cover or overtime
  await sendLINE(`📢 [HR] ${line_code} 产线缺人: 需要${required_operators}人/实际${actual_operators}人 (${station_type}, ${shift}班)`);
}

async function handleOperatorPerformance(payload) {
  const { station_code, operator_name, shift, yield_pct, defect_count, sample_size, period_hours } = payload;
  log("INFO", `[MES→HR] operator_performance: ${operator_name} @ ${station_code} — ${yield_pct}% 良品率, ${defect_count}缺陷/${sample_size}样本`);
  // Store in attendance/performance record for next patrol evaluation
}

async function handleStationCertGap(payload) {
  const { line_code, station_code, station_type, operator_name, missing_certification } = payload;
  log("WARN", `[MES→HR] station_cert_gap: ${operator_name} on ${line_code}/${station_code} missing "${missing_certification}"`);
  // Alert HR to arrange certification training urgently
  await sendLINE(`🔴 [HR 紧急] ${operator_name} 在 ${line_code} 岗位(${station_type})缺少证书: ${missing_certification}。请立即处理！`);
}

async function handleTrainingNeeded(payload) {
  const { line_code, station_type, defect_code, defect_trend } = payload;
  log("INFO", `[MES→HR] training_needed: ${line_code} ${station_type} defect ${defect_code} 趋势: ${defect_trend}`);
  // Note for HR training module
}

async function handleWorkOrderCritical(payload) {
  const { work_order_code, line_code, priority, reason } = payload;
  log("INFO", `[WMS→HR] work_order_critical: WO:${work_order_code} on ${line_code} — ${reason}`);
  // May need OT approval or emergency hiring
  await sendLINE(`⚠️ [HR] 工单 ${work_order_code} 优先级${priority}: ${reason}`);
}

async function handleMaterialShortage(payload) {
  const { material_code, line_code, shortage_qty, shortage_reason } = payload;
  log("INFO", `[WMS→HR] material_shortage: ${material_code} 缺${shortage_qty} for ${line_code} — ${shortage_reason}`);
  // Could trigger temporary labor adjustment
}

async function handleBomUpdated(payload) {
  const { product_code, changed_by, changed_at, change_summary } = payload;
  log("INFO", `[BOM→HR] bom_updated: ${product_code} changed by ${changed_by} at ${changed_at}`);
  // BOM change may require retraining on new materials
}

async function handleReportReady(payload) {
  const { request_id, report_type, summary } = payload;
  log("INFO", `[RDA→HR] report_ready: ${report_type} (req=${request_id}): ${summary}`);
}

async function handleAnomalyDetected(payload) {
  const { anomaly_type, severity, detail } = payload;
  log("INFO", `[RDA→HR] anomaly_detected: ${severity} ${anomaly_type} — ${detail}`);
  if (severity === "critical") {
    await sendLINE(`🔴 [HR] 异常检测: ${anomaly_type} — ${detail}`);
  }
}

async function handleSystemAlert(payload) {
  const { alert_level, source_agent, subject, detail } = payload;
  log("WARN", `[ALL→HR] system_alert from ${source_agent}: ${subject} — ${detail}`);
  if (alert_level === "critical") {
    await sendLINE(`🚨 [系统告警] ${subject}: ${detail}`);
  }
}

async function handleMaterialShortageAlert(payload) {
  const { material_code, line_code, urgency } = payload;
  log("INFO", `[WMS→HR] material_shortage_alert: ${material_code} for ${line_code} — urgency: ${urgency}`);
}

async function handleBomOperatorImpact(payload) {
  const { product_code, operator_name, line_code, impact_detail } = payload;
  log("INFO", `[BOM→HR] bom_operator_impact: ${operator_name} on ${line_code} — ${product_code}: ${impact_detail}`);
}

async function handleMaterialSpecChange(payload) {
  const { material_code, old_spec, new_spec, changed_by } = payload;
  log("INFO", `[BOM→HR] material_spec_change: ${material_code} changed by ${changed_by}: ${old_spec} → ${new_spec}`);
}

async function handleAttendanceAnomalyReport(payload) {
  const { employee_no, anomaly_type, detail } = payload;
  log("INFO", `[RDA→HR] attendance_anomaly_report: ${employee_no} — ${anomaly_type}: ${detail}`);
}

async function handleWorkloadAnalysis(payload) {
  const { line_code, ot_hours, period, summary } = payload;
  log("INFO", `[RDA→HR] workload_analysis: ${line_code} — ${ot_hours}h OT this ${period}: ${summary}`);
}

async function handleHrDataRequest(payload) {
  const { request_id, data_scope } = payload;
  log("INFO", `[RDA→HR] hr_data_request: ${request_id} scope=${data_scope}`);
  try {
    const raw = await run([HR_QUERY_SCRIPT, "all"]);
    const data = JSON.parse(raw);
    await completeAgentMessage(payload.message_id, {
      ok: true,
      data: {
        active_employees: data.dashboard?.activeEmployees ?? 0,
        today_attendance: data.todayAttendance ?? [],
        pending_leaves: data.pendingLeaves ?? [],
        pending_overtime: data.pendingOvertime ?? [],
      }
    });
  } catch (err) {
    await failAgentMessage(payload.message_id, err.message);
  }
}

// ── Plant Manager directive handler ───────────────────────────────────────
async function handlePlantDirective(payload) {
  const { source, severity, title, detail, line_code, action } = payload;
  log("WARN", `[PLANT→HR] plant_directive: [${severity}] ${title} — ${detail}`);
  if (severity === "critical") {
    await sendLINE(`🏭 [工厂指令-HR] ${title}\n产线: ${line_code ?? "N/A"}\n详情: ${detail}`);
  }
}

// ── Plant Manager status request handler ──────────────────────────────────
async function handlePlantStatusRequest(payload) {
  const { request_id, scope } = payload;
  log("INFO", `[PLANT→HR] plant_status_request: scope=${scope} req=${request_id}`);
  try {
    const raw = await run([HR_QUERY_SCRIPT, "all"]);
    const data = JSON.parse(raw);
    const kpis = {
      active_employees:  data.dashboard?.activeEmployees ?? 0,
      on_duty:           (data.todayAttendance ?? []).filter(a => a.status !== "absent").length,
      absent_today:      (data.todayAttendance ?? []).filter(a => a.status === "absent").length,
      attendance_rate:   data.dashboard?.attendanceRate ?? 0,
      pending_leaves:    (data.pendingLeaves ?? []).length,
      pending_ot:        (data.pendingOvertime ?? []).length,
      training_pending:  (data.pendingLeaves ?? []).length, // simplified
    };
    await ensureBusInit();
  await bus.send("plant-ai", "plant_status_response", {
      request_id,
      source: "hr-ai",
      kpis,
    }, { correlationId: request_id });
    log("INFO", `[PLANT→HR] plant_status_response sent for req=${request_id}`);
  } catch (err) {
    log("ERR", `[PLANT→HR] plant_status_request failed: ${err.message}`);
    await ensureBusInit();
  await bus.send("plant-ai", "plant_status_response", {
      request_id,
      source: "hr-ai",
      error: err.message,
    }, { correlationId: request_id });
  }
}

// ── Log decisions ────────────────────────────────────────────────────
function logDecisions(analysis) {
  const sections = [
    ["Attendance alerts", analysis.attendance_alerts],
    ["Leave decisions", analysis.leave_decisions],
    ["OT decisions", analysis.overtime_decisions],
    ["Compliance reminders", analysis.compliance_reminders],
    ["Weekly escalations", analysis.weekly_escalations],
  ];
  for (const [label, items] of sections) {
    if (items?.length > 0) {
      log("INFO", `[HR DECISION] ${label}: ${items.length}`);
      for (const d of items) {
        const auto = d.auto_execute !== false ? "AUTO" : "MANUAL";
        log("INFO", `  [${auto}] ${JSON.stringify(d)}`);
      }
    }
  }
}

// ── Send HR alerts to LINE ────────────────────────────────────────────
async function sendAlertsToLINE(analysis) {
  const criticalAttendance = (analysis.attendance_alerts ?? []).filter(a => a.severity === "critical");
  const warnings = [
    ...(analysis.attendance_alerts ?? []).filter(a => a.severity === "warning"),
    ...(analysis.weekly_escalations ?? []).filter(a => a.severity === "warning"),
  ];
  const weeklyCritical = (analysis.weekly_escalations ?? []).filter(a => a.severity === "critical");

  if (criticalAttendance.length > 0) {
    let msg = "🔴 HR紧急告警\n━━━━━━━━━━━━━━━━━━";
    for (const a of criticalAttendance) {
      msg += `\n[考勤] ${a.name_zh}(${a.employee_no})`;
      msg += `\n问题: ${a.issue === "no_clock_in" ? "未打卡" : a.issue === "absent" ? "缺勤" : a.issue}`;
      msg += `\n行动: ${a.action}`;
    }
    msg += "\n━━━━━━━━━━━━━━━━━━";
    await sendLINE(msg);
  }

  if (warnings.length > 0) {
    let msg = "🟡 HR预警\n━━━━━━━━━━━━━━━━━━";
    for (const a of warnings) {
      msg += `\n${a.name_zh}(${a.employee_no}) — ${a.detail || a.issue}`;
    }
    msg += "\n━━━━━━━━━━━━━━━━━━";
    await sendLINE(msg);
  }

  // Summary in one LINE
  const summary = analysis.summary;
  if (summary) {
    await sendLINE(`📋 HR巡逻摘要\n${summary}`);
  }
}

// ── Save manual decisions to pending-approvals.json ──────────────────
const PENDING_FILE = join(PROJECT_ROOT, "services/worker/hr-pending-approvals.json");

function savePendingApprovals(analysis) {
  const pending = {
    leave: (analysis.leave_decisions ?? []).filter(d => d.auto_execute === false).map(d => ({
      request_no: d.request_no, decision: d.decision, reason: d.reason,
    })),
    overtime: (analysis.overtime_decisions ?? []).filter(d => d.auto_execute === false).map(d => ({
      request_no: d.request_no, decision: d.decision, reason: d.reason,
    })),
    attendance: (analysis.attendance_alerts ?? []).filter(a => a.auto_execute === false).map(a => ({
      employee_no: a.employee_no, issue: a.issue, action: a.action,
    })),
  };

  const total = pending.leave.length + pending.overtime.length + pending.attendance.length;
  if (total > 0) {
    log("INFO", `Saving ${total} manual HR decisions to hr-pending-approvals.json`);
    try {
      require("fs").writeFileSync(PENDING_FILE, JSON.stringify(pending, null, 2));
    } catch (_) {}
  }
}

// ── Main patrol cycle ────────────────────────────────────────────────
async function patrolCycle() {
  log("INFO", "=== HR Manager patrol starting ===");

  // 0. Process inbound messages from other managers
  await bus.init();
  try { await processAgentMessages(); } catch (err) { log("WARN", `Agent message processing: ${err.message}`); }

  // 1. Query HR data
  log("INFO", "Querying HR database...");
  let raw;
  try {
    raw = await run([HR_QUERY_SCRIPT, "all"]);
  } catch (err) {
    log("ERROR", `HR DB query failed: ${err.message}`);
    return;
  }
  const data = JSON.parse(raw);

  // 2. Delta detection
  const changes = await detectChanges(data);
  if (changes.newAnomalies.length > 0) {
    log("WARN", `New attendance anomalies: ${changes.newAnomalies.map(a => `${a.name_zh}(${a.status || a.issue})`).join(", ")}`);
  }
  if (changes.newLeaves.length > 0) {
    log("INFO", `New leave requests: ${changes.newLeaves.map(l => `${l.request_no}(${l.name_zh})`).join(", ")}`);
  }
  if (changes.newOt.length > 0) {
    log("INFO", `New OT requests: ${changes.newOt.map(o => `${o.request_no}(${o.name_zh})`).join(", ")}`);
  }

  // 3. Build Ornith prompt
  const prompt = buildPrompt(data, changes);

  // 4. Multi-model analysis
  log("INFO", "Sending to LLM for HR analysis...");
  let ornithOut;
  try {
    const multi = await askLLMWithFallback("analysis", prompt, { tier: "local" });
    ornithOut = multi.text;
    log("INFO", `Primary model ${multi.model} responded (${ornithOut.length} chars)`);
    if (scoreResponse(ornithOut) < 4) {
      const fb = await askLLM("validator", prompt, { temperature: 0.1 });
      if (scoreResponse(fb) > scoreResponse(ornithOut)) { ornithOut = fb; log("INFO", "Using validator output"); }
    }
  } catch (err) {
    log("ERROR", `Multi-model analysis failed: ${err.message}`);
    return;
  }

  // 5. Parse output
  const analysis = parseOrnithOutput(ornithOut);
  if (!analysis) {
    log("WARN", "Could not parse Ornith output");
    console.log("Raw output:", ornithOut?.slice(0, 500));
    return;
  }

  logDecisions(analysis);

  // 5b. Post-process: inject employee_id where Ornith returned null
  const empLookup = {};
  for (const e of (data.employees ?? [])) {
    empLookup[e.employee_no] = e.id;
  }
  // Also build from compliance source data
  for (const e of (data.compliance?.missingSi ?? [])) {
    if (!empLookup[e.employee_no]) empLookup[e.employee_no] = e.id;
  }
  for (const a of (analysis.attendance_alerts ?? [])) {
    if (!a.employee_id && a.employee_no) a.employee_id = empLookup[a.employee_no] ?? null;
  }
  for (const l of (analysis.leave_decisions ?? [])) {
    if (!l.employee_id && l.employee_no) l.employee_id = empLookup[l.employee_no] ?? null;
  }
  for (const c of (analysis.compliance_reminders ?? [])) {
    if (!c.employee_id && c.employee_no) c.employee_id = empLookup[c.employee_no] ?? null;
  }
  for (const w of (analysis.weekly_escalations ?? [])) {
    if (!w.employee_id && w.employee_no) w.employee_id = empLookup[w.employee_no] ?? null;
  }

  // 6. Execute all decision types
  if (analysis.attendance_alerts?.length > 0) await executeAttendanceAlerts(analysis.attendance_alerts);
  if (analysis.leave_decisions?.length > 0)   await executeLeaveDecisions(analysis.leave_decisions);
  if (analysis.overtime_decisions?.length > 0) await executeOvertimeDecisions(analysis.overtime_decisions);
  if (analysis.compliance_reminders?.length > 0) await executeCompliance(analysis.compliance_reminders);

  // 6b. Send outbound messages to other agents based on Ornith analysis
  try { await sendOutboundMessages(analysis, data); } catch (err) { log("WARN", `sendOutboundMessages: ${err.message}`); }

  // 7. Send LINE alerts
  await sendAlertsToLINE(analysis);

  // 8. Save manual decisions for dashboard
  savePendingApprovals(analysis);

  // 9. Save state for delta detection next cycle
  await saveState({
    attendanceAnomalies: data.todayAttendance ?? [],
    pendingLeaves: data.pendingLeaves ?? [],
    pendingOvertime: data.pendingOvertime ?? [],
    complianceIssues: data.compliance ?? {},
    lastCycle: new Date().toISOString(),
  });

  log("INFO", "=== HR patrol cycle complete ===");
}

// ── Morning Digest ───────────────────────────────────────────────────
async function morningDigest() {
  log("INFO", "Generating HR morning digest...");
  await bus.init();
  try { await processAgentMessages(); } catch (_) {}

  let raw;
  try {
    raw = await run([HR_QUERY_SCRIPT, "all"]);
  } catch (err) {
    log("ERROR", `HR DB query failed: ${err.message}`);
    return;
  }
  const data = JSON.parse(raw);
  const dashboard = data.dashboard ?? {};
  const attendance = data.todayAttendance ?? [];
  const missed = data.missedClockIn ?? [];
  const leaves = data.pendingLeaves ?? [];
  const ot = data.pendingOvertime ?? [];
  const probation = data.probationExpiring ?? [];
  const contracts = data.contractExpiring ?? [];

  const absent = attendance.filter(a => a.status === "absent").length;
  const late = attendance.filter(a => a.status === "late").length;
  const normal = attendance.filter(a => a.status === "normal").length;

  const msg = [
    `🌅 HR晨报 ${new Date().toLocaleDateString("zh-CN")}`,
    "━━━━━━━━━━━━━━━━━━",
    `👥 在职: ${dashboard.activeEmployees ?? 0}人`,
    `📊 今日出勤: ${normal}正常 | ${late}迟到 | ${absent}缺勤 | ${missed.length}未打卡`,
    `📝 待审批: 请假${leaves.length}条 | 加班${ot.length}条`,
    probation.length > 0 ? `⏰ 试用期将满(${probation.length}人): ${probation.map(p => p.name_zh).join(", ")}` : null,
    contracts.length > 0 ? `📄 合同将到期(${contracts.length}人): ${contracts.map(c => c.name_zh).join(", ")}` : null,
    dashboard.pendingOt > 0 ? `⚠️ 加班待批: ${dashboard.pendingOt}条` : null,
    "━━━━━━━━━━━━━━━━━━",
    "📋 详细分析见 OpenCode HR Manager",
  ].filter(Boolean).join("\n");

  await sendLINE(msg);
  console.log(msg);
}

// ── Digest (evening or ad-hoc HR summary) ──────────────────────────
async function digest() {
  log("INFO", "Generating HR summary digest...");

  let raw;
  try {
    raw = await run([HR_QUERY_SCRIPT, "all"]);
  } catch (err) {
    log("ERROR", `HR DB query failed: ${err.message}`);
    return;
  }
  const data = JSON.parse(raw);
  const weekly = data.weeklyAttendance ?? [];
  const excessive = data.overtimeExcessive ?? [];

  const repeatOffenders = weekly.filter(w => w.late_days >= 3 || w.absent_days >= 2);
  const otViolators = excessive;

  const msg = [
    `📊 HR周报摘要 — ${new Date().toLocaleDateString("zh-CN")}`,
    "━━━━━━━━━━━━━━━━━━",
    weekly.length > 0 ? `⚠️ 本周异常: ${weekly.length}条记录` : "✅ 本周考勤正常",
    repeatOffenders.length > 0 ? `🔴 高频异常(${repeatOffenders.length}人): ${repeatOffenders.map(r => `${r.name_zh}(${r.late_days}次迟到,${r.absent_days}次缺勤)`).join("; ")}` : null,
    otViolators.length > 0 ? `🟡 OT超限(${otViolators.length}人): ${otViolators.map(o => `${o.name_zh}(${o.weekly_hours}h)`).join("; ")}` : null,
    "━━━━━━━━━━━━━━━━━━",
    `📋 HR Manager: node hr-manager.js`,
  ].filter(Boolean).join("\n");

  await sendLINE(msg);
  console.log(msg);
}

// ── Watch loop ──────────────────────────────────────────────────────
async function watch(intervalMin = 30) {
  log("INFO", `Starting HR Manager watch loop (every ${intervalMin}min)`);
  const ms = intervalMin * 60 * 1000;
  while (true) {
    await patrolCycle();
    await new Promise(r => setTimeout(r, ms));
  }
}

// ── Continuous message listener ───────────────────────────────────────────────
async function busWatchLoop(intervalMs = 30 * 1000) {
  log("INFO", `HR bus-watch started (poll every ${intervalMs / 1000}s)`);
  await bus.init();
  for (;;) {
    try {
      await processAgentMessages();
    } catch (e) {
      log("WARN", `bus-watch error: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
}

// ── Ask ─────────────────────────────────────────────────────────────
async function ask(question) {
  log("INFO", `Q: ${question}`);
  try {
    const raw = await run([HR_QUERY_SCRIPT, "all"]);
    const data = JSON.parse(raw);
    const prompt = buildAskPrompt(data, question);
    const multi = await askLLMWithFallback("analysis", prompt, { tier: "local" });
    const ornithRaw = multi.text;
    const answer = ornithRaw
      .replace(/<\/?think>[\s\S]*?<\/think>/gi, "")
      .replace(/Thinking Process:[\s\S]*?(?:Final Answer:|Actual JSON:)/gi, "")
      .replace(/^(?:Final Answer:|Actual JSON:)\s*/gim, "")
      .trim();
    console.log(answer);
    return answer;
  } catch (err) {
    log("ERROR", `ask failed: ${err.message}`);
    throw err;
  }
}

function buildAskPrompt(data, question) {
  return `你是一个SMT电子工厂的HR AI管理员（人事管理）。

用户问题：${question}

以下是当前HR系统中的实时数据，请基于这些数据回答用户问题：

<EMPLOYEES>
${JSON.stringify(data.dashboard ?? {}, null, 2)}
</EMPLOYEES>

<TODAY_ATTENDANCE>
${JSON.stringify(data.todayAttendance ?? [], null, 2)}
</TODAY_ATTENDANCE>

<PENDING_LEAVES>
${JSON.stringify(data.pendingLeaves ?? [], null, 2)}
</PENDING_LEAVES>

<PENDING_OVERTIME>
${JSON.stringify(data.pendingOvertime ?? [], null, 2)}
</PENDING_OVERTIME>

<COMPLIANCE>
${JSON.stringify(data.compliance ?? {}, null, 2)}
</COMPLIANCE>

请直接回答用户问题，用中文，不要返回JSON格式。
如果数据不足，请明确说明需要补充哪些信息。`;
}

// ── CLI ─────────────────────────────────────────────────────────────
const [cmd, ...args] = process.argv.slice(2);

switch (cmd) {
  case "patrol":
    patrolCycle().catch(e => { console.error(e); process.exit(1); });
    break;
  case "morning":
    morningDigest().catch(e => { console.error(e); process.exit(1); });
    break;
  case "digest":
    digest().catch(e => { console.error(e); process.exit(1); });
    break;
  case "watch":
    watch(Number(args[0] ?? 30)).catch(e => { console.error(e); process.exit(1); });
    break;
  case "bus-watch":
    busWatchLoop().catch(e => { log("FATAL", e.message); process.exit(1); });
    break;
  case "ask": {
    const question = args.join(" ");
    if (!question) {
      console.log("Usage: node hr-manager.js ask \"<question>\"");
      process.exit(1);
    }
    ask(question).then(() => process.exit(0)).catch(() => process.exit(1));
    break;
  }
  default:
    console.log(`HR AI Manager
Usage: node hr-manager.js <command>

Commands:
  patrol    — Run one HR patrol analysis cycle
  morning   — Send morning HR digest to LINE
  digest    — Send HR week/daily summary to LINE
  watch     — Continuous HR patrol loop (default 30min)
  bus-watch — Continuous message listener (poll every 30s)
  ask       — Interactive Q&A about HR matters
`);
}
