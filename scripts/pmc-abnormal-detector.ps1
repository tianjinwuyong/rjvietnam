# ============================================================
# PMC Abnormal Detector — detects delays, shortages, NG spikes
# Requires psql (D:\d\postgresql\bin\psql.exe) and PGPASSWORD env
# ============================================================
param(
  [string]$PSQL = "D:\d\postgresql\bin\psql.exe",
  [string]$PGHOST = "127.0.0.1",
  [int] $PGPORT = 5432,
  [string]$PGDATABASE = "smt_factory",
  [string]$PGUSER = "postgres"
)

$env:PGPASSWORD = "postgres"
$ErrorActionPreference = "Continue"

function Query-Db {
  param([string]$Sql, [string]$Label)
  Write-Host ""
  Write-Host "=== $Label ===" -ForegroundColor Yellow
  $out = & $PSQL -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDATABASE -c $Sql 2>&1
  if ($LASTEXITCODE -eq 0) {
    $lines = $out -split "`n" | Where-Object { $_ -match '\|' -and $_ -notmatch '^\(' -and $_ -notmatch '^$' -and $_ -notmatch '^\(' }
    if ($lines) { $lines | ForEach-Object { Write-Host "  $_" } }
    else { Write-Host "  (no results)" -ForegroundColor Gray }
  } else {
    Write-Host "  SQL ERROR: $($out[0..2] -join ' ')" -ForegroundColor Red
  }
}

$now = Get-Date -Format "yyyy-MM-dd HH:mm"
Write-Host "=== PMC Abnormal Detector — $now ===" -ForegroundColor Magenta

# 1. Delayed WOs: completed < 50% after > 4 hours
Query-Db @"
SELECT wo.code AS wo_code,
       wo.planned_qty AS planned,
       wo.completed_qty AS completed,
       ROUND(wo.completed_qty::numeric / NULLIF(wo.planned_qty,0) * 100, 1) AS pct,
       ROUND(EXTRACT(EPOCH FROM (NOW() - wo.created_at)) / 3600, 1) AS hours_elapsed
FROM work_orders wo
WHERE wo.status IN ('released','running')
  AND wo.completed_qty::numeric / NULLIF(wo.planned_qty,0) < 0.5
  AND EXTRACT(EPOCH FROM (NOW() - wo.created_at)) / 3600 > 4
ORDER BY pct ASC
LIMIT 20;
"@ "Delayed WOs (completion < 50% after > 4h)"

# 2. Frozen WOs
Query-Db @"
SELECT wo.code, wo.status, wocl.reason, wocl.changed_at
FROM work_orders wo
JOIN work_order_change_log wocl ON wocl.work_order_id = wo.id
WHERE wo.status = 'frozen'
ORDER BY wocl.changed_at DESC
LIMIT 20;
"@ "Frozen WOs"

# 3. Material shortages (BOM-based, correct schema)
Query-Db @"
SELECT wo.code AS wo_code,
       m.code AS mat_code,
       ROUND((bl.qty_per * wo.planned_qty * (1 + COALESCE(bl.loss_rate,0)))::numeric, 0) AS required_qty,
       COALESCE(SUM(it.qty),0)::int AS issued_qty,
       ROUND((bl.qty_per * wo.planned_qty * (1 + COALESCE(bl.loss_rate,0)))::numeric, 0) - COALESCE(SUM(it.qty),0)::int AS shortfall
FROM work_orders wo
JOIN boms b ON b.product_id = wo.product_id AND b.status = 'active'
JOIN bom_lines bl ON bl.bom_id = b.id
JOIN materials m ON m.id = bl.material_id
LEFT JOIN inventory_transactions it ON it.work_order_id = wo.id
  AND it.action IN ('ISSUE_TO_LINE')
WHERE wo.status IN ('released','running')
GROUP BY wo.code, m.code, bl.qty_per, bl.loss_rate, wo.planned_qty
HAVING ROUND((bl.qty_per * wo.planned_qty * (1 + COALESCE(bl.loss_rate,0)))::numeric, 0) - COALESCE(SUM(it.qty),0)::int > 0
ORDER BY shortfall DESC
LIMIT 20;
"@ "Material Shortages (BOM vs issued)"

# 4. NG spike (last 8 hours)
Query-Db @"
SELECT se.traceability_key AS wo_code,
       COUNT(*) AS ng_events,
       COUNT(*)::numeric / NULLIF(wo.planned_qty,0) * 100 AS ng_rate_pct
FROM station_events se
JOIN work_orders wo ON wo.code = se.traceability_key
WHERE se.event_type = 'output'
  AND se.result ~* 'ng'
  AND se.occurred_at > NOW() - INTERVAL '8 hours'
GROUP BY se.traceability_key, wo.planned_qty
HAVING COUNT(*)::numeric / NULLIF(wo.planned_qty,0) * 100 > 1.0
ORDER BY ng_rate_pct DESC
LIMIT 10;
"@ "NG Spike (last 8h, rate > 1%)"

# 5. WOs without BOM (cannot track material)
Query-Db @"
SELECT wo.code, wo.status, p.code AS product_code
FROM work_orders wo
JOIN products p ON p.id = wo.product_id
WHERE wo.status IN ('draft','released')
  AND NOT EXISTS (
    SELECT 1 FROM boms b WHERE b.product_id = wo.product_id AND b.status = 'active'
  )
ORDER BY wo.created_at DESC
LIMIT 10;
"@ "WOs Without Active BOM"

# 6. Line utilization (station idle time)
Query-Db @"
SELECT s.code AS station_code,
       pl.internal_code AS line_code,
       COUNT(*) AS events_last_4h,
       MIN(se.occurred_at) AS first_event,
       MAX(se.occurred_at) AS last_event
FROM station_events se
JOIN stations s ON s.id = se.station_id
JOIN production_lines pl ON pl.id = s.line_id
WHERE se.occurred_at > NOW() - INTERVAL '4 hours'
GROUP BY s.code, pl.internal_code
ORDER BY events_last_4h ASC
LIMIT 10;
"@ "Low-Activity Stations (last 4h)"

Write-Host ""
Write-Host "Detection complete: $now" -ForegroundColor Gray