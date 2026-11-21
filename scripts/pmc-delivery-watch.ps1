# ============================================================
# PMC Delivery Watch — Patrol All WOs for Delivery Proximity
# Runs every patrol cycle; warns when WOs are approaching or overdue
# ============================================================
param(
  [string]$PSQL = "D:\d\postgresql\bin\psql.exe",
  [string]$PGHOST = "127.0.0.1",
  [int] $PGPORT = 5432,
  [string]$PGDATABASE = "smt_factory",
  [string]$PGUSER = "postgres",
  [string]$BaseUrl = "http://127.0.0.1:8080",
  # Warning thresholds (hours before due_date)
  [int]$CriticalHours = 0,       # overdue or <= 0h
  [int]$WarningHours = 24,      # <= 24h to due
  [int]$CautionHours = 48       # <= 48h to due
)

$env:PGPASSWORD = "postgres"
$ErrorActionPreference = "Continue"
$now = Get-Date -Format "yyyy-MM-dd HH:mm"

# ── Helper: Get escalation count by type ────────────────
function Get-Escalation-Count($Type) {
  $r = & $PSQL -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDATABASE -c "SELECT COUNT(*) FROM pmc_escalation_log WHERE alert_type = '$Type' AND resolved_at IS NULL;" 2>&1 | Where-Object { $_ -match '^\s*\d' }
  return [int]($r -replace '\s', '')
}

# ── Patrol all WOs with a due_date ──────────────────────
Write-Host ""
Write-Host "=== PMC Delivery Watch — $now ===" -ForegroundColor Cyan
Write-Host ""

# Get all non-closed WOs with due dates
$patrolSql = @"
SELECT
  wo.code,
  wo.status,
  p.code AS product_code,
  wo.planned_qty,
  wo.completed_qty,
  ROUND(wo.completed_qty::numeric / NULLIF(wo.planned_qty, 0) * 100, 1) AS completion_pct,
  wo.due_date AT TIME ZONE 'Asia/Ho_Chi_Minh' AS due_date_local,
  ROUND(EXTRACT(EPOCH FROM (wo.due_date - NOW())) / 3600, 1) AS hours_to_due,
  CASE
    WHEN wo.due_date < NOW() THEN 'OVERDUE'
    WHEN EXTRACT(EPOCH FROM (wo.due_date - NOW())) / 3600 <= $WarningHours THEN 'WARNING'
    WHEN EXTRACT(EPOCH FROM (wo.due_date - NOW())) / 3600 <= $CautionHours THEN 'CAUTION'
    ELSE 'ON_TRACK'
  END AS urgency
FROM work_orders wo
JOIN products p ON p.id = wo.product_id
WHERE wo.status NOT IN ('closed', 'completed', 'cancelled', 'voided')
  AND wo.due_date IS NOT NULL
ORDER BY hours_to_due ASC;
"@

$out = & $PSQL -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDATABASE -c $patrolSql 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Host "  SQL ERROR: $($out[0..2] -join ' ')" -ForegroundColor Red
  exit 1
}

$lines = $out -split "`n" | Where-Object { $_ -match '\|' -and $_ -notmatch '^\(' -and $_ -notmatch '\bcode\b' -and $_ -notmatch '^\s*$' }

$overdue = @(); $warning = @(); $caution = @(); $onTrack = @()

