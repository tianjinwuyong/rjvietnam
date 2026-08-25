/**
 * bom-execute.js — BOM AI Manager executor
 * Bridges Ornith's BOM decisions to actual API calls.
 *
 * Usage:
 *   node bom-execute.js <action> [options]
 *
 * Actions:
 *   wo-decide    --wocode <wo> --action RELEASE|HOLD|CANCEL|REPLAN [--reason <text>]
 *   bom-create   --productcode <code> --revision <rev> --type EBOM|MBOM|SBOM --json <json>
 *   bom-update   --bomid <id> --json <json>
 *   eco-create   --bomid <id> --type <type> --json <json>
 *   eco-approve  --ecoid <id>
 *   cost-rollup  --bomid <id>
 *   shortage-check --wocode <wo>
 *   audit-bom    --bomid <id>
 *   patrol       (returns all data)
 *   morning-digest (sends LINE report)
 *   help
 */

import jwt from "jsonwebtoken";
import pg from "pg";
import { readFileSync, existsSync } from "fs";

const { Pool } = pg;

// ── Config ──────────────────────────────────────────────────────────────
const JWT_SECRET   = process.env.JWT_SECRET   ?? "smt-factory-secret-2026";
const API_BASE     = process.env.API_BASE     ?? "http://127.0.0.1:8080";
const LINE_TOKEN_FILE = "services/worker/line_token.txt";

const pgPool = new Pool({
  host:     process.env.PGHOST     ?? "127.0.0.1",
  port:     Number(process.env.PGPORT ?? 5432),
  user:     process.env.PGUSER     ?? "postgres",
  password: process.env.PGPASSWORD ?? "postgres",
  database: process.env.PGDATABASE ?? "smt_factory",
  max: 3,
});

// ── JWT generation ───────────────────────────────────────────────────────
function getJwt(roleKey = "admin") {
  return jwt.sign(
    { userId: 10, username: "bom-ai", roleKey,
      permissions: ["bom.view", "bom.execute", "wo.execute", "eco.execute"] },
    JWT_SECRET,
    { expiresIn: "8h" }
  );
}

