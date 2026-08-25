/**
 * plant-evaluator.js — Self-Evaluation Harness for Ornith Decisions
 * Judge LLM: qwen2.5:7b — rubric-driven automated scoring of Plant AI decisions.
 *
 * Usage:
 *   node plant-evaluator.js score-recent              — score recent unevaluated decisions
 *   node plant-evaluator.js score-all --days N        — score all from last N days
 *   node plant-evaluator.js tune-thresholds           — analyze patterns → propose thresholds
 *   node plant-evaluator.js report --days N           — generate performance report
 */

import { spawn } from "child_process";
import { readFileSync } from "fs";
import { join } from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

const PROJECT_ROOT = process.cwd();
const JUDGE_MODEL  = "qwen2.5:7b";
const OLLAMA_HOST  = "http://localhost:11434";

import { Pool } from "pg";
const pgPool = new Pool({
  host:     process.env.PGHOST     || "127.0.0.1",
  port:     Number(process.env.PGPORT) || 5432,
  database: process.env.PGDATABASE || "smt_factory",
  user:     process.env.PGUSER     || "postgres",
  password: process.env.PGPASSWORD || "postgres",
});

function log(level, msg) {
  const ts = new Date().toISOString().slice(0, 19).replace("T", " ");
  console.log(ts, `[${level}]`, msg);
}

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", args, { cwd: PROJECT_ROOT, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", d => (out += d));
    child.stderr.on("data", d => (err += d));
    child.on("close", code => {
      if (code !== 0) reject(new Error(`${out}\n${err}`));
      else resolve(out);
    });
  });
}

