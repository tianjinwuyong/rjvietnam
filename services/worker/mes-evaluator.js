/**
 * mes-evaluator.js — Self-Evaluation Harness for Ornith Decisions
 *
 * Judge LLM: qwen2.5:7b — rubric-driven automated scoring of MES AI decisions.
 *
 * Usage:
 *   node mes-evaluator.js score-recent              — score recent unevaluated decisions
 *   node mes-evaluator.js score-all --days N        — score all from last N days
 *   node mes-evaluator.js tune-thresholds           — analyze patterns → propose thresholds
 *   node mes-evaluator.js report --days N           — generate performance report
 */

import { spawn } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

const PROJECT_ROOT = process.cwd();
const JUDGE_MODEL  = "qwen2.5:7b";
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
  console.log(ts, `[${level}]`, msg);
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

// ── Rubric generation ────────────────────────────────────────────────────
function buildJudgeRubric(decisionType, inputData, outputData) {
  return `You are a quality auditor for an MES AI system. Score the following decision as "correct" or "incorrect" based on the rubric.

Decision Type: ${decisionType}
Input: ${JSON.stringify(inputData)}
Decision: ${JSON.stringify(outputData)}

Rubric:
- yield_warning: Correct if yield genuinely dropped below baseline by the indicated margin. Incorrect if it's normal statistical variation.
- stagnation_action: Correct if PCB is truly stagnant (no recent events). Incorrect if events were missed.
- scrap_decision: Correct if material is genuinely scrap-worthy. Incorrect if salvageable.
- downtime_flag: Correct if downtime is legitimately prolonged. Incorrect if it's a short pause.
- line_alert: Correct if line had genuine anomaly. Incorrect if false alarm.

Respond with ONLY: "correct" or "incorrect"`;
}

// ── Score recent unevaluated decisions ─────────────────────────────────
async function scoreRecent(limit = 5) {
  log("INFO", `Scoring up to ${limit} recent unevaluated decisions...`);

  const rows = await pgPool.query(
    `SELECT id, decision_type, input_data, output_decision
     FROM mes_manager_audit_log
     WHERE feedback IS NULL
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit]
  );

  if (rows.rows.length === 0) {
    log("INFO", "No unevaluated decisions found");
    return { scored: 0 };
  }

  let correct = 0;
  let incorrect = 0;

  for (const row of rows.rows) {
    const prompt = buildJudgeRubric(
      row.decision_type,
      row.input_data,
      row.output_decision
    );

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

// ── Score all from last N days ──────────────────────────────────────────
async function scoreAll(days = 7) {
  const rows = await pgPool.query(
    `SELECT id, decision_type, input_data, output_decision
     FROM mes_manager_audit_log
     WHERE feedback IS NULL AND created_at >= NOW() - INTERVAL '1 day' * $1
     ORDER BY created_at DESC`,
    [days]
  );

  let correct = 0;
  let incorrect = 0;

  for (const row of rows.rows) {
    const prompt = buildJudgeRubric(row.decision_type, row.input_data, row.output_decision);
    let verdict;
    try {
      verdict = await llmComplete(JUDGE_MODEL, prompt);
      verdict = verdict.trim().toLowerCase();
    } catch (err) {
      continue;
    }
    const feed = verdict.includes("correct") ? "correct" : "incorrect";
    await pgPool.query("UPDATE mes_manager_audit_log SET feedback = $1 WHERE id = $2", [feed, row.id]);
    if (feed === "correct") correct++;
    else incorrect++;
  }

  return { scored: rows.rows.length, correct, incorrect };
}

// ── Threshold tuning ────────────────────────────────────────────────────
async function tuneThresholds() {
  log("INFO", "Analyzing decision patterns for threshold tuning...");

  // Get accuracy per decision type
  const stats = await pgPool.query(`
    SELECT decision_type,
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE feedback = 'correct') AS correct,
      COUNT(*) FILTER (WHERE feedback = 'incorrect') AS incorrect
    FROM mes_manager_audit_log
    WHERE feedback IS NOT NULL
    GROUP BY decision_type
    ORDER BY decision_type
  `);

  const suggestions = [];

  for (const row of stats.rows) {
    const total = Number(row.total);
    if (total < 5) continue; // not enough data

    const accuracy = Number(row.correct) / total;
    const errorRate = Number(row.incorrect) / total;

    if (errorRate > 0.3) {
      suggestions.push({
        decisionType: row.decision_type,
        currentAccuracy: `${(accuracy * 100).toFixed(1)}%`,
        errorRate: `${(errorRate * 100).toFixed(1)}%`,
        suggestion: "Reduce auto-execute confidence threshold or add human review step",
        samples: total,
      });
    }
  }

  // General recommendations
  const recommendation = {
    timestamp: new Date().toISOString(),
    totalDecisions: stats.rows.reduce((s, r) => s + Number(r.total), 0),
    accuracyByType: stats.rows.map(r => ({
      type: r.decision_type,
      accuracy: `${(Number(r.correct) / Math.max(Number(r.total), 1) * 100).toFixed(1)}%`,
      samples: Number(r.total),
    })),
    suggestions,
    note: suggestions.length > 0
      ? "High error rate detected in some decision types. Consider adjusting thresholds or adding human review."
      : "All decision types within acceptable error range.",
  };

  return recommendation;
}

// ── Performance report ──────────────────────────────────────────────────
async function generateReport(days = 7) {
  log("INFO", `Generating performance report for last ${days} days...`);

  const stats = await pgPool.query(`
    SELECT decision_type,
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE feedback = 'correct') AS correct,
      COUNT(*) FILTER (WHERE feedback = 'incorrect') AS incorrect,
      COUNT(*) FILTER (WHERE feedback IS NULL) AS unevaluated
    FROM mes_manager_audit_log
    WHERE created_at >= NOW() - INTERVAL '1 day' * $1
    GROUP BY decision_type
    ORDER BY decision_type`,
    [days]
  );

  const overall = await pgPool.query(`
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE feedback = 'correct') AS correct,
      COUNT(*) FILTER (WHERE feedback = 'incorrect') AS incorrect,
      COUNT(*) FILTER (WHERE feedback IS NULL) AS unevaluated
    FROM mes_manager_audit_log
    WHERE created_at >= NOW() - INTERVAL '1 day' * $1`,
    [days]
  );

  const total = Number(overall.rows[0]?.total ?? 0);
  const correct = Number(overall.rows[0]?.correct ?? 0);
  const evaluated = correct + Number(overall.rows[0]?.incorrect ?? 0);
  const accuracy = evaluated > 0 ? (correct / evaluated * 100).toFixed(1) : "N/A";

  const report = {
    timestamp: new Date().toISOString(),
    period: `${days} days`,
    overall: {
      total,
      evaluated,
      accuracy: `${accuracy}%`,
      unevaluated: Number(overall.rows[0]?.unevaluated ?? 0),
    },
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

  return report;
}

// ── CLI dispatch ─────────────────────────────────────────────────────────
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
        console.error("Usage: node mes-evaluator.js [score-recent|score-all|tune-thresholds|report]");
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
