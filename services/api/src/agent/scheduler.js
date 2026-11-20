// Who runs when. Derived from frequencies.js, not from a uniform 5-minute tick:
//   EVENT / WATCH  -> due when the elapsed time since the last sweep reaches
//                     intervalSeconds (deterministic probes; no model call here)
//   BATCH          -> due when the cron expression matches the current
//                     Asia/Ho_Chi_Minh minute, once per matching minute
//   DEMAND         -> never scheduled; only a human or a peer dispatch runs it
//
// Vietnam has no DST, so a fixed UTC+7 offset is exact and avoids pulling an
// ICU tz database into the agent plane.

import { FREQUENCIES, CADENCE_KIND } from "../virtual-employees/frequencies.js";

export const TZ_OFFSET_MINUTES = 7 * 60;
export const TICK_MS = 60_000;

export function localParts(date = new Date()) {
  const shifted = new Date(date.getTime() + TZ_OFFSET_MINUTES * 60_000);
  return {
    minute: shifted.getUTCMinutes(),
    hour: shifted.getUTCHours(),
    day: shifted.getUTCDate(),
    month: shifted.getUTCMonth() + 1,
    weekday: shifted.getUTCDay(),
    stamp: `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`,
    minuteKey: shifted.toISOString().slice(0, 16),
  };
}

function fieldMatches(field, value, { dayWildcard = false } = {}) {
  if (field === "*") return true;
  if (dayWildcard && field === "?") return true;
  return String(field).split(",").some(part => {
    const stepMatch = /^(.+)\/(\d+)$/.exec(part);
    const step = stepMatch ? Number(stepMatch[2]) : 1;
    const body = stepMatch ? stepMatch[1] : part;
    if (body.includes("-")) {
      const [rawFrom, rawTo] = body.split("-");
      const from = Number(rawFrom), to = Number(rawTo);
      if (!Number.isFinite(from) || !Number.isFinite(to)) return false;
      // wrap-over ranges such as `22-2` (night shift)
      const inRange = from <= to ? value >= from && value <= to : value >= from || value <= to;
      return inRange && (value - from) % step === 0;
    }
    if (step > 1) return value % step === 0 && value >= Number(body || 0);
    return value === Number(body);
  });
}

// Minimal 5-field cron (minute hour day month weekday). Supports lists, ranges
// including wrap-over, and */n — which is everything frequencies.js uses.
export function cronMatches(expr, parts = localParts()) {
  const fields = String(expr || "").trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const [minute, hour, day, month, weekday] = fields;
  const domRestricted = day !== "*";
  const dowRestricted = weekday !== "*" && weekday !== "?";
  const dateOk = fieldMatches(minute, parts.minute) && fieldMatches(hour, parts.hour);
  if (!domRestricted && !dowRestricted) return dateOk;
  if (domRestricted && dowRestricted) {
    // cron semantics: with both restricted, either may fire the job
    return dateOk && (fieldMatches(day, parts.day) || fieldMatches(weekday, parts.weekday));
  }
  if (domRestricted) return dateOk && fieldMatches(day, parts.day) && fieldMatches(month, parts.month);
  return dateOk && fieldMatches(weekday, parts.weekday, { dayWildcard: true }) && fieldMatches(month, parts.month);
}

// `lastRun` holds UTC timestamps while cron minutes are local; compare like
// with like, or a 22:00 Vietnam job fires at the wrong UTC hour.
export function minuteKeyOf(timestamp) {
  return timestamp ? localParts(new Date(timestamp)).minuteKey : null;
}

const elapsed = (lastRunAt, nowMs, seconds) =>
  !lastRunAt || nowMs - Date.parse(lastRunAt) >= seconds * 1000;
