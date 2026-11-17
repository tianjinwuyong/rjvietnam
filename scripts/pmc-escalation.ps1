# ============================================================
# PMC Escalation Handler
# Reads abnormal conditions from pmc_escalation_log unresolved items
# and generates alerts/recommendations
# ============================================================
param(
  [string]$PSQL = "D:\d\postgresql\bin\psql.exe",
  [string]$PGHOST = "127.0.0.1",
  [int] $PGPORT = 5432,
  [string]$PGDATABASE = "smt_factory",
  [string]$PGUSER = "postgres",
  [string]$BaseUrl = "http://127.0.0.1:8080",
  [ValidateSet("critical","warning","all")] [string]$MinSeverity = "warning"
)

$env:PGPASSWORD = "postgres"
$ErrorActionPreference = "Continue"
$now = Get-Date -Format "yyyy-MM-dd HH:mm"

Write-Host ""
Write-Host ("=" * 70) -ForegroundColor Red
Write-Host "  PMC ESCALATION REPORT  $now" -ForegroundColor Red
Write-Host ("=" * 70) -ForegroundColor Red

# ── Escalation Types ─────────────────────────────────────────
# 'material_shortage' | 'wo_delay' | 'ng_spike' | 'line_stop' | 'bom_missing' | 'wo_frozen'

function Get-Escalations {
  param([string]$Severity)
  $cond = if ($Severity -eq "critical") { "AND severity = 'critical'" } elseif ($Severity -eq "warning") { "AND severity IN ('critical','warning')" } else { "" }
  $sql = @"
SELECT id, occurred_at, wo_code, alert_type, severity, description, recommended_action
FROM pmc_escalation_log
WHERE resolved_at IS NULL $cond
ORDER BY
  CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
  occurred_at DESC
LIMIT 50;
"@
  & $PSQL -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDATABASE -c $sql 2>&1 | Where-Object { $_ -match '\|' -and $_ -notmatch '^\(' }
}

function Get-Escalation-Count {
  param([string]$Type)
  $sql = "SELECT count(*) FROM pmc_escalation_log WHERE resolved_at IS NULL AND alert_type = '$Type';"
  $out = & $PSQL -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDATABASE -c $sql 2>&1
  if ($LASTEXITCODE -eq 0) {
    return (($out -split "`n" | Where-Object { $_ -match '^\s*\d' } | Select-Object -First 1) -replace '\D', '').Trim()
  }
  return "0"
}

# ── Generate New Escalations from Current State ────────────
Write-Host ""
Write-Host "--- Checking Current State for New Escalations ---" -ForegroundColor Yellow

# 1. Delayed WOs
$delayedSql = @"
SELECT wo.code, ROUND(EXTRACT(EPOCH FROM (NOW() - wo.created_at))/3600, 1) AS delay_hours,
       ROUND(wo.completed_qty::numeric/NULLIF(wo.planned_qty,0)*100, 1) AS pct
FROM work_orders wo
WHERE wo.status IN ('released','running')
  AND wo.completed_qty::numeric/NULLIF(wo.planned_qty,0) < 0.5
  AND EXTRACT(EPOCH FROM (NOW() - wo.created_at))/3600 > 4
  AND NOT EXISTS (SELECT 1 FROM pmc_escalation_log e WHERE e.wo_code = wo.code AND e.alert_type = 'wo_delay' AND e.resolved_at IS NULL);
"@
$delayedOut = & $PSQL -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDATABASE -c $delayedSql 2>&1 | Where-Object { $_ -match '\|' -and $_ -notmatch '^\(' -and $_ -notmatch '\bcode\b' }
if ($delayedOut) {
  foreach ($line in $delayedOut) {
    $fields = $line -split '\|' | ForEach-Object { $_.Trim() -replace '^\||\|$' }
    $woCode = $fields[0]; $delayHrs = $fields[1]; $pct = $fields[2]
    $desc = "WO $woCode delayed: completed $pct% after ${delayHrs}h (target <50%)"
    $action = "Review line capacity, check material supply, consider expediting or splitting WO"
    $insSql = "INSERT INTO pmc_escalation_log (wo_code, alert_type, severity, description, recommended_action) VALUES ('$woCode', 'wo_delay', 'critical', E'$desc', E'$action') ON CONFLICT DO NOTHING;"
    $insOut = & $PSQL -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDATABASE -c $insSql 2>&1
    $inserted = $insOut | Where-Object { $_ -match '^\s*INSERT 0 1' }
    if ($inserted) { Write-Host "  [NEW] wo_delay: $desc" -ForegroundColor Red }
  }
}

# 2. WOs without BOM
$bomSql = @"
SELECT wo.code, p.code AS product_code
FROM work_orders wo
JOIN products p ON p.id = wo.product_id
WHERE wo.status IN ('draft','released')
  AND NOT EXISTS (SELECT 1 FROM boms b WHERE b.product_id = wo.product_id AND b.status = 'active')
  AND NOT EXISTS (SELECT 1 FROM pmc_escalation_log e WHERE e.wo_code = wo.code AND e.alert_type = 'bom_missing' AND e.resolved_at IS NULL);
