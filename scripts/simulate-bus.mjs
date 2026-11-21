// Simulate inter-agent bus traffic — Material Loading Workflow
// Inserts realistic wms↔mes↔bom↔hr messages every ~5s
// Run: node scripts/simulate-bus.mjs

import pg from "pg";
import { randomUUID } from "node:crypto";

const pool = new pg.Pool({
  host: process.env.PGHOST ?? "127.0.0.1",
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? "postgres",
  password: process.env.PGPASSWORD ?? "postgres",
  database: process.env.PGDATABASE ?? "smt_factory",
});

// Valid agents per DB check constraint
const A = { WMS: "wms-ai", MES: "mes-ai", BOM: "bom-ai", HR: "hr-ai", RDA: "rda-ai", ANY: "*" };

// ── Material Loading Workflow Message Patterns ──────────────────────
// Each entry: [source, target, subject, payload snippet]
const LOADING_FLOW = [
  // --- Step 1: Material arrives at warehouse ---
  [A.WMS, A.MES, "material_received",      '{"lot":"LOT-260616-PCB-0001","material":"PCB-AURORA-CTRL","qty":5000,"supplier":"SUP-HN-PCB","storage":"RAW-01-01"}'],
  [A.WMS, A.MES, "material_received",      '{"lot":"LOT-260616-RES-0001","material":"R-0603-10K-1","qty":40000,"supplier":"SUP-TPE-RES","storage":"RAW-01-01"}'],

  // --- Step 2: IQC inspection passes ---
  [A.WMS, A.MES, "iqc_released",           '{"lot":"LOT-260616-PCB-0001","inspection":"IQC-260616-0001","result":"pass"}'],
  [A.WMS, A.MES, "iqc_released",           '{"lot":"LOT-260616-RES-0001","inspection":"IQC-260616-0002","result":"pass"}'],

  // --- Step 3: Put-away complete ---
  [A.WMS, A.MES, "putaway_complete",       '{"lot":"LOT-260616-PCB-0001","location":"RAW-01-01","qty":5000}'],
  [A.WMS, A.MES, "putaway_complete",       '{"lot":"LOT-260616-RES-0001","location":"RAW-01-01","qty":40000}'],

  // --- Step 4: Work order released → MES requests BOM data ---
  [A.MES, A.BOM, "bom_requested",          '{"work_order":"26061010008","line":"SMT Line 1"}'],
  [A.BOM, A.MES, "bom_provided",           '{"work_order":"26061010008","items":["PCB-AURORA-CTRL","R-0603-10K-1","IC-001","CAP-0603-100nF"],"revision":"B"}'],

  // --- Step 5: MES requests material from WMS ---
  [A.MES, A.WMS, "material_requested",     '{"work_order":"26061010008","items":{"PCB-AURORA-CTRL":500,"R-0603-10K-1":100},"line":"SMT Line 1"}'],

  // --- Step 6: WMS picks and issues to line buffer ---
  [A.WMS, A.MES, "material_issued",        '{"pick":"PICK-260616-0001","lot":"LOT-260616-PCB-0001","qty":500,"to":"LINE-01-BUF"}'],
  [A.WMS, A.MES, "material_issued",        '{"pick":"PICK-260616-0001","lot":"LOT-260616-RES-0001","qty":100,"to":"LINE-01-BUF"}'],

  // --- Step 7: BOM alerts WMS about stock threshold ---
  [A.BOM, A.WMS, "stock_threshold_alert",  '{"material":"R-0603-10K-1","remaining":39900,"threshold":5000,"action":"reorder_soon"}'],

  // --- Step 8: Feeder binding on SMT line ---
  [A.MES, A.WMS, "feeder_loaded",          '{"line":"SMT Line 1","machine":"NXT-01","feeder":"F-01","lot":"LOT-260616-RES-0001","reel":"REEL-260616-RES-0001"}'],

  // --- Step 9: Production started ---
  [A.MES, A.WMS, "production_started",     '{"work_order":"26061010008","line":"SMT Line 1","pcb_serial":"PCB-260616-0001","qty":1}'],

  // --- Step 10: HR notified about line staffing ---
  [A.MES, A.HR, "line_crew_required",      '{"line":"SMT Line 1","work_order":"26061010008","operators_needed":3,"shift":"day"}'],
  [A.HR,  A.MES, "operators_assigned",     '{"line":"SMT Line 1","assigned":["VN_OP_013","VN_OP_014","VN_OP_015"],"shift":"day"}'],

  // --- Step 11: AOI detects defect → MES notifies BOM ---
  [A.MES, A.BOM, "component_failure",      '{"pcb":"PCB-260616-0001","station":"AOI-01","defect":"AOI-OPEN","lot":"LOT-260616-RES-0001"}'],
  [A.BOM, A.MES, "bom_updated",            '{"work_order":"26061010008","change":"substitute_R-0603-10K-1→R-0603-10K-2","reason":"stock_shortage"}'],

  // --- Step 12: RDA recipe update ---
  [A.RDA, A.MES, "recipe_updated",         '{"machine":"PRINT-01","recipe":"PCB-AURORA-CTRL-v2","solder_paste":"SAC305","stencil_clean_interval":5}'],
];

