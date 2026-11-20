#!/usr/bin/env node
/**
 * Virtual-employee report system.
 *
 * Usage:
 *   node scripts/ve-report.mjs                       # all reports, markdown to stdout
 *   node scripts/ve-report.mjs --report=integrity    # one report
 *   node scripts/ve-report.mjs --format=json         # machine readable
 *   node scripts/ve-report.mjs --out=docs/virtual-employees/reports
 *
 * Reads the same PG* environment as scripts/migrate.mjs; never sources .env in bash
 * (it is CRLF and a trailing newline breaks getaddrinfo).
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENV_PATH = join(ROOT, ".env");
if (existsSync(ENV_PATH)) {
  for (const raw of readFileSync(ENV_PATH, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^PG[A-Z_]+$/.test(key) || process.env[key] !== undefined) continue;
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, v = "1"] = a.replace(/^--/, "").split("=");
  return [k, v];
}));
const format = args.format === "json" ? "json" : "md";
const REPORTS = {
  roster: {
    title: "在岗花名册与汇报线",
    sql: `SELECT department, staffing, employee_id, name_zh, reports_to_name AS reports_to, owns_loop, enabled FROM ve_v_roster ORDER BY department, staffing DESC, employee_id`,
  },
  integrity: {
    title: "汇报线完整性（必须全部 OK）",
    sql: `SELECT verdict, employee_id, reports_to FROM ve_v_line_integrity ORDER BY verdict, employee_id`,
  },
  load: {
    title: "部门负载（近 7 日任务）",
    sql: `SELECT department, enabled_positions, placeholders, supervisors, tasks_7d FROM ve_v_department_load ORDER BY department`,
  },
  throughput: {
    title: "人工审批吞吐（每人每日 ≤30 单；超出即需拆审批层）",
    sql: `SELECT day, human_gate, employee_id, gated_tasks, approved, blocked, p50_wait_ms, p90_wait_ms FROM ve_v_approval_throughput ORDER BY day DESC, gated_tasks DESC LIMIT 100`,
  },
  competency: {
    title: "四力档案矩阵（主管与总监须四力全 ≥3）",
    sql: `SELECT employee_id, department, staffing, forces_assessed, min_level, last_assessed_at FROM ve_v_competency_matrix ORDER BY staffing, department, employee_id`,
  },
  coverage: {
    title: "岗位落地覆盖（tasks/events 双 0 = 死岗位）",
    sql: `SELECT employee_id, department, staffing, enabled, tasks, events, training_cases, evaluations FROM ve_v_coverage ORDER BY enabled DESC, tasks DESC, employee_id`,
  },
  kpi: {
    title: "岗位日指标（最新）",
    sql: `SELECT employee_id, day, tasks_created, tasks_completed, tasks_rejected, awaiting_approval, approval_granted, approval_denied, events, training_cases, evaluations FROM ve_v_kpi_latest ORDER BY employee_id`,
  },
};

function cell(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") return JSON.stringify(value);
  return String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function toMarkdown(title, rows) {
  if (!rows.length) return `# ${title}\n\n_无数据_\n`;
  const cols = Object.keys(rows[0]);
  const head = `| ${cols.join(" | ")} |`;
  const rule = `|${cols.map(() => "---").join("|")}|`;
  const body = rows.map(r => `| ${cols.map(c => cell(r[c])).join(" | ")} |`);
  return [`# ${title}`, "", head, rule, ...body, ""].join("\n");
}

const pool = new pg.Pool({
  host: process.env.PGHOST ?? "127.0.0.1",
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? "postgres",
  password: process.env.PGPASSWORD ?? "postgres",
  database: process.env.PGDATABASE ?? "smt_factory",
});

const AGGREGATE_SQL = `
INSERT INTO ve_kpi_daily (employee_id, day, tasks_created, tasks_completed, tasks_rejected,
  awaiting_approval, approval_granted, approval_denied, approval_wait_p50_ms, approval_wait_p90_ms,
  events, training_cases, training_runs_passed, evaluations, computed_at)
SELECT e.employee_id, d.day::date,
  (SELECT count(*) FROM factory_virtual_employee_tasks t WHERE t.employee_id=e.employee_id AND t.created_at::date=d.day::date),
  (SELECT count(*) FROM factory_virtual_employee_tasks t WHERE t.employee_id=e.employee_id AND t.created_at::date=d.day::date AND t.status IN ('COMPLETED','CLOSED')),
  (SELECT count(*) FROM factory_virtual_employee_tasks t WHERE t.employee_id=e.employee_id AND t.created_at::date=d.day::date AND t.status IN ('REJECTED','REWORK')),
  (SELECT count(*) FROM factory_virtual_employee_tasks t WHERE t.employee_id=e.employee_id AND t.created_at::date=d.day::date AND t.status='WAITING_APPROVAL'),
  (SELECT count(*) FROM factory_virtual_employee_tasks t WHERE t.employee_id=e.employee_id AND t.created_at::date=d.day::date AND t.approved_by IS NOT NULL),
  (SELECT count(*) FROM factory_virtual_employee_tasks t WHERE t.employee_id=e.employee_id AND t.created_at::date=d.day::date AND t.status='REJECTED'),
  (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (t.completed_at-t.created_at))*1000)
     FROM factory_virtual_employee_tasks t WHERE t.employee_id=e.employee_id AND t.created_at::date=d.day::date AND t.completed_at IS NOT NULL)::bigint,
  (SELECT percentile_cont(0.9) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (t.completed_at-t.created_at))*1000)
     FROM factory_virtual_employee_tasks t WHERE t.employee_id=e.employee_id AND t.created_at::date=d.day::date AND t.completed_at IS NOT NULL)::bigint,
  (SELECT count(*) FROM factory_virtual_employee_events v WHERE v.employee_id=e.employee_id AND v.created_at::date=d.day::date),
  (SELECT count(*) FROM factory_virtual_employee_training_cases c WHERE c.employee_id=e.employee_id AND c.created_at::date=d.day::date),
  (SELECT count(*) FROM factory_virtual_employee_training_runs r WHERE r.employee_id=e.employee_id AND r.created_at::date=d.day::date AND r.score>=80),
  (SELECT count(*) FROM factory_virtual_employee_evaluations v WHERE v.employee_id=e.employee_id AND v.period_end=d.day::date),
  NOW()
FROM ve_reporting_lines e
CROSS JOIN generate_series(CURRENT_DATE - INTERVAL '29 days', CURRENT_DATE, INTERVAL '1 day') AS d(day)
WHERE e.enabled
ON CONFLICT (employee_id, day) DO UPDATE SET
  tasks_created=EXCLUDED.tasks_created, tasks_completed=EXCLUDED.tasks_completed,
  tasks_rejected=EXCLUDED.tasks_rejected, awaiting_approval=EXCLUDED.awaiting_approval,
  approval_granted=EXCLUDED.approval_granted, approval_denied=EXCLUDED.approval_denied,
  approval_wait_p50_ms=EXCLUDED.approval_wait_p50_ms, approval_wait_p90_ms=EXCLUDED.approval_wait_p90_ms,
  events=EXCLUDED.events, training_cases=EXCLUDED.training_cases,
  training_runs_passed=EXCLUDED.training_runs_passed, evaluations=EXCLUDED.evaluations,
  computed_at=NOW();
`;

if (args.aggregate) {
  try {
    const result = await pool.query(AGGREGATE_SQL);
    console.log(`AGGREGATED rows=${result.rowCount}`);
  } catch (err) {
    console.error(`AGGREGATE_FAILED ${err.message}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
  process.exit(process.exitCode ?? 0);
}

const ids = !args.report || args.report === "all" ? Object.keys(REPORTS) : String(args.report).split(",");
const unknown = ids.filter(id => !REPORTS[id]);
if (unknown.length) {
  console.error(`Unknown report: ${unknown.join(", ")}. Available: ${Object.keys(REPORTS).join(", ")}`);
  process.exit(2);
}

try {
  for (const id of ids) {
    const result = await pool.query(REPORTS[id].sql);
    const out = format === "json"
      ? JSON.stringify({ report: id, generatedAt: new Date().toISOString(), rows: result.rows }, null, 2)
      : toMarkdown(REPORTS[id].title, result.rows);
    if (args.out) {
      mkdirSync(String(args.out), { recursive: true });
      writeFileSync(join(String(args.out), `ve-${id}.${format === "json" ? "json" : "md"}`), out + "\n", "utf8");
      console.log(`WROTE ${join(String(args.out), `ve-${id}.${format === "json" ? "json" : "md"}`)} rows=${result.rowCount}`);
    } else {
      console.log(out);
    }
  }
} catch (err) {
  console.error(`REPORT_FAILED ${err.message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
