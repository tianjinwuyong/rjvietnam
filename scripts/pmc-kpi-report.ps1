# ============================================================
# PMC KPI Report - shift/day summary
# ============================================================
param(
  [string]$PSQL = "D:\d\postgresql\bin\psql.exe",
  [string]$PGHOST = "127.0.0.1",
  [int] $PGPORT = 5432,
  [string]$PGDATABASE = "smt_factory",
  [string]$PGUSER = "postgres",
  [ValidateSet("A","B","C","Day")] [string]$Shift = "A"
)

$env:PGPASSWORD = "postgres"
$ErrorActionPreference = "Continue"

$now = Get-Date -Format "yyyy-MM-dd HH:mm"
$today = Get-Date -Format "yyyy-MM-dd"
$shiftLabel = if ($Shift -eq "Day") { "Day Shift" } else { "Shift $Shift" }

Write-Host ""
Write-Host ("=" * 70) -ForegroundColor Magenta
Write-Host "  PMC KPI REPORT  $shiftLabel  $today" -ForegroundColor Magenta
Write-Host ("=" * 70) -ForegroundColor Magenta

function Q {
  param([string]$Sql)
  $out = & $PSQL -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDATABASE -c $Sql 2>&1
  if ($LASTEXITCODE -eq 0) {
    $val = ($out -split "`n" | Where-Object { $_ -match '^\s*\d' } | Select-Object -First 1) -replace '\s+', '' -replace '^\|', '' -replace '\|$', ''
    return $val.Trim()
  }
  return "ERR"
}

$woTotal     = Q "SELECT count(*) FROM work_orders WHERE DATE(created_at) = '$today';"
$woActive    = Q "SELECT count(*) FROM work_orders WHERE status IN ('released','running') AND DATE(created_at) <= '$today';"
$woCompleted = Q "SELECT count(*) FROM work_orders WHERE status = 'completed' AND DATE(updated_at) = '$today';"
$woDelayed   = Q "SELECT count(*) FROM work_orders wo WHERE wo.status IN ('released','running') AND wo.completed_qty::numeric/NULLIF(wo.planned_qty,0) < 0.5 AND EXTRACT(EPOCH FROM (NOW() - wo.created_at))/3600 > 4;"
$woFrozen    = Q "SELECT count(*) FROM work_orders WHERE status = 'frozen';"

Write-Host ""
Write-Host "--- WO Overview ---" -ForegroundColor Cyan
Write-Host "  Total Created Today:  $woTotal"
Write-Host "  Active/Released:      $woActive"
Write-Host "  Completed Today:      $woCompleted"
$dColor = if ([int]$woDelayed -gt 0) { "Red" } else { "Green" }
Write-Host "  Delayed (>4h, <50%):  $woDelayed" -ForegroundColor $dColor
$fColor = if ([int]$woFrozen -gt 0) { "Red" } else { "Green" }
Write-Host "  Frozen:               $woFrozen" -ForegroundColor $fColor

$outVal = Q "SELECT COALESCE(SUM(v.out_qty)::int, 0) FROM (SELECT (REGEXP_MATCHES(result, '(\d+)'))[1]::int AS out_qty FROM station_events WHERE event_type = 'output' AND occurred_at::date = '$today') v;"
$ngCount = Q "SELECT count(*) FROM station_events WHERE event_type = 'output' AND result ~* 'ng' AND occurred_at::date = '$today';"
$ngRate = if ([int]$outVal -gt 0) { [math]::Round([int]$ngCount/[int]$outVal*100, 2) } else { 0 }

Write-Host ""
Write-Host "--- Production Output (Today) ---" -ForegroundColor Cyan
Write-Host "  Total Output:   $outVal pcs"
Write-Host "  NG Events:      $ngCount"
$ngColor = if ($ngRate -gt 2) { "Red" } elseif ($ngRate -gt 1) { "Yellow" } else { "Green" }
Write-Host "  NG Rate:        $ngRate%" -ForegroundColor $ngColor