async function llmComplete(model, prompt, options = {}) {
  const res = await fetch(`${OLLAMA_HOST}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      options: {
        temperature: options.temperature ?? 0.01,
        num_predict: options.maxTokens ?? 512,
        ...(options.stop ? { stop: options.stop } : {}),
      },
    }),
  });
  if (!res.ok) throw new Error(`Ollama ${model} error: ${res.status}`);
  const data = await res.json();
  return data.response || "";
}

const RUBRIC = {
  plant_patrol: {
    criteria: [
      { name: "all_managers_queried",   weight: 0.25, desc: "Were all 6 sub-managers (MES/WMS/BOM/PMC/HR/RDA) properly queried?" },
      { name: "kpi_aggregation_correct",weight: 0.25, desc: "Were KPIs correctly aggregated from all domain data?" },
      { name: "cross_domain_detected",  weight: 0.20, desc: "Were cross-domain issues correctly identified?" },
      { name: "escalation_appropriate",weight: 0.15, desc: "Were escalations correctly routed (none missing, none false)?" },
      { name: "report_quality",         weight: 0.15, desc: "Was the patrol digest informative and actionable?" },
    ],
    scale: 5,
  },
  morning_brief: {
    criteria: [
      { name: "completeness",          weight: 0.25, desc: "Did the brief cover all critical areas (WMS inventory, MES yield, PMC schedule, HR attendance)?" },
      { name: "key_issues_highlighted",weight:0.25, desc: "Were the top 3 factory risks clearly highlighted?" },
      { name: "action_items_clear",    weight: 0.20, desc: "Were owner and deadline assigned to each action item?" },
      { name: "timeliness",             weight: 0.15, desc: "Was the brief delivered before shift start?" },
    ],
    scale: 5,
  },
  evening_report: {
    criteria: [
      { name: "daily_targets_met",    weight: 0.25, desc: "Were production targets (output, quality, delivery) correctly reported?" },
      { name: "deviations_noted",      weight: 0.25, desc: "Were deviations from plan clearly noted with root cause?" },
      { name: "next_day_preview",     weight: 0.20, desc: "Was the next-day plan preview accurate and ready?" },
    ],
    scale: 5,
  },
  kpi_snapshot: {
    criteria: [
      { name: "kpi_accuracy",          weight: 0.30, desc: "Were live KPIs accurate (matching sub-manager data)?" },
      { name: "completeness",          weight: 0.25, desc: "Were all KPI categories (OEE, inventory, workforce, quality) included?" },
      { name: "freshness",             weight: 0.25, desc: "Was the data fresh (within last patrol cycle)?" },
    ],
    scale: 5,
  },
  escalation_resolve: {
    criteria: [
      { name: "escalation_valid",       weight: 0.30, desc: "Was the escalation genuinely needed or was it a false positive?" },
      { name: "resolution_appropriate",weight: 0.30, desc: "Was the resolution action appropriate for the issue severity?" },
      { name: "stakeholder_notified",  weight: 0.20, desc: "Were relevant stakeholders notified of the resolution?" },
    ],
    scale: 5,
  },
  inter_manager_sync: {
    criteria: [
      { name: "sync_needed",           weight: 0.30, desc: "Was inter-manager sync actually needed at this time?" },
      { name: "correct_managers",     weight: 0.25, desc: "Were the correct managers included in the sync?" },
      { name: "sync_effective",       weight: 0.25, desc: "Did the sync actually resolve the cross-manager issue?" },
    ],
    scale: 5,
  },
};

async function evaluateDecision(decisionType, ornithSummary, dbContext) {
  const rubric = RUBRIC[decisionType] || RUBRIC.plant_patrol;
  const criteriaList = rubric.criteria.map(c =>
    `  - ${c.name} (weight=${c.weight}): ${c.desc}`
  ).join("\n");

  const prompt = `You are a quality assurance evaluator for the Plant AI Manager (factory orchestrator) in a Vietnam SMT factory.
Evaluate this AI decision for quality. Score each criterion 1-${rubric.scale} where:
  1 = very poor / missing / wrong
  ${rubric.scale} = excellent / fully correct

Decision type: ${decisionType.toUpperCase()}
Ornith's recommendation:
${JSON.stringify(ornithSummary, null, 2)}

System context:
${JSON.stringify(dbContext, null, 2)}

Evaluation criteria:
${criteriaList}

Respond ONLY with this JSON (no other text):
{
  "scores": {
    "criterion_name": <score 1-${rubric.scale}>,
    ...
  },
  "overall_score": <weighted average 0.0-1.0>,
  "verdict": "correct|partial|incorrect",
  "reasoning": "2-3 sentence explanation of overall quality"
}`;

  try {
    const raw = await llmComplete(JUDGE_MODEL, prompt, { temperature: 0.01, maxTokens: 600 });
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    return JSON.parse(match[0]);
  } catch (err) {
    log("WARN", `evaluateDecision LLM call failed: ${err.message}`);
    return null;
  }
}

async function scoreRecentUnevaluated(limit = 20) {
  const rows = await pgPool.query(`
    SELECT id, decision_type,
           ornith_summary, input_data, output_decision,
           auto_execute, feedback, created_at
    FROM plant_manager_audit
    WHERE feedback IS NULL
      AND ornith_summary IS NOT NULL
      AND output_decision IS NOT NULL
    ORDER BY created_at DESC
    LIMIT $1
  `, [limit]);

  log("INFO", `Found ${rows.rows.length} unevaluated decisions`);

  const results = [];
  for (const row of rows.rows) {
    const ctx = {
      auto_execute: row.auto_execute,
      decision_type: row.decision_type,
    };

    let evaluation = null;
    try {
      const rawOrnith = typeof row.ornith_summary === 'string'
        ? JSON.parse(row.ornith_summary)
        : row.ornith_summary;
      evaluation = await evaluateDecision(row.decision_type, rawOrnith, ctx);
    } catch (err) {
      log("WARN", `Evaluation error for id=${row.id}: ${err.message}`);
    }

    if (evaluation) {
      const verdict = evaluation.verdict || "unknown";
      const score = evaluation.overall_score ?? null;
      await pgPool.query(`
        UPDATE plant_manager_audit
        SET feedback = $1, feedback_at = now()
        WHERE id = $2
      `, [verdict, row.id]);
      await pgPool.query(`
        UPDATE plant_manager_audit
        SET output_decision = output_decision || $1::jsonb
        WHERE id = $2
      `, [JSON.stringify({ evaluator_score: score, evaluator_verdict: verdict }), row.id]);
      log("INFO", `  Evaluated id=${row.id} (${row.decision_type}): ${verdict} score=${score?.toFixed(2)}`);
      results.push({ id: row.id, decision_type: row.decision_type, verdict, score, details: evaluation });
    }
  }
  return results;
}

async function tuneThresholds() {
  log("INFO", "Analyzing Plant decision patterns to propose threshold updates...");
  const recent = await pgPool.query(`
    SELECT
      decision_type,
      COUNT(*) as total,
      SUM(CASE WHEN feedback = 'correct' THEN 1 ELSE 0 END)::int as correct,
      SUM(CASE WHEN feedback = 'incorrect' THEN 1 ELSE 0 END)::int as incorrect,
      SUM(CASE WHEN auto_execute = true THEN 1 ELSE 0 END)::int as auto_total,
      SUM(CASE WHEN auto_execute = true AND feedback = 'correct' THEN 1 ELSE 0 END)::int as auto_correct
    FROM plant_manager_audit
    WHERE created_at >= now() - INTERVAL '30 days'
      AND feedback IS NOT NULL
    GROUP BY decision_type
  `);

  const suggestions = [];
  for (const row of recent.rows) {
    const total = Number(row.total);
    if (total < 3) continue;
    const autoAccuracy = row.auto_total > 0 ? row.auto_correct / row.auto_total : null;
    if (autoAccuracy !== null && autoAccuracy < 0.70 && row.auto_total >= 2) {
      suggestions.push({
        type: "AUTO_TO_MANUAL",
        decision_type: row.decision_type,
        reason: `Auto accuracy ${(autoAccuracy*100).toFixed(0)}% < 70% — recommend switching to manual`,
        affected_count: row.auto_total,
      });
    }
    if (Number(row.incorrect) >= 2) {
      suggestions.push({
        type: "HUMAN_REVIEW",
        decision_type: row.decision_type,
        reason: `${row.incorrect} incorrect decisions in 30 days — human review recommended`,
        affected_count: Number(row.incorrect),
      });
    }
  }
  log("INFO", `Generated ${suggestions.length} tuning suggestions`);
  return suggestions;
}

async function generateReport(days = 7) {
  const data = await pgPool.query(`
    SELECT
      decision_type,
      COUNT(*)::int as total,
      SUM(CASE WHEN feedback = 'correct' THEN 1 ELSE 0 END)::int as correct,
      SUM(CASE WHEN feedback = 'incorrect' THEN 1 ELSE 0 END)::int as incorrect,
      SUM(CASE WHEN feedback = 'partial' THEN 1 ELSE 0 END)::int as partial,
      SUM(CASE WHEN feedback IS NOT NULL THEN 1 ELSE 0 END)::int as rated,
      ROUND(AVG(CASE WHEN output_decision->>'evaluator_score' IS NOT NULL
                     THEN (output_decision->>'evaluator_score')::numeric ELSE NULL END)::numeric, 3)::float
               as avg_evaluator_score
    FROM plant_manager_audit
    WHERE created_at >= now() - (INTERVAL '1 day' * $1)
    GROUP BY decision_type
    ORDER BY total DESC
  `, [days]);

  const overall = await pgPool.query(`
    SELECT
      COUNT(*)::int as total_decisions,
      SUM(CASE WHEN feedback = 'correct' THEN 1 ELSE 0 END)::int as correct,
      SUM(CASE WHEN feedback = 'incorrect' THEN 1 ELSE 0 END)::int as incorrect,
      SUM(CASE WHEN feedback IS NOT NULL THEN 1 ELSE 0 END)::int as rated
    FROM plant_manager_audit
    WHERE created_at >= now() - (INTERVAL '1 day' * $1)
  `, [days]);

  return {
    period_days: days,
    generated_at: new Date().toISOString(),
    overall: overall.rows[0],
    by_type: data.rows.map(r => ({
      ...r,
      accuracy: r.rated > 0 ? Math.round(100 * r.correct / r.rated) : null,
    })),
  };
}

const [cmd, ...args] = process.argv.slice(2);
const getArg = (name, fallback = "") => {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 ? args[idx + 1] ?? fallback : fallback;
};

async function main() {
  switch (cmd) {
    case "score-recent": {
      const limit = Number(getArg("limit", "20"));
      await pgPool.query(`SELECT 1`);
      const results = await scoreRecentUnevaluated(limit);
      console.log(JSON.stringify(results, null, 2));
      break;
    }
    case "score-all": {
      await pgPool.query(`SELECT 1`);
      const results = await scoreRecentUnevaluated(999);
      console.log(JSON.stringify({ scored: results.length }, null, 2));
      break;
    }
    case "tune-thresholds": {
      await pgPool.query(`SELECT 1`);
      console.log(JSON.stringify(await tuneThresholds(), null, 2));
      break;
    }
    case "report": {
      const days = Number(getArg("days", "7"));
      await pgPool.query(`SELECT 1`);
      console.log(JSON.stringify(await generateReport(days), null, 2));
      break;
    }
    default:
      console.log(`Plant Evaluator Usage:
  node plant-evaluator.js score-recent [--limit N]
  node plant-evaluator.js score-all --days N
  node plant-evaluator.js tune-thresholds
  node plant-evaluator.js report --days N`);
  }
  await pgPool.end();
}

main().catch(async (err) => {
  console.error(err.message);
  await pgPool.end().catch(() => {});
  process.exit(1);
});
