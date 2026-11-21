/**
 * Maintenance Manager Tester
 * Runs 5 fault scenarios per equipment, per part.
 * Output: HTML report (maintenance-tester-report.html)
 *
 * Usage:
 *   node tests/maintenance-tester.js              — full test run
 *   node tests/maintenance-tester.js --report     — re-generate from saved JSON
 *   node tests/maintenance-tester.js --equipment eq-003
 *   node tests/maintenance-tester.js --scenario 1
 */

const { Pool } = require("pg");
const http = require("http");
const fs = require("fs");
const path = require("path");

const DB = "postgresql://postgres:123456@localhost:5432/smt_factory";
const API_BASE = "http://127.0.0.1:5174/api";

// ── Equipment list ──────────────────────────────────────────
const EQUIPMENT = [
  { id: "eq-001", code: "SMT-NXT-01", name: "Fuji NXT III #1 (贴片机)" },
  { id: "eq-002", code: "SMT-NXT-02", name: "Fuji NXT III #2 (贴片机)" },
  { id: "eq-003", code: "PRINTER-DEK-01", name: "DEK Horizon #1 (印刷机)" },
  { id: "eq-004", code: "AOI-CTI-01", name: "CTI A40 AOI (光学检测)" },
  { id: "eq-005", code: "REF-V8-01", name: "Rehm V8 Reflow (回流焊)" },
  { id: "eq-006", code: "PRINTER-DEK-02", name: "DEK Horizon #2 (印刷机)" },
];

const WEAR_THRESHOLDS = { normal: 50, warning: 70, critical: 90, overdue: 100 };

let pool;
let allResults = [];

function db() {
  if (!pool) pool = new Pool({ connectionString: DB });
  return pool;
}

async function query(sql, params) {
  try {
    const r = await db().query(sql, params);
    return r.rows;
  } catch (e) {
    return { error: e.message };
  }
}

function fetchApi(path) {
  return new Promise((resolve) => {
    http.get(`${API_BASE}${path}`, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve({ error: `bad JSON: ${data.slice(0, 100)}` });
        }
      });
    }).on("error", (e) => resolve({ error: e.message }));
  });
}

function computeWear(runningHours, interval) {
  if (!interval || interval <= 0) return { wearPct: 0, lifeLeft: 0, daysLeft: 0, status: "unknown" };
  const wearPct = Math.min((runningHours / interval) * 100, 100);
  const lifeLeft = Math.max(interval - runningHours, 0);
  const daysLeft = lifeLeft / 8;
  let status = "normal";
  if (wearPct >= 100) status = "overdue";
  else if (wearPct >= 90) status = "critical";
  else if (wearPct >= 70) status = "warning";
  return { wearPct: Math.round(wearPct * 100) / 100, lifeLeft, daysLeft: Math.round(daysLeft * 10) / 10, status };
}

function statusIcon(s) {
  const m = { normal: "🟢", warning: "🟡", critical: "🟠", overdue: "🔴", unknown: "⚪" };
  return m[s] ?? "⚪";
}

function passFail(ok) {
  return ok ? "✓ PASS" : "✗ FAIL";
}

// ── Scenario 1: Wear Progression ────────────────────────────
async function scenario1WearProgression(equip, parts) {
  const res = [];
  for (const p of parts) {
    const wear = computeWear(Number(p.running_hours), Number(p.replace_interval_hours));
    let correct = true;
    const issues = [];

    // Check if wearStatus matches computed status
    if (wear.status === "overdue" && p.wear_status !== "overdue") {
      correct = false;
      issues.push(`DB says ${p.wear_status}, should be overdue`);
    } else if (wear.status === "critical" && !["critical", "overdue"].includes(p.wear_status)) {
      correct = false;
      issues.push(`DB says ${p.wear_status}, should be critical`);
    } else if (wear.status === "warning" && !["warning", "critical", "overdue"].includes(p.wear_status)) {
      correct = false;
      issues.push(`DB says ${p.wear_status}, should be warning`);
    }

    // Check threshold transitions
    if (wear.wearPct >= WEAR_THRESHOLDS.critical && !["critical", "overdue"].includes(p.wear_status)) {
      correct = false;
      issues.push(`wear ${wear.wearPct}% >= 90% but status is ${p.wear_status}`);
    }
    if (wear.wearPct >= WEAR_THRESHOLDS.overdue && p.wear_status !== "overdue") {
      correct = false;
      issues.push(`wear ${wear.wearPct}% >= 100% but status is ${p.wear_status}`);
    }

    res.push({
      partId: p.part_id,
      partName: p.part_name ?? p.part_id,
      runningHours: Number(p.running_hours),
      interval: Number(p.replace_interval_hours),
      wearPct: wear.wearPct,
      lifeLeft: wear.lifeLeft,
      expectedStatus: wear.status,
      actualStatus: p.wear_status,
      pass: correct,
      issues: issues.length ? issues.join("; ") : null,
    });
  }
  return res;
}

