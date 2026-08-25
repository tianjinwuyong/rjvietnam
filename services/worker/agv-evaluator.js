/**
 * agv-evaluator.js — Self-Evaluation Harness for AGV Dispatch Decisions
 *
 * Judge LLM: qwen2.5:7b — rubric-driven scoring of AGV AI dispatch decisions.
 *
 * Usage:
 *   node agv-evaluator.js score-recent              — score recent unevaluated decisions
 *   node agv-evaluator.js score-all --days N        — score all from last N days
 *   node agv-evaluator.js tune-thresholds          — analyze patterns → propose thresholds
 *   node agv-evaluator.js report --days N          — generate performance report
 */

import { spawn } from "child_process";
import pg from "pg";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

const PROJECT_ROOT = process.cwd();
const JUDGE_MODEL  = "qwen2.5:7b";
const OLLAMA_HOST  = "http://localhost:11434";

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

// ── Ollama LLM ────────────────────────────────────────────────────
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
      },
    }),
  });
  if (!res.ok) throw new Error(`Ollama ${model} error: ${res.status}`);
  const data = await res.json();
  return data.response || "";
}

// ── Rubric ────────────────────────────────────────────────────────
function buildJudgeRubric(decisionType, inputData, outputData) {
  return `You are a quality auditor for an AGV AI dispatch system in an SMT factory.
Score the following decision as "correct" or "incorrect" based on the rubric.

Decision Type: ${decisionType}
Input: ${JSON.stringify(inputData)}
Decision: ${JSON.stringify(outputData)}

Rubric:
- task_assign: Correct if AGV has sufficient battery and correct type for the load. Incorrect if AGV is low battery or wrong type.
- task_cancel: Correct if task was genuinely invalid, duplicate, or no longer needed. Incorrect if task was still valid.
- route_charging: Correct if AGV battery is genuinely below threshold. Incorrect if battery was sufficient.
- zone_block: Correct if zone had genuine obstruction or maintenance need. Incorrect if false alarm.
- priority_order: Correct if highest priority task was dispatched first. Incorrect if a more urgent task was skipped.

Respond with ONLY: "correct" or "incorrect"`;
}

// ── Score recent ─────────────────────────────────────────────────
async function scoreRecent(limit = 5) {
  log("INFO", `Scoring up to ${limit} recent unevaluated AGV decisions...`);

  const rows = await pgPool.query(
    `SELECT id, decision_type, input_data, output_decision
     FROM mes_manager_audit_log
     WHERE agent = 'agv-ai' AND feedback IS NULL
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit]
  );

  if (!rows.rows.length) {
    log("INFO", "No unevaluated AGV decisions found");
    return { scored: 0 };
  }

  let correct = 0, incorrect = 0;

  for (const row of rows.rows) {
    const prompt = buildJudgeRubric(row.decision_type, row.input_data, row.output_decision);
    let verdict;
    try {
      verdict = await llmComplete(JUDGE_MODEL, prompt);
      verdict = verdict.trim().toLowerCase();
    } catch (err) {
      log("WARN", `Judge LLM error for decision ${row.id}: ${err.message}`);
      continue;
    }

    const feed = verdict.includes("correct") ? "correct" : "incorrect";
    await pgPool.query(
      "UPDATE mes_manager_audit_log SET feedback = $1 WHERE id = $2",
      [feed, row.id]
    );

    if (feed === "correct") correct++;
    else incorrect++;

    log("INFO", `Decision #${row.id} (${row.decision_type}): ${feed}`);
  }

  log("INFO", `Scored ${rows.rows.length} decisions (${correct} correct, ${incorrect} incorrect)`);
  return { scored: rows.rows.length, correct, incorrect };
}

// ── Score all ────────────────────────────────────────────────────
async function scoreAll(days = 7) {
  const rows = await pgPool.query(
    `SELECT id, decision_type, input_data, output_decision
     FROM mes_manager_audit_log
     WHERE agent = 'agv-ai' AND feedback IS NULL
       AND created_at >= NOW() - INTERVAL '1 day' * $1
     ORDER BY created_at DESC`,
    [days]
  );

  let correct = 0, incorrect = 0;
  for (const row of rows.rows) {
    const prompt = buildJudgeRubric(row.decision_type, row.input_data, row.output_decision);
    let verdict;
    try {
      verdict = await llmComplete(JUDGE_MODEL, prompt);
      verdict = verdict.trim().toLowerCase();
    } catch (_) { continue; }

    const feed = verdict.includes("correct") ? "correct" : "incorrect";
    await pgPool.query("UPDATE mes_manager_audit_log SET feedback = $1 WHERE id = $2", [feed, row.id]);
    if (feed === "correct") correct++;
    else incorrect++;
  }

  return { scored: rows.rows.length, correct, incorrect };
}