$reqQty  = Q "SELECT COALESCE(SUM(bl.qty_per * wo.planned_qty * (1 + COALESCE(bl.loss_rate,0)))::numeric, 0)::int FROM work_orders wo JOIN boms b ON b.product_id = wo.product_id AND b.status = 'active' JOIN bom_lines bl ON bl.bom_id = b.id WHERE wo.status IN ('released','running');"
$issQty  = Q "SELECT COALESCE(SUM(qty),0)::int FROM inventory_transactions WHERE action = 'ISSUE_TO_LINE' AND occurred_at::date = '$today';"
$fulfillRate = if ([int]$reqQty -gt 0) { [math]::Round([int]$issQty/[int]$reqQty*100, 1) } else { 100 }

Write-Host ""
Write-Host "--- Material Fulfillment ---" -ForegroundColor Cyan
Write-Host "  Required (active WOs):  $reqQty"
Write-Host "  Issued Today:           $issQty"
$fvColor = if ($fulfillRate -lt 80) { "Red" } elseif ($fulfillRate -lt 95) { "Yellow" } else { "Green" }
Write-Host "  Fulfillment Rate:       $fulfillRate%" -ForegroundColor $fvColor

Write-Host ""
Write-Host "--- Top NG Patterns (last 24h) ---" -ForegroundColor Cyan
$ngOut = & $PSQL -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDATABASE -c "SELECT result, count(*) FROM station_events WHERE event_type = 'output' AND result ~* 'ng' AND occurred_at > NOW() - INTERVAL '24 hours' GROUP BY result ORDER BY count(*) DESC LIMIT 5;" 2>&1
$ngLines = $ngOut | Where-Object { $_ -match '\|' -and $_ -notmatch '^\(' }
if ($ngLines) { $ngLines | ForEach-Object { Write-Host "  $_" } } else { Write-Host "  (no NG data)" -ForegroundColor Gray }

Write-Host ""
Write-Host "--- Station Activity (last 8h, top 5) ---" -ForegroundColor Cyan
$stOut = & $PSQL -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDATABASE -c "SELECT s.code, pl.internal_code AS line, COUNT(*) AS events FROM station_events se JOIN stations s ON s.id = se.station_id JOIN production_lines pl ON pl.id = s.line_id WHERE se.occurred_at > NOW() - INTERVAL '8 hours' GROUP BY s.code, pl.internal_code ORDER BY events DESC LIMIT 5;" 2>&1
$stLines = $stOut | Where-Object { $_ -match '\|' -and $_ -notmatch '^\(' }
if ($stLines) { $stLines | ForEach-Object { Write-Host "  $_" } } else { Write-Host "  (no data)" -ForegroundColor Gray }

Write-Host ""
Write-Host "--- AI Recommendations ---" -ForegroundColor Cyan
if ([int]$woDelayed -gt 0) {
  Write-Host "  1. Review delayed WOs -- output behind schedule. Check line capacity." -ForegroundColor Yellow
}
if ($ngRate -gt 2) {
  Write-Host "  2. NG rate elevated ($ngRate%) -- investigate top NG pattern." -ForegroundColor Yellow
}
if ($fulfillRate -lt 80) {
  Write-Host "  3. Material fulfillment at ${fulfillRate}% -- issue materials immediately." -ForegroundColor Red
}
if ([int]$woFrozen -gt 0) {
  Write-Host "  4. $($woFrozen) frozen WOs -- review and resolve." -ForegroundColor Red
}
if ([int]$woDelayed -eq 0 -and $ngRate -le 1 -and $fulfillRate -ge 95) {
  Write-Host "  1. All KPIs normal." -ForegroundColor Green
}

Write-Host ""
Write-Host ("=" * 70) -ForegroundColor Magenta
Write-Host "  Generated: $now  |  $shiftLabel" -ForegroundColor Gray
Write-Host ("=" * 70) -ForegroundColor Magenta