// ── Scenario 2: Overdue Detection ───────────────────────────
async function scenario2OverdueDetection(equip, parts) {
  const res = [];
  for (const p of parts) {
    const rh = Number(p.running_hours);
    const interval = Number(p.replace_interval_hours);
    const isOverdue = rh >= interval;
    const shouldFlag = isOverdue;

    let pass = true;
    let issues = [];
    if (shouldFlag && p.wear_status !== "overdue") {
      pass = false;
      issues.push(`running ${rh}h >= interval ${interval}h but status is ${p.wear_status} (should be overdue)`);
    }
    if (shouldFlag && !isOverdue) {
      pass = false;
      issues.push(`interval ${interval}h > running ${rh}h but marked overdue`);
    }

    // Check if API's /lifespan/overdue would return this
    const apiRes = await fetchApi(`/spare-parts/lifespan/overdue`);
    const inApiOverdue = apiRes?.data?.items?.some((i) => i.partId === p.part_id) ?? false;
    if (isOverdue && !inApiOverdue) {
      pass = false;
      issues.push("overdue but missing from /lifespan/overdue endpoint");
    }

    res.push({
      partId: p.part_id,
      partName: p.part_name ?? p.part_id,
      runningHours: rh,
      interval,
      isOverdue,
      flaggedBySystem: p.wear_status === "overdue",
      inApiOverdue,
      pass,
      issues: issues.length ? issues.join("; ") : null,
    });
  }
  return res;
}

// ── Scenario 3: Consumption Spike ───────────────────────────
async function scenario3ConsumptionSpike(equip, parts) {
  const res = [];
  // Get consumption data for last 30 days
  const consumptionData = await query(
    `SELECT part_id, SUM(quantity) as total_qty, COUNT(*) as tx_count,
            MIN(consumed_at) as first_date, MAX(consumed_at) as last_date
     FROM parts_consumption_log
     WHERE consumed_at >= NOW() - INTERVAL '30 days'
     GROUP BY part_id`
  );
  const consMap = {};
  for (const row of Array.isArray(consumptionData) ? consumptionData : []) {
    consMap[row.part_id] = { qty: Number(row.total_qty), tx: Number(row.tx_count) };
  }

  for (const p of parts) {
    const c = consMap[p.part_id];
    const isConsumed = c && c.qty > 0;
    const spikeThreshold = 3; // 3× baseline = spike

    // Estimate daily consumption rate
    let dailyRate = 0;
    let hasSpike = false;
    let pass = true;
    let issues = [];

    if (isConsumed) {
      dailyRate = c.qty / 30;
      // Check if any single transaction > 3× daily rate
      const txData = await query(
        `SELECT quantity FROM parts_consumption_log
         WHERE part_id = $1 AND consumed_at >= NOW() - INTERVAL '30 days'
         ORDER BY consumed_at DESC`,
        [p.part_id]
      );
      if (Array.isArray(txData)) {
        for (const tx of txData) {
          if (Number(tx.quantity) > dailyRate * spikeThreshold && dailyRate > 0) {
            hasSpike = true;
          }
        }
      }
    }

    // Check if system has any anomaly detection
    const apiCons = await fetchApi(`/spare-parts/consumption?partId=${p.part_id}`);
    if (!hasSpike && isConsumed && c.qty > 0) {
      // If consumed but no spike, that's normal
    }
    if (isConsumed && !hasSpike) {
      // Normal consumption - not necessarily a fail, Scenario 3 specifically tests spike detection
      // We check if API has any mechanism to flag anomalies
      if (apiCons?.data?.items?.length > 0) {
        // API exists but no spike detection built-in
        issues.push("consumption API exists but no anomaly/velocity threshold detection");
        pass = false;
      }
    }

    res.push({
      partId: p.part_id,
      partName: p.part_name ?? p.part_id,
      hasConsumption: isConsumed,
      dailyRate: Math.round(dailyRate * 100) / 100,
      hasSpike,
      apiReturnsData: apiCons?.data?.items?.length > 0,
      pass,
      issues: issues.length ? issues.join("; ") : null,
    });
  }
  return res;
}

