// Self-learning for every virtual employee, built on the existing human
// training tables: factory_virtual_employee_training_cases / _training_runs /
// _evaluations. No new table, no new model, no self-approval.
//
// Loop: a human decision on a task (APPROVED / REJECTED / CORRECTED) becomes a
// DRAFT training case for that employee, with a deterministic readiness score.
// A human reviews the run; only then does the case become APPROVED and count
// toward the employee's four-competency profile.

import { FACTORY_VIRTUAL_EMPLOYEES } from "../virtual-employees/registry.js";

export const LEARNING_SOURCES = Object.freeze([
  "HUMAN_APPROVED", "HUMAN_REJECTED", "HUMAN_CORRECTED", "LOW_CONFIDENCE_ESCALATED",
]);

const SOURCE_QUERY = `
SELECT e.id AS row_key, e.event_type, e.detail, e.task_id, e.created_at,
       t.task_type, t.human_gate, t.status AS task_status, t.input
FROM factory_virtual_employee_events e
LEFT JOIN factory_virtual_employee_tasks t ON t.id = e.task_id
LEFT JOIN factory_virtual_employee_training_cases c
  ON c.employee_id = e.employee_id
 AND c.title = 'AUTO:' || e.id::text || ':' || e.event_type
WHERE e.employee_id = $1
  AND e.event_type = ANY($2::text[])
  AND c.id IS NULL
ORDER BY e.id ASC LIMIT $3`;

function makeCase(row) {
  const detail = row.detail || {};
  const evidenceCount = Array.isArray(detail.evidence) ? detail.evidence.length
    : Array.isArray(detail.evidenceIds) ? detail.evidenceIds.length : 0;
  const positive = row.event_type === "HUMAN_APPROVED";
  const title = `AUTO:${row.row_key}:${row.event_type}`;
  const expected = positive
    ? `保持该任务的判定路径与证据结构；门 ${row.human_gate || "N/A"} 必须由人类签核后才可放行。`
    : `避免重复该错误：证据不足时停在人工门 ${row.human_gate || "N/A"}，补证后再提交，不得自行写业务表。`;
  // Deterministic readiness score, NOT a model judgement. It measures whether
  // the case has enough structure to be worth a human review.
  let score = 40;
  if (row.human_gate) score += 20;
  if (evidenceCount >= 2) score += 20;
  if (row.task_type) score += 20;
  score = Math.min(100, score);
  return {
    title,
    scenario: JSON.stringify({ eventType: row.event_type, taskId: row.task_id,
      taskType: row.task_type, gate: row.human_gate, detail, at: row.created_at }, null, 2),
    expected_behavior: expected,
    acceptance_criteria: {
      sourceEventId: Number(row.row_key), sourceTaskId: row.task_id ? Number(row.task_id) : null,
      gate: row.human_gate, evidenceCount, noDirectBusinessWrite: true,
      requiresHumanApproval: true, positiveExample: positive,
    },
    score,
  };
}

export async function learnFromCorrections({ employeeId, query, limit = 5, dryRun = false, sources = LEARNING_SOURCES }) {
  const rows = (await query(SOURCE_QUERY, [employeeId, [...sources], limit])).rows;
  const cases = [];
  for (const row of rows) {
    const c = makeCase(row);
    if (dryRun) { cases.push({ ...c, employeeId, dryRun: true }); continue; }
    const inserted = await query(
      `INSERT INTO factory_virtual_employee_training_cases
        (employee_id,title,scenario,expected_behavior,acceptance_criteria,status,created_by)
       VALUES ($1,$2,$3,$4,$5::jsonb,'DRAFT',$6) RETURNING id`,
      [employeeId, c.title, c.scenario, c.expected_behavior,
        JSON.stringify(c.acceptance_criteria), `ve:${employeeId}`],
    );
    await query(
      `INSERT INTO factory_virtual_employee_training_runs
        (case_id,employee_id,response,score,result,reviewer,feedback)
       VALUES ($1,$2,$3,$4,'WAITING_REVIEW',NULL,NULL) RETURNING id`,
      [inserted.rows[0].id, employeeId, `Auto-generated from ${row.event_type}: ${row.task_type || "task"}`,
        c.score],
    );
    await query(
      `INSERT INTO factory_virtual_employee_events(employee_id,task_id,event_type,detail,actor)
       VALUES ($1,$2,'TRAINING_CASE_CREATED',$3::jsonb,$4)`,
      [employeeId, row.task_id || null,
        JSON.stringify({ title: c.title, score: c.score, source: row.event_type }), `ve:${employeeId}`],
    );
    cases.push({ ...c, employeeId, caseId: inserted.rows[0].id });
  }
  return { employeeId, scanned: rows.length, casesCreated: cases.length, cases };
}

// Human-only. A virtual employee can never approve its own training case.
export async function reviewTrainingRun({ query, runId, reviewer, pass, feedback = "" }) {
  if (!reviewer || String(reviewer).startsWith("ve:")) {
    return { ok: false, code: "VE_CANNOT_APPROVE_TRAINING" };
  }
  const updated = await query(
    `UPDATE factory_virtual_employee_training_runs
        SET result=$2, reviewer=$3, feedback=$4, reviewed_at=NOW()
      WHERE id=$1 AND result='WAITING_REVIEW' RETURNING case_id, employee_id`,
    [runId, pass ? "PASSED" : "FAILED", reviewer, feedback],
  );
  if (!updated.rowCount) return { ok: false, code: "RUN_NOT_WAITING" };
  const { case_id, employee_id } = updated.rows[0];
  if (pass) {
    await query(`UPDATE factory_virtual_employee_training_cases
                    SET status='APPROVED', approved_by=$2, updated_at=NOW()
                  WHERE id=$1`, [case_id, reviewer]);
  }
  await query(
    `INSERT INTO factory_virtual_employee_events(employee_id,task_id,event_type,detail,actor)
     VALUES ($1,NULL,'TRAINING_REVIEWED',$2::jsonb,$3)`,
    [employee_id, JSON.stringify({ runId: Number(runId), caseId: Number(case_id),
      result: pass ? "PASSED" : "FAILED" }), reviewer],
  );
  return { ok: true, caseId: Number(case_id), employeeId: employee_id, result: pass ? "PASSED" : "FAILED" };
}

export async function learningCycle({ employeeIds, query, limit = 5, dryRun = false }) {
  const results = [];
  for (const id of employeeIds) {
    results.push(await learnFromCorrections({ employeeId: id, query, limit, dryRun }));
  }
  return { employees: results.length, casesCreated: results.reduce((s, r) => s + r.casesCreated, 0), results };
}

export function allEmployeeIds() {
  return FACTORY_VIRTUAL_EMPLOYEES.map(e => e.id);
}
