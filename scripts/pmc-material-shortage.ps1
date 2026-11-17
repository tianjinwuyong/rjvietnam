# ============================================================
# PMC Material Shortage Report
# ============================================================
param(
  [string]$PSQL = "D:\d\postgresql\bin\psql.exe",
  [string]$PGHOST = "127.0.0.1",
  [int] $PGPORT = 5432,
  [string]$PGDATABASE = "smt_factory",
  [string]$PGUSER = "postgres",
  [string]$BaseUrl = "http://127.0.0.1:8080"
)

$env:PGPASSWORD = "postgres"
$ErrorActionPreference = "Continue"

$now = Get-Date -Format "yyyy-MM-dd HH:mm"
Write-Host "=== PMC Material Shortage Report — $now ===" -ForegroundColor Magenta

# Get active WOs with BOM shortfall
$sql = @"
SELECT wo.code AS wo_code,
       wo.status,
       m.code AS mat_code,
       m.name_zh AS mat_name,
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
GROUP BY wo.code, wo.status, m.code, m.name_zh, bl.qty_per, bl.loss_rate, wo.planned_qty
HAVING ROUND((bl.qty_per * wo.planned_qty * (1 + COALESCE(bl.loss_rate,0)))::numeric, 0) - COALESCE(SUM(it.qty),0)::int > 0
ORDER BY shortfall DESC, wo.code;
"@

Write-Host ""
Write-Host "--- Shortage Detail ---" -ForegroundColor Yellow
$out = & $PSQL -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDATABASE -c $sql 2>&1
if ($LASTEXITCODE -eq 0) {
  $lines = $out -split "`n" | Where-Object { $_ -match '\|' -and $_ -notmatch '^\(' -and $_ -notmatch '\bcode\b' -and $_ -notmatch '^\s*$' }
  if ($lines) {
    Write-Host ($lines | Select-Object -First 30) -ForegroundColor White
    $count = ($lines | Measure-Object).Count - 3
    if ($count -gt 27) { Write-Host "  ... and $($count - 27) more rows" -ForegroundColor Gray }
  } else {
    Write-Host "  No material shortages detected." -ForegroundColor Green
  }
} else {
  Write-Host "  SQL ERROR: $($out[0..2] -join ' ')" -ForegroundColor Red
}

# Check available stock for top missing materials
Write-Host ""
Write-Host "--- Available Released Stock (all lots) ---" -ForegroundColor Yellow
$stockSql = @"
SELECT m.code AS mat_code, ml.lot_no, ml.received_qty, sl.code AS location, ml.iqc_status
FROM material_lots ml
JOIN materials m ON m.id = ml.material_id
LEFT JOIN storage_locations sl ON sl.id = ml.storage_location_id
WHERE ml.iqc_status = 'released'
  AND ml.lot_status = 'open'
  AND ml.received_qty > 0
ORDER BY m.code, ml.lot_no;
"@

$stockOut = & $PSQL -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDATABASE -c $stockSql 2>&1
if ($LASTEXITCODE -eq 0) {
  $stockLines = $stockOut -split "`n" | Where-Object { $_ -match '\|' -and $_ -notmatch '^\(' -and $_ -notmatch '\bcode\b' -and $_ -notmatch '^\s*$' }
  if ($stockLines) { $stockLines | Select-Object -First 20 | ForEach-Object { Write-Host "  $_" } }
  else { Write-Host "  No released stock available." -ForegroundColor Gray }
} else {
  Write-Host "  SQL ERROR: $($stockOut[0])" -ForegroundColor Red
}

Write-Host ""
Write-Host "Report generated: $now" -ForegroundColor Gray