// ── Scenario 4: Low Stock + High Wear Combo ─────────────────
async function scenario4LowStockHighWear(equip, parts) {
  const res = [];
  for (const p of parts) {
    const wear = computeWear(Number(p.running_hours), Number(p.replace_interval_hours));
    const stock = Number(p.current_stock ?? 0);
    const minStock = Number(p.min_stock ?? 0);
    const isLowStock = minStock > 0 && stock < minStock;
    const isHighWear = wear.wearPct >= WEAR_THRESHOLDS.warning;

    let pass = true;
    let issues = [];

    // Check /low-stock endpoint
    const lowStockApi = await fetchApi(`/spare-parts/low-stock`);
    const inLowStock = lowStockApi?.data?.items?.some((i) => i.part_id === p.part_id) ?? false;
    if (isLowStock && !inLowStock) {
      issues.push(`stock=${stock} < min=${minStock} but missing from /low-stock`);
      pass = false;
    }

    // Check /wear-alerts endpoint
    const wearAlertsApi = await fetchApi(`/spare-parts/wear-alerts`);
    const inWearAlerts = wearAlertsApi?.data?.items?.some((i) => i.part_id === p.part_id || i.partId === p.part_id) ?? false;
    if (isHighWear && !inWearAlerts) {
      issues.push(`wear=${wear.wearPct}% (${wear.status}) but no alert in /wear-alerts`);
      pass = false;
    }

    // Dual alert check
    if (isLowStock && isHighWear && (!inLowStock || !inWearAlerts)) {
      issues.push("DUAL CONDITION: low stock + high wear, should appear in BOTH endpoints");
      pass = false;
    }

    res.push({
      partId: p.part_id,
      partName: p.part_name ?? p.part_id,
      stock,
      minStock,
      isLowStock,
      wearPct: wear.wearPct,
      wearStatus: wear.status,
      isHighWear,
      inLowStock,
      inWearAlerts,
      pass,
      issues: issues.length ? issues.join("; ") : null,
    });
  }
  return res;
}

// ── Scenario 5: Alert Fidelity ──────────────────────────────
async function scenario5AlertFidelity(equip, parts) {
  const res = [];
  // Get all existing alerts for this equipment
  const alerts = await query(
    `SELECT * FROM parts_wear_alerts WHERE equipment_id = $1 ORDER BY created_at DESC`,
    [equip.id]
  );

  for (const p of parts) {
    const wear = computeWear(Number(p.running_hours), Number(p.replace_interval_hours));
    const partAlerts = Array.isArray(alerts) ? alerts.filter((a) => a.part_id === p.part_id) : [];

    let pass = true;
    let issues = [];

    // 5.1: Verify alert severity matches wear status
    let expectedSeverity = "info";
    if (wear.status === "overdue") expectedSeverity = "critical";
    else if (wear.status === "critical") expectedSeverity = "critical";
    else if (wear.status === "warning") expectedSeverity = "warning";

    for (const alert of partAlerts) {
      if (alert.severity !== expectedSeverity) {
        issues.push(`alert #${alert.id} severity=${alert.severity}, expected=${expectedSeverity} for wear=${wear.wearPct}%`);
        pass = false;
      }
    }

    // 5.2: No false positives — if wear is normal, there should be no alerts
    if (wear.status === "normal" && partAlerts.length > 0) {
      issues.push(`FALSE POSITIVE: wear=${wear.wearPct}% (normal) but ${partAlerts.length} alert(s) exist`);
      pass = false;
    }

    // 5.3: If critical/overdue, there MUST be an alert
    if ((wear.status === "critical" || wear.status === "overdue") && partAlerts.length === 0) {
      issues.push(`MISSING ALERT: wear=${wear.wearPct}% (${wear.status}) but no alert exists`);
      pass = false;
    }

    res.push({
      partId: p.part_id,
      partName: p.part_name ?? p.part_id,
      wearPct: wear.wearPct,
      wearStatus: wear.status,
      expectedSeverity,
      alertCount: partAlerts.length,
      pass,
      issues: issues.length ? issues.join("; ") : null,
    });
  }
  return res;
}