"@
$bomOut = & $PSQL -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDATABASE -c $bomSql 2>&1 | Where-Object { $_ -match '\|' -and $_ -notmatch '^\(' -and $_ -notmatch '\bcode\b' }
if ($bomOut) {
  foreach ($line in $bomOut) {
    $fields = $line -split '\|' | ForEach-Object { $_.Trim() -replace '^\||\|$' }
    $woCode = $fields[0]; $prod = $fields[1]
    $desc = "WO $woCode (product $prod) has no active BOM -- material tracking impossible"
    $action = "Assign or create active BOM for product $prod before releasing WO"
    $insSql = "INSERT INTO pmc_escalation_log (wo_code, alert_type, severity, description, recommended_action) VALUES ('$woCode', 'bom_missing', 'critical', E'$desc', E'$action') ON CONFLICT DO NOTHING;"
    $insOut = & $PSQL -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDATABASE -c $insSql 2>&1
    $inserted = $insOut | Where-Object { $_ -match '^\s*INSERT 0 1' }
    if ($inserted) { Write-Host "  [NEW] bom_missing: $desc" -ForegroundColor Red }
  }
}

# 3. Material shortages (critical only)
$shortSql = @"
SELECT wo.code, m.code, (bl.qty_per * wo.planned_qty * (1 + COALESCE(bl.loss_rate,0)))::numeric - COALESCE(SUM(it.qty),0)::numeric AS shortfall
FROM work_orders wo
JOIN boms b ON b.product_id = wo.product_id AND b.status = 'active'
JOIN bom_lines bl ON bl.bom_id = b.id
JOIN materials m ON m.id = bl.material_id
LEFT JOIN inventory_transactions it ON it.work_order_id = wo.id AND it.action IN ('ISSUE_TO_LINE')
WHERE wo.status IN ('released','running')
GROUP BY wo.code, m.code, bl.qty_per, bl.loss_rate, wo.planned_qty
HAVING (bl.qty_per * wo.planned_qty * (1 + COALESCE(bl.loss_rate,0)))::numeric - COALESCE(SUM(it.qty),0)::numeric > 0
ORDER BY shortfall DESC
LIMIT 10;
"@
$shortOut = & $PSQL -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDATABASE -c $shortSql 2>&1 | Where-Object { $_ -match '\|' -and $_ -notmatch '^\(' -and $_ -notmatch '\bcode\b' }
if ($shortOut) {
  foreach ($line in $shortOut) {
    $fields = $line -split '\|' | ForEach-Object { $_.Trim() -replace '^\||\|$' }
    $woCode = $fields[0]; $mat = $fields[1]; $sh = $fields[2]
    $alertType = "material_shortage:" + $mat   # per-material granularity for unique constraint
    $desc = "Material shortage: $mat shortfall $sh for WO $woCode"
    $action = "Check released stock for $mat, issue to WO or raise urgent PO"
    $insSql = "INSERT INTO pmc_escalation_log (wo_code, alert_type, severity, description, recommended_action) VALUES ('$woCode', '$alertType', 'critical', E'$desc', E'$action') ON CONFLICT DO NOTHING;"
    $insOut = & $PSQL -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDATABASE -c $insSql 2>&1
    $inserted = $insOut | Where-Object { $_ -match '^\s*INSERT 0 1' }
    if ($inserted) { Write-Host "  [NEW] material_shortage: $desc" -ForegroundColor Red }
  }
}

# ── Display Unresolved Escalations ─────────────────────────
Write-Host ""
Write-Host "--- Unresolved Escalations ---" -ForegroundColor Cyan
$rows = Get-Escalations -Severity $MinSeverity
if ($rows) {
  $rows | ForEach-Object { Write-Host "  $_" }
} else {
  Write-Host "  No unresolved escalations." -ForegroundColor Green
}

# ── Summary Counts ─────────────────────────────────────────
Write-Host ""
Write-Host "--- Summary ---" -ForegroundColor Cyan
$delayCnt = Get-Escalation-Count -Type "wo_delay"
# material_shortage alert types are now 'material_shortage:<mat_code>'
$matCnt   = ((& $PSQL -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDATABASE -c "SELECT count(*) FROM pmc_escalation_log WHERE resolved_at IS NULL AND alert_type LIKE 'material_shortage%';" 2>&1) -split "`n" | Where-Object { $_ -match '^\s*\d' } | Select-Object -First 1) -replace '\D', ''
$ngCnt    = Get-Escalation-Count -Type "ng_spike"
$bomCnt   = Get-Escalation-Count -Type "bom_missing"
$frzCnt   = Get-Escalation-Count -Type "wo_frozen"
Write-Host "  wo_delay:          $delayCnt"
Write-Host "  material_shortage:  $matCnt"
Write-Host "  ng_spike:          $ngCnt"
Write-Host "  bom_missing:       $bomCnt"
Write-Host "  wo_frozen:         $frzCnt"

# ── Auto-Resolve Stale Escalations ─────────────────────────
Write-Host ""
Write-Host "--- Auto-Resolving Stale Escalations (>24h, no action needed) ---" -ForegroundColor Gray
$resolveSql = @"
UPDATE pmc_escalation_log
SET resolved_at = NOW(), resolved_by = 'pmc-agent-auto'
WHERE resolved_at IS NULL
  AND occurred_at < NOW() - INTERVAL '24 hours'
  AND alert_type IN ('wo_delay','material_shortage')
  AND NOT EXISTS (
    SELECT 1 FROM work_orders wo WHERE wo.code = pmc_escalation_log.wo_code AND wo.status IN ('released','running')
  );
"@
$resolveOut = & $PSQL -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDATABASE -c $resolveSql 2>&1
if ($LASTEXITCODE -eq 0) { Write-Host "  Auto-resolved stale escalations." -ForegroundColor Gray }

Write-Host ""
Write-Host ("=" * 70) -ForegroundColor Red
Write-Host "  Generated: $now" -ForegroundColor Gray
Write-Host ("=" * 70) -ForegroundColor Red