/**
 * wms-evaluator.js — Self-Evaluation Harness for Ornith Decisions
 *
 * Based on research:
 *  - "Self-Refine" (Madaan et al. 2024): iterative self-feedback loop
 *  - "LLM-as-Judge" (OpenAI Cookbook 2025): rubric-driven automated scoring
 *  - "SICA" (Hu et al. 2025): self-improving coding agent — applied to skill tuning
 *  - "METACOGNITIVE LEARNING" (Liu et al. 2025): 3 components applied here:
 *      metacognitive KNOWLEDGE  → what we track in the audit log
 *      metacognitive PLANNING   → skill threshold tuning from outcomes
 *      metacognitive EVALUATION → evaluator LLM scoring decisions
 *
 * Usage:
 *   node wms-evaluator.js score-recent        — score recent unevaluated decisions
 *   node wms-evaluator.js score-all --days N — score all decisions from last N days
 *   node wms-evaluator.js tune-thresholds    — analyze patterns → propose threshold updates
 *   node wms-evaluator.js report --days N    — generate performance report
 */

import { spawn } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

const PROJECT_ROOT = process.cwd();
const EXEC_SCRIPT  = join(PROJECT_ROOT, "services/worker/wms-execute.js");
const JUDGE_MODEL  = "qwen2.5:7b";           // Second LLM for evaluation (separate from Ornith)
const OLLAMA_HOST  = "http://localhost:11434";

// ── DB ─────────────────────────────────────────────────────────────────
import { Pool } from "pg";
const pgPool = new Pool({
  host:     process.env.PGHOST     || "127.0.0.1",
  port:     Number(process.env.PGPORT) || 5432,
  database: process.env.PGDATABASE || "smt_factory",
  user:     process.env.PGUSER     || "postgres",
  password: process.env.PGPASSWORD || "postgres",
});

// ── Logging ──────────────────────────────────────────────────────────────
function log(level, msg) {
  const ts = new Date().toISOString().slice(0, 19).replace("T", " ");
  console.log(`${ts} [${level}] ${msg}`);
}

// ── Run external script ───────────────────────────────────────────────
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

// ── Ollama LLM call ─────────────────────────────────────────────────────
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

// ── Decision Quality Rubric ────────────────────────────────────────────
// Each decision type has specific criteria scored 0–1, weighted for final score
const RUBRIC = {
  iqc: {
    criteria: [
      { name: "factual_correctness", weight: 0.30, desc: "Does the action match the supplier's actual defect history and lot data?" },
      { name: "reasoning_quality",  weight: 0.25, desc: "Is the reason specific to this lot, not generic?" },
      { name: "urgency_appropriate",weight: 0.20, desc: "Is the urgency (immediate/24h/this_week) calibrated to actual risk?" },
      { name: "auto_vs_manual",     weight: 0.15, desc: "Is auto_execute correctly set based on risk level?" },
      { name: "completeness",        weight: 0.10, desc: "Are all required fields (lot_no, action, reason) present?" },
    ],
    scale: 5,  // 1–5 scoring
  },
  issue_to_line: {
    criteria: [
      { name: "fifo_correct",         weight: 0.30, desc: "Did it select the FIFO lot (earliest received_at) for the work order? Compare lot_no against fifo_candidate_lot in system context." },
      { name: "preflight_checks",   weight: 0.20, desc: "Did it verify IQC status, MSD, quantity, location before issuing?" },
      { name: "material_availability",weight:0.15, desc: "Was the available quantity sufficient for the work order?" },
      { name: "wo_status_correct",  weight: 0.15, desc: "Was the work order confirmed as released?" },
      { name: "qty_accuracy",        weight: 0.10, desc: "Was the issue quantity correct (not over/under)?" },
      { name: "completeness",        weight: 0.10, desc: "Are all required fields (lot_no, qty, work_order_code) present?" },
    ],
    scale: 5,
  },
  pick: {
    criteria: [
      { name: "fifo_correct",       weight: 0.30, desc: "Was the earliest lot (FIFO) selected? Compare lot_no against fifo_candidate_lot in system context." },
      { name: "qty_sufficient",      weight: 0.25, desc: "Was the picked quantity sufficient for the BOM requirement?" },
      { name: "location_valid",      weight: 0.20, desc: "Was the storage location confirmed as valid and accessible?" },
      { name: "shortage_flagged",    weight: 0.15, desc: "Were any shortages correctly identified and flagged?" },
    ],
    scale: 5,
  },
  put_away: {
    criteria: [
      { name: "zone_correct",       weight: 0.30, desc: "Was the material placed in the correct zone (MSD/RAW/GOOD)?" },
      { name: "location_capacity",   weight: 0.25, desc: "Was the location capacity checked before assignment?" },
      { name: "msd_preserved",       weight: 0.20, desc: "Was MSD status correctly preserved during put-away?" },
    ],
    scale: 5,
  },
  return_to_line: {
    criteria: [
      { name: "condition_assessed",  weight: 0.30, desc: "Was the returned material condition properly assessed?" },
      { name: "disposition_correct",weight: 0.30, desc: "Was the correct disposition chosen (return-to-stock/scrapped)?" },
      { name: "msd_preserved",      weight: 0.20, desc: "Was MSD exposure correctly reset or preserved?" },
    ],
    scale: 5,
  },
  scrap: {
    criteria: [
      { name: "reason_justified",   weight: 0.30, desc: "Was the scrap reason code appropriate for the defect?" },
      { name: "qty_correct",        weight: 0.25, desc: "Was only the defective quantity scrapped, not excess?" },
      { name: "ncr_created",         weight: 0.20, desc: "Was an NCR record created for IQC-rejected lots?" },
      { name: "line_alert_sent",     weight: 0.15, desc: "Was LINE alert sent for the scrap event?" },
    ],
    scale: 5,
  },
  msd: {
    criteria: [
      { name: "exposure_calculation",weight:0.30, desc: "Was the exposed hours calculation accurate?" },
      { name: "limit_correct",       weight: 0.25, desc: "Was the correct MSD level limit used for comparison?" },
      { name: "action_appropriate",  weight: 0.25, desc: "Was BAKE/BLOCK/RELEASE correctly determined?" },
      { name: "baking_params",       weight: 0.20, desc: "Were baking duration and temperature parameters correct for the material?" },
    ],
    scale: 5,
  },
};