let total = 0;

function pickWeighted() {
  // Later steps in the flow = less frequent
  const weights = [
    20, 20,  // receive
    18, 18,  // iqc
    15, 15,  // putaway
    12, 12,  // bom request
    10,      // material request
    10, 10,  // issue
    5,       // stock alert
    8,       // feeder
    8,       // production start
    8, 8,    // hr
    5, 5,    // defect
    5,       // recipe
  ];
  const totalW = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * totalW;
  for (let i = 0; i < LOADING_FLOW.length; i++) {
    r -= weights[i];
    if (r <= 0) return LOADING_FLOW[i];
  }
  return LOADING_FLOW[0];
}

async function insertBatch() {
  const batchSize = 2 + Math.floor(Math.random() * 3); // 2-4 msgs
  const batch = [];
  for (let i = 0; i < batchSize; i++) batch.push(pickWeighted());

  const client = await pool.connect();
  try {
    for (const [src, tgt, subj, payload] of batch) {
      await client.query(
        `INSERT INTO inter_agent_messages
           (message_id, source_agent, target_agent, message_type, subject, payload, priority, status, created_at)
         VALUES ($1, $2, $3, 'event', $4, $5::jsonb, 'normal', 'completed', NOW())`,
        [`sim-${randomUUID().slice(0, 8)}`, src, tgt, subj, payload]
      );
    }
    total += batch.length;
    const ts = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    console.log(`[${ts}] +${batch.length} msgs (total: ${total}) — 来料加载流程`);
    for (const [s, t, subj] of batch) {
      const sShort = s.replace("-ai", ""), tShort = t.replace("-ai", "");
      console.log(`  ${sShort} → ${tShort}: ${subj}`);
    }
  } finally {
    client.release();
  }
}

// Clean old sim data (>2 min)
async function cleanOld() {
  try {
    const r = await pool.query(
      `DELETE FROM inter_agent_messages WHERE message_id LIKE 'sim-%' AND created_at < NOW() - INTERVAL '2 minutes'`
    );
    if (r.rowCount > 0) console.log(`  🧹 Cleaned ${r.rowCount} stale messages`);
  } catch { /* table may not exist */ }
}

// --- Startup ---
console.log("┌─────────────────────────────────────────────┐");
console.log("│ 🤖 来料加载总线模拟器 (Material Loading Bus)  │");
console.log("├─────────────────────────────────────────────┤");
console.log("│ wms → mes  : 收料 / IQC / 入库 / 发料        │");
console.log("│ mes → wms  : 物料请求 / 飞达装载 / 生产开始   │");
console.log("│ mes → bom  : BOM请求 / 元件异常               │");
console.log("│ bom → mes  : BOM下发 / 替代料通知             │");
console.log("│ mes → hr   : 产线人力需求                     │");
console.log("│ rda → mes  : 工艺配方更新                     │");
console.log("├─────────────────────────────────────────────┤");
console.log("│ 按 Ctrl+C 停止                               │");
console.log("└─────────────────────────────────────────────┘");

insertBatch().catch(console.error);
const insertTimer = setInterval(insertBatch, 5000);
const cleanTimer = setInterval(cleanOld, 30_000);

process.on("SIGINT", async () => {
  clearInterval(insertTimer);
  clearInterval(cleanTimer);
  console.log("\n🛑 停止中...");
  await cleanOld();
  await pool.end();
  process.exit(0);
});