if ($lines) {
  foreach ($line in $lines) {
    $fields = $line -split '\|' | ForEach-Object { $_.Trim() -replace '^\||\|$' }
    $woCode = $fields[0]
    $status = $fields[1]
    $product = $fields[2]
    $planned = $fields[3]
    $completed = $fields[4]
    $pct = $fields[5]
    $dueDate = $fields[6]
    $hrsToDue = $fields[7]
    $urgency = $fields[8]

    $shortfall = [int]$planned - [int]$completed
    $desc = "WO $woCode ($product) due $dueDate — $pct% complete ($completed/$planned), $([math]::Abs([double]$hrsToDue))h $(if ([double]$hrsToDue -lt 0) { "OVERDUE" } else { "remaining" })"
    $action = if ([double]$hrsToDue -lt 0) {
      "URGENT: WO $woCode is overdue. Expedite output immediately or renegotiate delivery date."
    } else {
      "WO $woCode due in $([math]::Abs([double]$hrsToDue))h — ensure materials and line capacity are ready."
    }

    # Log new escalations (avoid duplicates)
    $insSql = "INSERT INTO pmc_escalation_log (wo_code, alert_type, severity, description, recommended_action)
               VALUES ('$woCode', 'delivery_watch', '$(if ($urgency -eq 'OVERDUE') { 'critical' } elseif ($urgency -eq 'WARNING') { 'critical' } else { 'warning' })', E'$desc', E'$action')
               ON CONFLICT DO NOTHING;"
    & $PSQL -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDATABASE -c $insSql 2>&1 | Out-Null

    $displayLine = "  [$urgency] $desc"
    switch ($urgency) {
      'OVERDUE' { $overdue += $displayLine }
      'WARNING' { $warning += $displayLine }
      'CAUTION' { $caution += $displayLine }
      'ON_TRACK' { $onTrack += $displayLine }
    }
  }
}

# ── Summary ───────────────────────────────────────────────
if ($overdue.Count -gt 0) {
  Write-Host "  OVERDUE (past due date) — $($overdue.Count) WO(s)" -ForegroundColor Red
  $overdue | ForEach-Object { Write-Host ("  $_".Substring(0, [Math]::Min(160, "  $_".Length))) -ForegroundColor Red }
}

if ($warning.Count -gt 0) {
  Write-Host ""
  Write-Host ("  WARNING (<= " + $WarningHours + "h) — " + $warning.Count + " WO(s)") -ForegroundColor Red
  $warning | ForEach-Object { Write-Host ("  " + $_.Substring(0, [Math]::Min(160, $_.Length))) -ForegroundColor Red }
}

if ($caution.Count -gt 0) {
  Write-Host ""
  Write-Host ("  CAUTION (<= " + $CautionHours + "h) — " + $caution.Count + " WO(s)") -ForegroundColor Yellow
  $caution | ForEach-Object { Write-Host ("  " + $_.Substring(0, [Math]::Min(160, $_.Length))) -ForegroundColor Yellow }
}

if ($onTrack.Count -gt 0) {
  Write-Host ""
  Write-Host ("  ON_TRACK (> " + $CautionHours + "h) — " + $onTrack.Count + " WO(s)") -ForegroundColor Green
  $onTrack | Select-Object -First 5 | ForEach-Object { Write-Host ("  $_".Substring(0, [Math]::Min(160, "  $_".Length))) -ForegroundColor Green }
  if ($onTrack.Count -gt 5) { Write-Host "  ... and $($onTrack.Count - 5) more" -ForegroundColor Gray }
}

if ($overdue.Count -eq 0 -and $warning.Count -eq 0 -and $caution.Count -eq 0 -and $onTrack.Count -eq 0) {
  Write-Host "  No WOs with due dates found." -ForegroundColor Gray
}

Write-Host ""
Write-Host "--- Delivery Watch Summary ---" -ForegroundColor Cyan
Write-Host "  OVERDUE: $($overdue.Count)"
Write-Host ("  WARNING (<= " + $WarningHours + "h): " + $warning.Count)
Write-Host ("  CAUTION (<= " + $CautionHours + "h): " + $caution.Count)
Write-Host "  ON_TRACK: $($onTrack.Count)"

$totalEscalations = (Get-Escalation-Count -Type "delivery_watch")
Write-Host "  Active delivery_watch escalations in DB: $totalEscalations"

Write-Host ""
Write-Host "  Patrol complete: $now" -ForegroundColor Gray