// Pure: given the clock and the last run of every employee, decide who is due.
export function dueNow({ now = new Date(), employeeIds = Object.keys(FREQUENCIES), lastRun = {}, allowDemand = false } = {}) {
  const parts = localParts(now);
  const nowMs = now.getTime();
  const due = [];
  for (const id of employeeIds) {
    const cadence = FREQUENCIES[id];
    if (!cadence) { due.push({ employeeId: id, kind: "UNDECLARED", reason: "FREQUENCY_NOT_DECLARED" }); continue; }
    if (cadence.kind === CADENCE_KIND.DEMAND) {
      if (allowDemand) due.push({ employeeId: id, kind: "DEMAND", reason: "manual dispatch", parts });
      continue;
    }
    if (cadence.kind === CADENCE_KIND.BATCH) {
      if (cronMatches(cadence.cron, parts) && minuteKeyOf(lastRun[`${id}#primary`]) !== parts.minuteKey) {
        due.push({ employeeId: id, kind: "BATCH", reason: `cron ${cadence.cron}`, window: cadence.window || null, parts });
      }
      continue;
    }
    const seconds = Number(cadence.intervalSeconds) || 300;
    if (elapsed(lastRun[id], nowMs, seconds)) {
      due.push({ employeeId: id, kind: cadence.kind, reason: `every ${seconds}s`, intervalSeconds: seconds, parts });
    }
    if (cadence.secondary && cadence.secondary.kind === CADENCE_KIND.BATCH
      && cronMatches(cadence.secondary.cron, parts)
      && minuteKeyOf(lastRun[`${id}#secondary`]) !== parts.minuteKey) {
      due.push({ employeeId: id, kind: "BATCH", secondary: true, reason: `cron ${cadence.secondary.cron}`, parts });
    }
  }
  return due;
}

// The batch jobs around the loops. Deliberately not hourly: learning and
// knowledge collection are nightly, competency is weekly, so a model-free
// scheduler still cannot churn the tables.
export const JOBS = Object.freeze({
  learn: { cron: "30 22 * * *", note: "把当天的人工纠正变成训练案例" },
  knowledge: { cron: "0 23 * * *", note: "采集本领域经验条目并写入记忆" },
  competency: { cron: "0 6 * * 1", note: "每周一合成四力" },
  report: { cron: "15 7 * * *", note: "生成日报（ve-report --report=all）" },
});

export function dueJobs({ now = new Date(), lastRun = {} } = {}) {
  const parts = localParts(now);
  return Object.entries(JOBS)
    .filter(([name, job]) => cronMatches(job.cron, parts) && minuteKeyOf(lastRun[name]) !== parts.minuteKey)
    .map(([name, job]) => ({ job: name, reason: `cron ${job.cron}`, note: job.note }));
}

// ── Durable last-run state, without a new column ────────────────────────
// `factory_virtual_employee_configs` has no last_run_at and adding one is a
// schema change (irreversible list). So the loop records a SCHEDULER_TICK event
// keyed by employee or job whenever it actually produced something, and
// rehydrates from that on boot. A run that produced nothing needs no record:
// task_key / case_key already make a repeat harmless.
export const SCHEDULER_TICK_EVENT = "SCHEDULER_TICK";
export const SCHEDULER_OWNER = "OPS-SUPERVISOR-VIRTUAL-01";

export async function loadLastRun({ query, hours = 24 }) {
  const rows = (await query(
    `SELECT detail->>'key' AS key, max(created_at) AS last_run
       FROM factory_virtual_employee_events
      WHERE event_type = $1
        AND created_at > NOW() - make_interval(hours => $2::int)
      GROUP BY 1`, [SCHEDULER_TICK_EVENT, hours])).rows;
  return Object.fromEntries(rows.filter(r => r.key).map(r => [r.key, new Date(r.last_run).toISOString()]));
}

export async function recordTick({ query, key, detail = {}, employeeId = SCHEDULER_OWNER }) {
  // employee_id is NOT NULL in this table — every tick belongs to somebody.
  await query(
    `INSERT INTO factory_virtual_employee_events(employee_id, task_id, event_type, detail, actor)
     VALUES ($1, NULL, $2, $3::jsonb, 'scheduler')`,
    [employeeId, SCHEDULER_TICK_EVENT, JSON.stringify({ key, ...detail })]);
  return { key, employeeId };
}