// ── HTML Report Generator ────────────────────────────────────
function generateReport(results, elapsed) {
  const totalScenarios = results.reduce((s, r) => s + r.scenarioResults.length, 0);
  const passCount = results.reduce((s, r) => s + r.scenarioResults.filter((sr) => sr.pass).length, 0);
  const failCount = totalScenarios - passCount;
  const overallPass = failCount === 0;

  let rows = "";
  for (const equip of results) {
    rows += `<tr class="equip-row"><td colspan="8" style="background:#f0f4f8;font-weight:700;font-size:14px">${statusIcon(equip.scenarioResults.some(r => r.pass === false) ? "critical" : "ok")} ${equip.equipCode} — ${equip.equipName}</td></tr>`;
    for (const sr of equip.scenarioResults) {
      const icon = sr.pass ? "🟢" : "🔴";
      const badge = sr.pass ? '<span class="badge badge-pass">PASS</span>' : '<span class="badge badge-fail">FAIL</span>';
      rows += `<tr>
        <td>${icon}</td>
        <td>${sr.scenarioId}</td>
        <td>${sr.scenarioName}</td>
        <td>${sr.partId}</td>
        <td>${sr.partName ?? ""}</td>
        <td>${sr.detail ?? ""}</td>
        <td>${badge}</td>
        <td style="font-size:11px;color:#666">${sr.issues ?? ""}</td>
      </tr>`;
    }
  }

  const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>Maintenance Manager Test Report</title>
<style>
  body { font-family: -apple-system, 'Segoe UI', sans-serif; margin: 20px; background: #f8fafc; color: #1e293b; }
  h1 { font-size: 22px; margin-bottom: 4px; }
  .summary-line { color: #64748b; margin-bottom: 20px; }
  .score { display: inline-block; padding: 4px 14px; border-radius: 20px; font-weight: 700; font-size: 18px; }
  .score-pass { background: #dcfce7; color: #166534; }
  .score-fail { background: #fef2f2; color: #991b1b; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 13px; }
  th { background: #1e293b; color: white; padding: 8px 10px; text-align: left; }
  td { padding: 7px 10px; border-bottom: 1px solid #e2e8f0; }
  tr:hover td { background: #f1f5f9; }
  .badge { padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; }
  .badge-pass { background: #dcfce7; color: #166534; }
  .badge-fail { background: #fef2f2; color: #991b1b; }
  .equip-row td { font-weight: 700; }
  .summary-cards { display: flex; gap: 14px; margin: 16px 0; }
  .card { background: white; border-radius: 10px; padding: 14px 20px; flex: 1; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  .card-num { font-size: 26px; font-weight: 700; }
  .card-label { font-size: 12px; color: #64748b; margin-top: 2px; }
</style></head><body>
<h1>🔧 Maintenance Manager — Fault Detection Test Report</h1>
<div class="summary-line">Generated: ${new Date().toISOString().slice(0, 19)} | Duration: ${elapsed}s | Equipment: ${results.length}</div>
<div class="summary-cards">
  <div class="card"><div class="card-num">${totalScenarios}</div><div class="card-label">Total Scenarios</div></div>
  <div class="card"><div class="card-num" style="color:#166534">${passCount}</div><div class="card-label">Passed</div></div>
  <div class="card"><div class="card-num" style="color:#991b1b">${failCount}</div><div class="card-label">Failed</div></div>
  <div class="card"><div class="card-num ${overallPass ? 'score-pass' : 'score-fail'}">${overallPass ? "ALL PASS" : "ISSUES DETECTED"}</div><div class="card-label">Overall Verdict</div></div>
</div>
<table><thead><tr><th></th><th>#</th><th>Scenario</th><th>Part</th><th>Name</th><th>Detail</th><th>Result</th><th>Issues</th></tr></thead><tbody>
${rows}
</tbody></table>
<div style="margin-top:24px;padding:14px;background:#fffbeb;border:1px solid #fbbf24;border-radius:8px;font-size:13px">
<strong>⚠️ Warnings:</strong><br>
- Scenario 3 (Consumption Spike) requires anomaly detection API feature — not yet implemented<br>
- DB connection uses postgres:123456 — verify credentials if report is empty<br>
- API server must be running at ${API_BASE} for endpoint tests to pass
</div>
</body></html>`;
  fs.writeFileSync(path.join(__dirname, "maintenance-tester-report.html"), html, "utf-8");
  console.log(`\n📄 Report: tests/maintenance-tester-report.html`);
}

// ── Main ────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const onlyReport = args.includes("--report");
  const onlyEquip = args.includes("--equipment") ? args[args.indexOf("--equipment") + 1] : null;
  const onlyScenario = args.includes("--scenario") ? parseInt(args[args.indexOf("--scenario") + 1]) : null;

  const start = Date.now();
  const scenarios = [
    { id: 1, name: "Wear Progression", fn: scenario1WearProgression },
    { id: 2, name: "Overdue Detection", fn: scenario2OverdueDetection },
    { id: 3, name: "Consumption Spike", fn: scenario3ConsumptionSpike },
    { id: 4, name: "Low Stock + High Wear", fn: scenario4LowStockHighWear },
    { id: 5, name: "Alert Escalation Fidelity", fn: scenario5AlertFidelity },
  ];

  if (onlyReport) {
    if (fs.existsSync(path.join(__dirname, "maintenance-tester-results.json"))) {
      const saved = JSON.parse(fs.readFileSync(path.join(__dirname, "maintenance-tester-results.json"), "utf-8"));
      generateReport(saved, ((Date.now() - start) / 1000).toFixed(1));
    } else {
      console.log("No saved results found. Run without --report first.");
    }
    await pool?.end();
    return;
  }

  console.log("🔧 Maintenance Manager Fault Detection Test\n");
  console.log(`${"=".repeat(72)}`);

  const equipment = onlyEquip ? EQUIPMENT.filter((e) => e.id === onlyEquip) : EQUIPMENT;
  if (onlyEquip && !equipment.length) {
    console.log(`Unknown equipment: ${onlyEquip}`);
    await pool?.end();
    return;
  }

  const runScenarios = onlyScenario ? scenarios.filter((s) => s.id === onlyScenario) : scenarios;

  allResults = [];

  for (const equip of equipment) {
    console.log(`\n📋 Equipment: ${equip.code} — ${equip.name}`);
    console.log(`─`.repeat(60));

    const parts = await query(
      `SELECT pws.*, sp.name_zh as part_name, sp.current_stock, sp.min_stock
       FROM parts_wear_schedule pws
       LEFT JOIN spare_parts sp ON sp.id = pws.part_id
       WHERE pws.equipment_id = $1`,
      [equip.id]
    );

    if (!Array.isArray(parts) || parts.length === 0) {
      console.log(`  No parts tracked for this equipment (skip)`);
      continue;
    }
    console.log(`  Parts tracked: ${parts.map((p) => p.part_id).join(", ")}`);

    const equipResult = { equipCode: equip.code, equipName: equip.name, equipId: equip.id, scenarioResults: [] };

    for (const sc of runScenarios) {
      console.log(`  ── Scenario ${sc.id}: ${sc.name} ──`);
      try {
        const results = await sc.fn(equip, parts);
        for (const r of results) {
          const icon = r.pass ? "✓" : "✗";
          console.log(`    ${icon} ${r.partId}${r.partName ? ` (${r.partName})` : ""} — ${r.pass ? "PASS" : "FAIL"}${r.issues ? " | " + r.issues : ""}`);
          equipResult.scenarioResults.push({
            scenarioId: sc.id,
            scenarioName: sc.name,
            partId: r.partId,
            partName: r.partName,
            pass: r.pass,
            issues: r.issues,
            detail: r.detail ?? (r.pass ? "OK" : "—"),
          });
        }
      } catch (e) {
        console.log(`    ✗ ERROR: ${e.message}`);
        equipResult.scenarioResults.push({
          scenarioId: sc.id,
          scenarioName: sc.name,
          partId: "—",
          partName: "—",
          pass: false,
          issues: `Exception: ${e.message}`,
          detail: "ERROR",
        });
      }
    }

    if (equipResult.scenarioResults.length > 0) allResults.push(equipResult);

    // Per-equipment score
    const eqPass = equipResult.scenarioResults.filter((r) => r.pass).length;
    const eqTotal = equipResult.scenarioResults.length;
    const pct = eqTotal > 0 ? Math.round((eqPass / eqTotal) * 100) : 0;
    const bar = "█".repeat(Math.floor(pct / 10)) + "░".repeat(10 - Math.floor(pct / 10));
    console.log(`  ${"=".repeat(40)}`);
    console.log(`  Score: ${eqPass}/${eqTotal} PASS  ${bar} ${pct}%`);
  }

  // Save results
  fs.writeFileSync(path.join(__dirname, "maintenance-tester-results.json"), JSON.stringify(allResults, null, 2));

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n${"=".repeat(72)}`);
  const totalTests = allResults.reduce((s, r) => s + r.scenarioResults.length, 0);
  const totalPass = allResults.reduce((s, r) => s + r.scenarioResults.filter((sr) => sr.pass).length, 0);
  const totalFail = totalTests - totalPass;
  console.log(`📊 Summary: ${totalPass}/${totalTests} passed (${Math.round((totalPass / totalTests) * 100)}%) | Duration: ${elapsed}s`);

  generateReport(allResults, elapsed);

  await pool?.end();
  console.log(`\n${totalFail === 0 ? "✅ ALL TESTS PASSED" : `❌ ${totalFail} SCENARIO(S) FAILED — see report for details`}`);
}

main().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
