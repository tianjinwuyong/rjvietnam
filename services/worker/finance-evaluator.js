/**
 * finance-evaluator.js — Finance AI Manager Skill 15: Auto-Improvement Loop
 *
 * Usage:
 *   node finance-evaluator.js score-recent --limit N
 *   node finance-evaluator.js report --days N
 *   node finance-evaluator.js self-tune
 *
 * Calls Ornith to judge the quality of recent Ornith decisions made by finance-manager.js.
 * Scores: accuracy, timeliness, business_value, risk_management (0-10 each).
 */

import { existsSync, readFileSync, appendFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const LOG_FILE    = join(__dirname, "finance-manager.log");
const CONFIG_FILE = join(__dirname, "finance-evaluator-config.json");
const STATE_FILE  = join(__dirname, "finance-last-state.json");
const OrnithModel = "hf.co/deepreinforce-ai/Ornith-1.0-9B-GGUF:Q5_K_M";

// ── LLM router (ESM → use createRequire) ─────────────────────────────────────
const require2 = createRequire(import.meta.url);
const { askLLM } = require2("../_shared/llm-router.js");

// ── Logging ──────────────────────────────────────────────────────────────────
function log(level, msg) {
  const ts = new Date().toISOString().slice(0, 19).replace("T", " ");
  const line = `${ts} [${level}] [EVAL] ${msg}`;
  try { appendFileSync(LOG_FILE, line + "\n"); } catch (_) {}
  if (level === "ERROR") console.error(line); else console.log(line);
}

// ── Parse Ornith decisions from finance-manager.log ────────────────────────────
// Looks for lines like: [DECISION] AR Follow-up: 2
// and:   [AUTO] {"invoice_no":"..."}
function parseDecisionsFromLog(limit = 5) {
  if (!existsSync(LOG_FILE)) return [];
  const content = readFileSync(LOG_FILE, "utf-8");
  const lines = content.split("\n");
  const decisions = [];
  let current = null;

  for (const line of lines) {
    const decisionMatch = line.match(/\[DECISION\]\s+(\w[\w\s]+?):\s*(\d+)\s*$/);
    if (decisionMatch) {
      if (current) decisions.push(current);
      current = { type: decisionMatch[1].trim(), count: parseInt(decisionMatch[2]), details: [] };
      continue;
    }
    const detailMatch = line.match(/\s+\[(AUTO|MANUAL)\]\s+(.+)$/);
    if (detailMatch && current) {
      try {
        current.details.push({ mode: detailMatch[1], data: JSON.parse(detailMatch[2]) });
      } catch (_) {
        current.details.push({ mode: detailMatch[1], raw: detailMatch[2].trim() });
      }
    }
  }
  if (current) decisions.push(current);
  return decisions.slice(-limit);
}

// ── LLM Judge: score a single Ornith decision ────────────────────────────────
async function judgeDecision(decision) {
  const judgePrompt = `你是一个财务AI决策评审员。评估以下AI决策的质量。

决策类型: ${decision.type}
决策内容: ${JSON.stringify(decision.details[0]?.data || decision.details[0] || {}, null, 2)}

评分维度 (0-10):
1. 准确性 - 决策是否基于正确的数据和合理推断？
2. 时效性 - 决策是否及时？有没有延误？
3. 业务价值 - 决策是否产生了正向业务影响？
4. 风险管理 - 决策是否有效控制了风险？

请直接返回JSON（不要有其他文字）:
{
  "score": 0-10,
  "accuracy": 0-10,
  "timeliness": 0-10,
  "business_value": 0-10,
  "risk_management": 0-10,
  "reasoning": "简短评审理由，1-2句话",
  "improvement_suggestion": "改进建议，1句话"
}`;

  try {
    const response = await askLLM("analysis", judgePrompt, { timeoutMs: 120000 });

    // Extract JSON from response (try whole response first, then find object)
    let parsed = null;
    try { parsed = JSON.parse(response.trim()); } catch (_) {}
    if (!parsed) {
      const match = response.match(/\{[\s\S]*"score"[\s\S]*\}/);
      if (match) { try { parsed = JSON.parse(match[0]); } catch (_) {} }
    }
    if (!parsed) {
      return { score: 5, accuracy: 5, timeliness: 5, business_value: 5, risk_management: 5,
               reasoning: "解析失败，使用默认分", improvement_suggestion: "检查LLM输出格式" };
    }
    return parsed;
  } catch (err) {
    log("WARN", `Judge call failed: ${err.message}`);
    return { score: 5, accuracy: 5, timeliness: 5, business_value: 5, risk_management: 5,
             reasoning: `Judge调用失败: ${err.message}`, improvement_suggestion: "检查Ollama服务" };
  }
}

// ── Config: prompt weights + score history ─────────────────────────────────────
function loadConfig() {
  try {
    if (existsSync(CONFIG_FILE)) return JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
  } catch (_) {}
  return { prompt_weights: { accuracy: 1, timeliness: 1, business_value: 1, risk_management: 1 },
           score_history: [], last_tuned: null };
}

function saveConfig(cfg) {
  try { writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2)); } catch (_) {}
}