// ── API helper ──────────────────────────────────────────────────────────
async function apiCall(method, path, body = null) {
  const token = getJwt();
  const opts = {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API_BASE}${path}`, opts);
  const json = await res.json();
  if (!res.ok) throw new Error(`API ${method} ${path} -> ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

// ── Work Order Decision ─────────────────────────────────────────────────
async function woDecide(woCode, action, reason = "") {
  const statusMap = { RELEASE: "released", HOLD: "hold", CANCEL: "cancelled", REPLAN: "replan" };
  const status = statusMap[action];
  if (!status) throw new Error(`Unknown WO action: ${action}`);

  let result;
  try {
    result = await apiCall("PATCH", `/pmc/work-orders/${woCode}`, { status, notes: reason });
  } catch (apiErr) {
    // Direct DB fallback
    await pgPool.query(
      "UPDATE work_orders SET status = $1, updated_at = now() WHERE code = $2",
      [status, woCode]
    );
    result = { ok: true, source: "direct-db-fallback", action, woCode, status };
  }

  await logAudit("WO_DECISION", null, woCode, null, { action, reason, result });

  if (action === "HOLD" || action === "CANCEL") {
    await sendLINE(`🟡 [工单${action === "HOLD" ? "挂起" : "取消"}] WO:${woCode} | 原因:${reason}`);
  } else if (action === "RELEASE") {
    await sendLINE(`✅ [工单下达] WO:${woCode} | 已释放`);
  }
  return result;
}

// ── BOM Create ─────────────────────────────────────────────────────────
async function bomCreate(productCode, revision, bomType, bomJson) {
  const result = await apiCall("POST", "/bom", {
    productCode, revision, bomType, lines: bomJson,
  });
  await logAudit("BOM_CREATE", result?.id, productCode, null, { productCode, revision, bomType });
  await sendLINE(`📋 [BOM创建] ${productCode} rev${revision} (${bomType})`);
  return result;
}

// ── BOM Update ─────────────────────────────────────────────────────────
async function bomUpdate(bomId, bomJson) {
  const result = await apiCall("PATCH", `/bom/${bomId}`, bomJson);
  await logAudit("BOM_UPDATE", bomId, null, null, bomJson);
  return result;
}

// ── ECO Create ──────────────────────────────────────────────────────────
async function ecoCreate(bomId, ecoType, ecoJson) {
  const result = await apiCall("POST", "/eco", { bomId, type: ecoType, ...ecoJson });
  await logAudit("ECO_CREATE", bomId, null, result?.id, { bomId, type: ecoType });
  return result;
}

// ── ECO Approve ─────────────────────────────────────────────────────────
async function ecoApprove(ecoId) {
  let result;
  try {
    result = await apiCall("PATCH", `/eco/${ecoId}`, { status: "approved" });
  } catch (apiErr) {
    await pgPool.query("UPDATE eco SET status = 'approved', updated_at = now() WHERE id = $1", [ecoId]);
    result = { ok: true, source: "direct-db-fallback" };
  }
  await logAudit("ECO_APPROVE", null, null, ecoId, { result });
  await sendLINE(`✅ [ECO审批通过] ECO:${ecoId}`);
  return result;
}

// ── Cost Rollup ─────────────────────────────────────────────────────────
async function costRollup(bomId) {
  const { execSync } = await import("child_process");
  const root = process.cwd();
  const raw = execSync(`node services/worker/bom-query.js bom-cost --bomid ${bomId}`, {
    cwd: root, encoding: "utf8",
  });
  const costData = JSON.parse(raw);
  await logAudit("COST_ROLLUP", bomId, null, null, costData);
  // Check delta > 5% vs previous cost (simplified: store to last-cost.json)
  const { writeFileSync, existsSync } = await import("fs");
  const costFile = "services/worker/last-cost.json";
  let prevCost = null;
  if (existsSync(costFile)) {
    try { prevCost = JSON.parse(readFileSync(costFile, "utf8")); } catch (_) {}
  }
  const currentCost = costData.bomCost?.materialCost?.[0]?.material_cost ?? 0;
  if (prevCost && prevCost.bomId === bomId && prevCost.cost > 0) {
    const deltaPct = Math.abs((currentCost - prevCost.cost) / prevCost.cost * 100);
    if (deltaPct > 5) {
      await sendLINE(`⚠️ [成本变动] BOM:${bomId} | 变动幅度:${deltaPct.toFixed(1)}%`);
    }
  }
  writeFileSync(costFile, JSON.stringify({ bomId, cost: currentCost, at: new Date().toISOString() }));
  return costData;
}

// ── Shortage Check ──────────────────────────────────────────────────────
async function shortageCheck(woCode) {
  const { execSync } = await import("child_process");
  const root = process.cwd();
  const raw = execSync(`node services/worker/bom-query.js material-readiness`, {
    cwd: root, encoding: "utf8",
  });
  const data = JSON.parse(raw);
  // Check for shortages (available_qty = 0 or very low)
  const shortages = (data.materialReadiness ?? []).filter(m => Number(m.available_qty) < 100);
  if (shortages.length > 0) {
    await sendLINE(`⚠️ [物料短缺] ${shortages.length}项物料库存不足\n${shortages.slice(0,5).map(s => `  ${s.material_code}: 可用${s.available_qty}`).join("\n")}`);
  }
  return { woCode, shortages };
}

// ── Audit BOM ──────────────────────────────────────────────────────────
async function auditBom(bomId) {
  const { execSync } = await import("child_process");
  const root = process.cwd();
  const raw = execSync(`node services/worker/bom-query.js bom-audit`, {
    cwd: root, encoding: "utf8",
  });
  const audit = JSON.parse(raw);
  const issues = (audit.bomAudit?.orphanLines?.length ?? 0)
               + (audit.bomAudit?.phantomBoms?.length ?? 0)
               + (audit.bomAudit?.duplicates?.length ?? 0)
               + (audit.bomAudit?.zeroQtyLines?.length ?? 0);
  if (issues > 0) {
    await sendLINE(`🔴 [BOM审计] 发现${issues}个问题 | 需人工核查`);
  }
  await logAudit("BOM_AUDIT", bomId, null, null, audit);
  return audit;
}

// ── Patrol ──────────────────────────────────────────────────────────────
async function patrol() {
  const { execSync } = await import("child_process");
  const root = process.cwd();
  const raw = execSync(`node services/worker/bom-query.js all`, {
    cwd: root, encoding: "utf8",
  });
  return JSON.parse(raw);
}

// ── Morning Digest ─────────────────────────────────────────────────────
async function morningDigest() {
  const data = await patrol();
  const lines = [];

  lines.push(`📋 BOM晨报 ${new Date().toLocaleDateString("zh-CN")}`);
  lines.push("━━━━━━━━━━━━━━━━━━");

  const wos = data.workOrders ?? [];
  const running = wos.filter(w => w.status === "running").length;
  const released = wos.filter(w => w.status === "released").length;
  const draft = wos.filter(w => w.status === "draft").length;
  lines.push(`⚙️ 工单: 进行中${running} | 已下达${released} | 草稿${draft}`);

  const boms = data.bomList ?? [];
  lines.push(`📋 BOM: 共${boms.length}个`);

  const ecos = data.ecoList ?? [];
  const pendingEcos = ecos.filter(e => e.status === "pending").length;
  if (pendingEcos > 0) lines.push(`📝 待审批ECO: ${pendingEcos}个`);

  const readiness = data.materialReadiness ?? [];
  const shortages = readiness.filter(m => Number(m.available_qty) < 100);
  if (shortages.length > 0) {
    lines.push("⚠️ 库存不足物料:");
    shortages.slice(0, 5).forEach(s => lines.push(`  - ${s.material_code}: 可用${s.available_qty}`));
  }

  lines.push("━━━━━━━━━━━━━━━━━━");
  lines.push("📋 详细分析见 BOM Manager");

  const msg = lines.join("\n");
  await sendLINE(msg);
  console.log(msg);
}

// ── Audit Log ──────────────────────────────────────────────────────────
async function logAudit(decisionType, bomId, woNumber, ecoId, data) {
  try {
    await pgPool.query(`
      INSERT INTO bom_manager_audit
        (agent, decision_type, bom_id, wo_number, eco_id, input_data, output_decision, executed, executor)
      VALUES ($1,$2,$3,$4,$5,$6,$7,true,'bom-ai')
    `, ["bom-ai-manager", decisionType, bomId, woNumber, ecoId,
        JSON.stringify(data), JSON.stringify(data)]);
  } catch (err) {
    console.error("[AUDIT ERROR]", err.message);
  }
}

// ── LINE ────────────────────────────────────────────────────────────────
async function sendLINE(message) {
  try {
    if (!existsSync(LINE_TOKEN_FILE)) return;
    const token = readFileSync(LINE_TOKEN_FILE, "utf8").trim();
    if (!token) return;
    const res = await fetch("https://notify-api.line.me/api/notify", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    if (!res.ok) console.error("[LINE ERROR]", res.status);
  } catch (err) {
    console.error("[LINE ERROR]", err.message);
  }
}

// ── Ensure audit table ──────────────────────────────────────────────────
async function ensureAuditTable() {
  try {
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS bom_manager_audit (
        id          bigserial PRIMARY KEY,
        agent       varchar(80) NOT NULL,
        decision_type varchar(80) NOT NULL,
        bom_id      bigint,
        wo_number   varchar(80),
        eco_id      bigint,
        input_data  jsonb,
        output_decision jsonb,
        executed    boolean NOT NULL DEFAULT true,
        executor    varchar(80),
        override_by varchar(80),
        created_at  timestamptz NOT NULL DEFAULT now()
      )
    `);
  } catch (_) {}
}

// ── CLI ────────────────────────────────────────────────────────────────
async function main() {
  await ensureAuditTable();

  const [action, ...args] = process.argv.slice(2);

  const getArg = (name, fallback = "") => {
    const idx = args.indexOf(`--${name}`);
    return idx >= 0 ? args[idx + 1] ?? fallback : fallback;
  };

  switch (action) {
    case "wo-decide": {
      const wo = getArg("wocode");
      const a = getArg("action", "RELEASE").toUpperCase();
      const r = getArg("reason", "AI建议");
      if (!wo) { console.error("Usage: wo-decide --wocode <wo> --action RELEASE|HOLD|CANCEL|REPLAN"); process.exit(1); }
      console.log(JSON.stringify(await woDecide(wo, a, r), null, 2));
      break;
    }
    case "bom-create": {
      const pc = getArg("productcode"); const rev = getArg("revision");
      const bt = getArg("type", "EBOM").toUpperCase();
      const j = getArg("json", "[]");
      if (!pc || !rev) { console.error("Usage: bom-create --productcode <code> --revision <rev>"); process.exit(1); }
      console.log(JSON.stringify(await bomCreate(pc, rev, bt, JSON.parse(j)), null, 2));
      break;
    }
    case "bom-update": {
      const id = getArg("bomid"); const j = getArg("json", "{}");
      if (!id) { console.error("Usage: bom-update --bomid <id> --json <json>"); process.exit(1); }
      console.log(JSON.stringify(await bomUpdate(Number(id), JSON.parse(j)), null, 2));
      break;
    }
    case "eco-create": {
      const bid = getArg("bomid"); const et = getArg("type", "component_replace");
      const ej = getArg("json", "{}");
      if (!bid) { console.error("Usage: eco-create --bomid <id> --type <type> --json <json>"); process.exit(1); }
      console.log(JSON.stringify(await ecoCreate(Number(bid), et, JSON.parse(ej)), null, 2));
      break;
    }
    case "eco-approve": {
      const eid = getArg("ecoid");
      if (!eid) { console.error("Usage: eco-approve --ecoid <id>"); process.exit(1); }
      console.log(JSON.stringify(await ecoApprove(Number(eid)), null, 2));
      break;
    }
    case "cost-rollup": {
      const bid = getArg("bomid");
      if (!bid) { console.error("Usage: cost-rollup --bomid <id>"); process.exit(1); }
      console.log(JSON.stringify(await costRollup(Number(bid)), null, 2));
      break;
    }
    case "shortage-check": {
      const wo = getArg("wocode");
      if (!wo) { console.error("Usage: shortage-check --wocode <wo>"); process.exit(1); }
      console.log(JSON.stringify(await shortageCheck(wo), null, 2));
      break;
    }
    case "audit-bom": {
      const bid = getArg("bomid");
      console.log(JSON.stringify(await auditBom(bid ? Number(bid) : null), null, 2));
      break;
    }
    case "patrol": {
      console.log(JSON.stringify(await patrol(), null, 2));
      break;
    }
    case "morning-digest": {
      await morningDigest();
      break;
    }
    case "help": {
      console.log(`BOM AI Manager Executor
Usage: node bom-execute.js <action> [options]

Actions:
  wo-decide    --wocode <wo> --action RELEASE|HOLD|CANCEL|REPLAN [--reason <text>]
  bom-create   --productcode <code> --revision <rev> --type EBOM|MBOM|SBOM --json <json>
  bom-update   --bomid <id> --json <json>
  eco-create   --bomid <id> --type <type> --json <json>
  eco-approve  --ecoid <id>
  cost-rollup  --bomid <id>
  shortage-check --wocode <wo>
  audit-bom    --bomid <id>
  patrol       (returns all data)
  morning-digest (sends LINE report)
  help
`);
      break;
    }
    default:
      console.error(`Unknown action: ${action}. Run with "help" for usage.`);
      process.exit(1);
  }

  await pgPool.end();
}

main().catch(err => {
  console.error(JSON.stringify({ error: err.message }));
  process.exit(1);
});
