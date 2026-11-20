// Deterministic four-competency (四力) synthesis from real rows.
// No model judgement: each level is a threshold over observable facts, and a
// computed row is never a signed row. Per JOB-DESCRIPTIONS §1.5 only a human
// assessment counts for promotion; these rows make the gap measurable.

export const FORCES = Object.freeze([
  "SELF_LEARNING", "KNOWLEDGE_ACCUMULATION", "SMART_JUDGMENT", "LOGICAL_REASONING",
]);

const METRICS_SQL = `
SELECT l.employee_id,
  (SELECT count(*) FROM factory_virtual_employee_training_cases c
     WHERE c.employee_id=l.employee_id) AS cases_total,
  (SELECT count(*) FROM factory_virtual_employee_training_cases c
     WHERE c.employee_id=l.employee_id AND c.status='APPROVED' AND c.approved_by IS NOT NULL) AS cases_approved,
  (SELECT count(*) FROM factory_virtual_employee_training_runs r
     WHERE r.employee_id=l.employee_id AND r.result='PASSED') AS runs_passed,
  (SELECT count(*) FROM factory_virtual_employee_training_runs r
     WHERE r.employee_id=l.employee_id AND r.result='FAILED') AS runs_failed,
  (SELECT count(*) FROM factory_virtual_employee_events e
     WHERE e.employee_id=l.employee_id AND e.event_type='KNOWLEDGE_COLLECTED') AS knowledge_batches,
  (SELECT count(*) FROM factory_virtual_employee_events e
     WHERE e.employee_id=l.employee_id AND e.event_type='KNOWLEDGE_SEARCHED') AS knowledge_reused,
  (SELECT count(*) FROM factory_virtual_employee_tasks t WHERE t.employee_id=l.employee_id) AS tasks_total,
  (SELECT count(*) FROM factory_virtual_employee_tasks t
     WHERE t.employee_id=l.employee_id AND jsonb_exists(t.input, 'evidence')) AS tasks_with_evidence,
  (SELECT count(*) FROM factory_virtual_employee_tasks t
     WHERE t.employee_id=l.employee_id AND t.requires_human) AS gated_tasks,
  (SELECT count(*) FROM factory_virtual_employee_tasks t
     WHERE t.employee_id=l.employee_id AND t.status='REJECTED') AS tasks_rejected,
  (SELECT count(*) FROM factory_virtual_employee_tasks t
     WHERE t.employee_id=l.employee_id AND t.approved_by IS NOT NULL) AS tasks_approved
FROM ve_reporting_lines l WHERE l.enabled`;

function levelSelfLearning(m) {
  if (!m.cases_total) return 0;
  if (!m.cases_approved) return 1;
  const reviewed = m.runs_passed + m.runs_failed;
  if (reviewed && m.runs_passed / reviewed < 0.6) return 2;
  return m.cases_approved >= 3 ? 3 : 2;
}

function levelKnowledge(m) {
  if (!m.knowledge_batches) return 0;
  if (!m.knowledge_reused) return 1;
  return m.knowledge_reused >= 3 ? 3 : 2;
}

function levelJudgment(m) {
  if (!m.tasks_total) return 0;
  if (!m.tasks_with_evidence) return 1;
  const decided = m.tasks_rejected + m.tasks_approved;
  if (decided && m.tasks_rejected / decided > 0.05) return 2;
  return decided >= 10 ? 3 : 2;
}

function levelReasoning(m) {
  if (!m.gated_tasks) return 0;
  if (!m.tasks_approved) return 1;
  return m.tasks_approved >= 10 ? 3 : 2;
}

export function computeLevels(metrics) {
  return {
    SELF_LEARNING: levelSelfLearning(metrics),
    KNOWLEDGE_ACCUMULATION: levelKnowledge(metrics),
    SMART_JUDGMENT: levelJudgment(metrics),
    LOGICAL_REASONING: levelReasoning(metrics),
  };
}

const num = v => Number(v ?? 0);

export async function synthesizeCompetencies({ query, periodStart, periodEnd, dryRun = false }) {
  const rows = (await query(METRICS_SQL)).rows.map(r => ({ ...r,
    cases_total: num(r.cases_total), cases_approved: num(r.cases_approved),
    runs_passed: num(r.runs_passed), runs_failed: num(r.runs_failed),
    knowledge_batches: num(r.knowledge_batches), knowledge_reused: num(r.knowledge_reused),
    tasks_total: num(r.tasks_total), tasks_with_evidence: num(r.tasks_with_evidence),
    gated_tasks: num(r.gated_tasks), tasks_rejected: num(r.tasks_rejected),
    tasks_approved: num(r.tasks_approved) }));

  const out = [];
  for (const m of rows) {
    const levels = computeLevels(m);
    for (const force of FORCES) {
      const row = { employeeId: m.employee_id, force, level: levels[force], metrics: m };
      if (!dryRun) {
        await query(
          `INSERT INTO ve_competency_snapshots
             (employee_id, period_start, period_end, force, level, metric, evidence, assessed_by)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8)
           ON CONFLICT (employee_id, period_start, period_end, force)
           DO UPDATE SET level=EXCLUDED.level, metric=EXCLUDED.metric,
                         evidence=EXCLUDED.evidence, assessed_by=EXCLUDED.assessed_by,
                         assessed_at=NOW()
           -- a human-signed level is authoritative: recomputation must not
           -- silently overwrite an assessment only a person may make.
           WHERE COALESCE(ve_competency_snapshots.metric->>'signed','false') <> 'true'`,
          [m.employee_id, periodStart, periodEnd, force, levels[force],
            JSON.stringify({ computed: true, signed: false }), JSON.stringify(m), "rule:competency-v1"],
        );
      }
      out.push(row);
    }
  }
  return { employees: rows.length, rows: out, dryRun };
}

// Only a named human may sign a competency row; a `ve:` reviewer is refused,
// mirroring the training-case rule.
export async function signCompetency({ query, employeeId, force, reviewer, level, periodStart, periodEnd }) {
  if (!reviewer || String(reviewer).startsWith("ve:")) return { ok: false, code: "VE_CANNOT_SIGN_COMPETENCY" };
  if (!FORCES.includes(force)) return { ok: false, code: "UNKNOWN_FORCE" };
  const updated = await query(
    `UPDATE ve_competency_snapshots
        SET level=$5, assessed_by=$6,
            metric = jsonb_set(metric, '{signed}', 'true'::jsonb, true)
      WHERE employee_id=$1 AND force=$2 AND period_start=$3 AND period_end=$4`,
    [employeeId, force, periodStart, periodEnd, level, reviewer],
  );
  if (!updated.rowCount) return { ok: false, code: "SNAPSHOT_NOT_FOUND" };
  return { ok: true, employeeId, force, level, signedBy: reviewer };
}