// ── Threshold tuning ────────────────────────────────────────────
async function tuneThresholds() {
  log("INFO", "Analyzing AGV dispatch decision patterns...");

  const stats = await pgPool.query(`
    SELECT decision_type,
           COUNT(*) AS total,
           COUNT(*) FILTER (WHERE feedback = 'correct') AS correct,
           COUNT(*) FILTER (WHERE feedback = 'incorrect') AS incorrect
    FROM mes_manager_audit_log
    WHERE agent = 'agv-ai' AND feedback IS NOT NULL
    GROUP BY decision_type
    ORDER BY decision_type
  `);

  const suggestions = [];
  for (const row of stats.rows) {
    const total = Number(row.total);
    if (total < 5) continue;
    const errorRate = Number(row.incorrect) / total;
    if (errorRate > 0.3) {
      suggestions.push({
        decisionType: row.decision_type,
        accuracy: `${((1 - errorRate) * 100).toFixed(1)}%`,
        errorRate: `${(errorRate * 100).toFixed(1)}%`,
        samples: total,
        suggestion: "Review dispatch logic for this decision type or add human confirmation step.",
      });
    }
  }

  return {
    timestamp: new Date().toISOString(),
    totalDecisions: stats.rows.reduce((s, r) => s + Number(r.total), 0),
    byType: stats.rows.map(r => ({
      type: r.decision_type,
      accuracy: `${(Number(r.correct) / Math.max(Number(r.total), 1) * 100).toFixed(1)}%`,
      samples: Number(r.total),
    })),
    suggestions,
  };
}

// ── Report ───────────────────────────────────────────────────────
async function generateReport(days = 7) {
  log("INFO", `Generating AGV performance report for last ${days} days...`);

  const stats = await pgPool.query(`
    SELECT decision_type,
           COUNT(*) AS total,
           COUNT(*) FILTER (WHERE feedback = 'correct') AS correct,
           COUNT(*) FILTER (WHERE feedback = 'incorrect') AS incorrect,
           COUNT(*) FILTER (WHERE feedback IS NULL) AS unevaluated
    FROM mes_manager_audit_log
    WHERE agent = 'agv-ai' AND created_at >= NOW() - INTERVAL '1 day' * $1
    GROUP BY decision_type
    ORDER BY decision_type`,
    [days]
  );

  const overall = await pgPool.query(`
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE feedback = 'correct') AS correct,
      COUNT(*) FILTER (WHERE feedback = 'incorrect') AS incorrect
    FROM mes_manager_audit_log
    WHERE agent = 'agv-ai' AND created_at >= NOW() - INTERVAL '1 day' * $1`,
    [days]
  );

  const total    = Number(overall.rows[0]?.total ?? 0);
  const correct  = Number(overall.rows[0]?.correct ?? 0);
  const evaluated = correct + Number(overall.rows[0]?.incorrect ?? 0);
  const accuracy = evaluated > 0 ? (correct / evaluated * 100).toFixed(1) : "N/A";

  return {
    timestamp: new Date().toISOString(),
    period: `${days} days`,
    overall: { total, evaluated, accuracy: `${accuracy}%` },
    byType: stats.rows.map(r => {
      const ev = Number(r.correct) + Number(r.incorrect);
      return {
        type: r.decision_type,
        total: Number(r.total),
        accuracy: ev > 0 ? `${(Number(r.correct) / ev * 100).toFixed(1)}%` : "N/A",
        evaluated: ev,
        unevaluated: Number(r.unevaluated),
      };
    }),
    thresholdMet: evaluated > 0 && (correct / evaluated) >= 0.7,
  };
}

// ── CLI ───────────────────────────────────────────────────────────
async function main() {
  const command = process.argv[2];
  const opts = {};
  for (let i = 3; i < process.argv.length; i++) {
    if (process.argv[i].startsWith("--")) {
      const key = process.argv[i].slice(2);
      opts[key] = process.argv[i + 1] ?? true;
      if (opts[key] !== true) i++;
    }
  }

  try {
    let result;
    switch (command) {
      case "score-recent":
        result = await scoreRecent(parseInt(opts.limit) || 5);
        break;
      case "score-all":
        result = await scoreAll(parseInt(opts.days) || 7);
        break;
      case "tune-thresholds":
        result = await tuneThresholds();
        break;
      case "report":
        result = await generateReport(parseInt(opts.days) || 7);
        break;
      default:
        console.error("Usage: node agv-evaluator.js [score-recent|score-all|tune-thresholds|report]");
        process.exit(1);
    }

    console.log(JSON.stringify(result, null, 2));
    await pgPool.end();
  } catch (err) {
    console.error(JSON.stringify({ error: err.message }));
    await pgPool.end();
    process.exit(1);
  }
}

main();