// ── Evaluate a single decision using LLM-as-Judge ───────────────────────
async function evaluateDecision(decisionType, ormithSummary, dbContext) {
  const rubric = RUBRIC[decisionType] || RUBRIC.iqc;
  const criteriaList = rubric.criteria.map(c =>
    `  - ${c.name} (weight=${c.weight}): ${c.desc}`
  ).join("\n");

  const prompt = `You are a quality assurance evaluator for a WMS AI Manager in an SMT factory.

Evaluate this AI decision for quality. Score each criterion 1–${rubric.scale} where:
  1 = very poor / missing / wrong
  ${rubric.scale} = excellent / fully correct

Decision type: ${decisionType.toUpperCase()}
Ornith's recommendation:
${JSON.stringify(ormithSummary, null, 2)}

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
    // Parse JSON
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const result = JSON.parse(match[0]);
    return result;
  } catch (err) {
    log("WARN", `evaluateDecision LLM call failed: ${err.message}`);
    return null;
  }
}

// ── Evaluate recent unevaluated decisions ────────────────────────────────
async function scoreRecentUnevaluated(limit = 20) {
  const rows = await pgPool.query(`
    SELECT id, decision_type, lot_no, work_order_code, area,
           ornith_summary, input_data, output_decision,
           auto_execute, feedback, created_at
    FROM wms_manager_audit
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
      lot_no: row.lot_no,
      work_order_code: row.work_order_code,
      area: row.area,
      auto_execute: row.auto_execute,
      decision_type: row.decision_type,
    };

    // Inject real FIFO candidate for issue_to_line and pick decisions
    if ((row.decision_type === "issue_to_line" || row.decision_type === "pick") && row.work_order_code) {
      try {
        const fifoCandidate = await pgPool.query(`
          SELECT ml.lot_no, ml.received_at::text
          FROM material_lots ml
          JOIN materials m ON m.id = ml.material_id
          JOIN work_orders wo ON wo.product_id = m.id
          WHERE wo.code = $1 AND ml.iqc_status = 'released'
          ORDER BY ml.received_at ASC LIMIT 1
        `, [row.work_order_code]);
        if (fifoCandidate.rows.length > 0) {
          ctx.fifo_candidate_lot = fifoCandidate.rows[0].lot_no;
          ctx.fifo_candidate_received_at = fifoCandidate.rows[0].received_at;
        }
      } catch (_) {}
    }

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
        UPDATE wms_manager_audit
        SET feedback = $1, feedback_at = now()
        WHERE id = $2
      `, [verdict, row.id]);

      await pgPool.query(`
        UPDATE wms_manager_audit
        SET output_decision = output_decision || $1::jsonb
        WHERE id = $2
      `, [JSON.stringify({ evaluator_score: score, evaluator_verdict: verdict }), row.id]);

      log("INFO", `  Evaluated id=${row.id} (${row.decision_type}): ${verdict} score=${score?.toFixed(2)}`);
      results.push({ id: row.id, decision_type: row.decision_type, verdict, score, details: evaluation });
    }
  }
  return results;
}

// ── Tune skill thresholds based on accumulated feedback ──────────────────
async function tuneThresholds() {
  log("INFO", "Analyzing decision patterns to propose threshold updates...");

  const recent = await pgPool.query(`
    SELECT
      decision_type,
      COUNT(*) as total,
      SUM(CASE WHEN feedback = 'correct' THEN 1 ELSE 0 END)::int as correct,
      SUM(CASE WHEN feedback = 'incorrect' THEN 1 ELSE 0 END)::int as incorrect,
      SUM(CASE WHEN feedback = 'partial' THEN 1 ELSE 0 END)::int as partial,
      SUM(CASE WHEN auto_execute = true THEN 1 ELSE 0 END)::int as auto_total,
      SUM(CASE WHEN auto_execute = true AND feedback = 'correct' THEN 1 ELSE 0 END)::int as auto_correct,
      SUM(CASE WHEN auto_execute = false THEN 1 ELSE 0 END)::int as manual_total
    FROM wms_manager_audit
    WHERE created_at >= now() - INTERVAL '30 days'
      AND feedback IS NOT NULL
    GROUP BY decision_type
  `);

  const suggestions = [];

  for (const row of recent.rows) {
    const total = Number(row.total);
    if (total < 3) continue;  // need minimum sample size

    const accuracy = row.correct / total;
    const autoRate = row.auto_total > 0 ? row.auto_correct / row.auto_total : 0;
    const autoAccuracy = row.auto_total > 0 ? row.auto_correct / row.auto_total : null;

    // Rule: if auto accuracy < 70%, recommend switching those to manual
    if (autoAccuracy !== null && autoAccuracy < 0.70 && row.auto_total >= 2) {
      suggestions.push({
        type: "AUTO_TO_MANUAL",
        decision_type: row.decision_type,
        reason: `Auto accuracy ${(autoAccuracy*100).toFixed(0)}% < 70% threshold — recommend switching to manual`,
        affected_count: row.auto_total,
        current_auto_rate: `${row.auto_correct}/${row.auto_total}`,
      });
    }

    // Rule: if overall accuracy < 60%, flag for prompt review
    if (accuracy < 0.60) {
      suggestions.push({
        type: "PROMPT_REVIEW",
        decision_type: row.decision_type,
        reason: `Overall accuracy ${(accuracy*100).toFixed(0)}% < 60% — Ornith prompt may need adjustment`,
        affected_count: total,
      });
    }

    // Rule: if incorrect decisions cluster in a specific reason pattern
    // (would need deeper NLP analysis — flag for human review)
    if (row.incorrect >= 2) {
      suggestions.push({
        type: "HUMAN_REVIEW",
        decision_type: row.decision_type,
        reason: `${row.incorrect} incorrect decisions in 30 days — human review recommended`,
        affected_count: row.incorrect,
      });
    }
  }

  log("INFO", `Generated ${suggestions.length} tuning suggestions`);
  for (const s of suggestions) {
    log("INFO", `  [${s.type}] ${s.decision_type}: ${s.reason}`);
  }

  return suggestions;
}

// ── Generate performance report ──────────────────────────────────────────
async function generateReport(days = 7) {
  const data = await pgPool.query(`
    SELECT
      decision_type,
      COUNT(*)::int as total,
      SUM(CASE WHEN executed = true THEN 1 ELSE 0 END)::int as executed,
      SUM(CASE WHEN auto_execute = true THEN 1 ELSE 0 END)::int as auto_decisions,
      SUM(CASE WHEN auto_execute = false THEN 1 ELSE 0 END)::int as manual_decisions,
      SUM(CASE WHEN feedback = 'correct' THEN 1 ELSE 0 END)::int as correct,
      SUM(CASE WHEN feedback = 'incorrect' THEN 1 ELSE 0 END)::int as incorrect,
      SUM(CASE WHEN feedback = 'partial' THEN 1 ELSE 0 END)::int as partial,
      SUM(CASE WHEN feedback IS NOT NULL THEN 1 ELSE 0 END)::int as rated,
      SUM(CASE WHEN executed = false AND auto_execute = true THEN 1 ELSE 0 END)::int as auto_pending,
      SUM(CASE WHEN executed = true AND override_by IS NOT NULL THEN 1 ELSE 0 END)::int as overridden,
      ROUND(AVG(CASE WHEN output_decision->>'evaluator_score' IS NOT NULL
                     THEN (output_decision->>'evaluator_score')::numeric ELSE NULL END)::numeric, 3)::float
               as avg_evaluator_score
    FROM wms_manager_audit
    WHERE created_at >= now() - (INTERVAL '1 day' * $1)
    GROUP BY decision_type
    ORDER BY total DESC
  `, [days]);

  const overall = await pgPool.query(`
    SELECT
      COUNT(*)::int as total_decisions,
      SUM(CASE WHEN auto_execute = true THEN 1 ELSE 0 END)::int as auto_decisions,
      SUM(CASE WHEN feedback = 'correct' THEN 1 ELSE 0 END)::int as correct,
      SUM(CASE WHEN feedback = 'incorrect' THEN 1 ELSE 0 END)::int as incorrect,
      SUM(CASE WHEN feedback = 'partial' THEN 1 ELSE 0 END)::int as partial,
      SUM(CASE WHEN feedback IS NOT NULL THEN 1 ELSE 0 END)::int as rated,
      ROUND(AVG(CASE WHEN output_decision->>'evaluator_score' IS NOT NULL
                     THEN (output_decision->>'evaluator_score')::numeric ELSE NULL END)::numeric, 3)::float
               as avg_evaluator_score
    FROM wms_manager_audit
    WHERE created_at >= now() - (INTERVAL '1 day' * $1)
  `, [days]);

  const report = {
    period_days: days,
    generated_at: new Date().toISOString(),
    overall: overall.rows[0],
    by_type: data.rows.map(r => ({
      ...r,
      accuracy: r.rated > 0 ? Math.round(100 * r.correct / r.rated) : null,
    })),
  };

  return report;
}

// ── Skill Parameter Tuning ──────────────────────────────────────────────
// Based on accumulated outcomes, adjust decision thresholds in virtualagentskills.md
async function applyThresholdTuning() {
  const suggestions = await tuneThresholds();
  if (suggestions.length === 0) {
    log("INFO", "No threshold tuning needed — accuracy within targets");
    return suggestions;
  }

  // For now: log suggestions and optionally write to a tuning report file
  // Future: could auto-update the skill markdown file
  const reportFile = join(PROJECT_ROOT, "services/worker/skill-tuning-report.json");
  const { writeFileSync } = require("fs");
  writeFileSync(reportFile, JSON.stringify({ suggestions, generated_at: new Date().toISOString() }, null, 2));
  log("INFO", `Tuning report written to ${reportFile}`);
  return suggestions;
}

// ── Main CLI ────────────────────────────────────────────────────────────
const [cmd, ...args] = process.argv.slice(2);

const getArg = (name, fallback = "") => {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 ? args[idx + 1] ?? fallback : fallback;
};

async function main() {
  switch (cmd) {
    case "score-recent": {
      const limit = Number(getArg("limit", "20"));
      await pgPool.query(`SELECT 1`); // test connection
      const results = await scoreRecentUnevaluated(limit);
      console.log(JSON.stringify(results, null, 2));
      break;
    }
    case "score-all": {
      const days = Number(getArg("days", "7"));
      await pgPool.query(`SELECT 1`);
      const results = await scoreRecentUnevaluated(999);
      console.log(JSON.stringify({ scored: results.length, days }, null, 2));
      break;
    }
    case "tune-thresholds": {
      await pgPool.query(`SELECT 1`);
      const suggestions = await applyThresholdTuning();
      console.log(JSON.stringify(suggestions, null, 2));
      break;
    }
    case "report": {
      const days = Number(getArg("days", "7"));
      await pgPool.query(`SELECT 1`);
      const report = await generateReport(days);
      console.log(JSON.stringify(report, null, 2));
      break;
    }
    default: {
      console.log(`WMS Evaluator — Self-Evaluation Harness
Usage: node wms-evaluator.js <command>

Commands:
  score-recent [--limit N]   Score recent unevaluated decisions (default: 20)
  score-all --days N         Score all unevaluated decisions from last N days
  tune-thresholds            Analyze patterns → propose skill threshold updates
  report --days N            Generate performance report for last N days
`);
    }
  }
  await pgPool.end();
}

main().catch(async (err) => {
  console.error(err.message);
  await pgPool.end().catch(() => {});
  process.exit(1);
});