// ── score-recent ─────────────────────────────────────────────────────────────
async function scoreRecent(limit = 5) {
  log("INFO", `Scoring up to ${limit} recent Ornith decisions...`);
  const decisions = parseDecisionsFromLog(limit);

  if (decisions.length === 0) {
    const result = { scores: [], overall: { evaluated: 0, accuracy: "N/A", trend: "stable" } };
    console.log(JSON.stringify(result));
    return result;
  }

  const scores = [];
  for (const decision of decisions) {
    const score = await judgeDecision(decision);
    const entry = {
      decision_type: decision.type,
      decision: decision.details[0]?.data || {},
      scored_at: new Date().toISOString(),
      ...score,
    };
    scores.push(entry);
    log("INFO", `[SCORE] ${decision.type}: score=${score.score}/10 — ${score.reasoning}`);
  }

  const totalScore = scores.reduce((s, sc) => s + (sc.score || 0), 0);
  const accuracy = Math.round((totalScore / scores.length / 10) * 100) + "%";
  const result = { scores, overall: { evaluated: scores.length, accuracy, trend: "stable" } };

  // Persist to config history
  const cfg = loadConfig();
  cfg.score_history.push(...scores);
  cfg.score_history = cfg.score_history.slice(-100); // keep last 100
  saveConfig(cfg);

  console.log(JSON.stringify(result));
  return result;
}

// ── report ───────────────────────────────────────────────────────────────────
async function report(days = 7) {
  log("INFO", `Generating ${days}-day performance report...`);
  const cfg = loadConfig();
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const recent = cfg.score_history.filter(s => {
    try { return new Date(s.scored_at).getTime() > cutoff; } catch (_) { return false; }
  });

  if (recent.length === 0) {
    const result = { overall: { evaluated: 0, accuracy: "N/A", trend: "stable" }, period_days: days };
    console.log(JSON.stringify(result));
    return result;
  }

  const avgScore  = recent.reduce((s, sc) => s + (sc.score || 0), 0) / recent.length;
  const avgAcc    = recent.reduce((s, sc) => s + (sc.accuracy || 0), 0) / recent.length;
  const avgTime   = recent.reduce((s, sc) => s + (sc.timeliness || 0), 0) / recent.length;
  const avgBiz    = recent.reduce((s, sc) => s + (sc.business_value || 0), 0) / recent.length;
  const avgRisk   = recent.reduce((s, sc) => s + (sc.risk_management || 0), 0) / recent.length;
  const accuracy  = Math.round((avgScore / 10) * 100) + "%";

  // Trend: compare first-half avg vs second-half avg
  const mid = Math.floor(recent.length / 2);
  const firstAvg  = recent.slice(0, mid).reduce((s, sc) => s + (sc.score || 0), 0) / (mid || 1);
  const secondAvg = recent.slice(mid).reduce((s, sc) => s + (sc.score || 0), 0) / ((recent.length - mid) || 1);
  const trend = secondAvg > firstAvg + 0.5 ? "improving" : secondAvg < firstAvg - 0.5 ? "declining" : "stable";

  const result = {
    overall: { evaluated: recent.length, accuracy, trend, avg_score: avgScore.toFixed(1) },
    period_days: days,
    breakdown: {
      avg_accuracy:      avgAcc.toFixed(1),
      avg_timeliness:   avgTime.toFixed(1),
      avg_business_value: avgBiz.toFixed(1),
      avg_risk_mgmt:     avgRisk.toFixed(1),
    },
  };

  console.log(JSON.stringify(result));
  return result;
}

// ── self-tune ────────────────────────────────────────────────────────────────
async function selfTune() {
  log("INFO", "Running self-tuning...");
  const cfg = loadConfig();
  if (cfg.score_history.length < 3) {
    console.log(JSON.stringify({ status: "insufficient_data", need: 3, have: cfg.score_history.length }));
    return;
  }

  const recent = cfg.score_history.slice(-20);
  // Scores are 0-10; normalize to 0-1 range by dividing by 10.
  // Without the /10 divisor, Math.max(0.5, ...) always returns 0.5.
  const newWeights = {
    accuracy:       Math.max(0.5, Math.min(1.0, recent.reduce((s, sc) => s + (sc.accuracy || 0), 0) / recent.length / 10)),
    timeliness:      Math.max(0.5, Math.min(1.0, recent.reduce((s, sc) => s + (sc.timeliness || 0), 0) / recent.length / 10)),
    business_value:  Math.max(0.5, Math.min(1.0, recent.reduce((s, sc) => s + (sc.business_value || 0), 0) / recent.length / 10)),
    risk_management: Math.max(0.5, Math.min(1.0, recent.reduce((s, sc) => s + (sc.risk_management || 0), 0) / recent.length / 10)),
  };

  cfg.prompt_weights = newWeights;
  cfg.last_tuned = new Date().toISOString();
  saveConfig(cfg);

  const result = { status: "tuned", weights: newWeights, based_on: recent.length, tuned_at: cfg.last_tuned };
  console.log(JSON.stringify(result));
  return result;
}

// ── CLI dispatch ─────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  switch (cmd) {
    case "score-recent": {
      const limitArg = args.find(a => a.match(/^--limit=/));
      let limit;
      if (limitArg) {
        limit = parseInt(limitArg.split("=")[1]);
      } else {
        const idx = args.indexOf("--limit");
        limit = idx >= 0 && args[idx + 1] ? parseInt(args[idx + 1]) : 5;
      }
      await scoreRecent(limit || 5);
      break;
    }
    case "report": {
      const daysArg = args.find(a => a.match(/^--days=/));
      let days;
      if (daysArg) {
        days = parseInt(daysArg.split("=")[1]);
      } else {
        const idx = args.indexOf("--days");
        days = idx >= 0 && args[idx + 1] ? parseInt(args[idx + 1]) : 7;
      }
      await report(days || 7);
      break;
    }
    case "self-tune":
      await selfTune();
      break;
    default:
      console.log(`Finance Evaluator — Skill 15 Auto-Improvement Loop
Usage:
  node finance-evaluator.js score-recent --limit N   Score last N decisions (default: 5)
  node finance-evaluator.js report --days N           Report over N days (default: 7)
  node finance-evaluator.js self-tune                 Adjust prompt weights`);
  }
}

main().catch(err => {
  console.error(JSON.stringify({ error: err.message }));
  process.exit(1);
});
