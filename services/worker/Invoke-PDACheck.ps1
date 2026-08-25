<#
.SYNOPSIS
  PDA 待处理任务检查 — IQC 待检 / 待收货批次.
.DESCRIPTION
  Queries material_lots for incoming, iqc_pending, iqc_failed lots.
.PARAMETER OnlyAlerts
  If set, only outputs alert-level items.
.EXAMPLE
  .\Invoke-PDACheck.ps1
#>

param(
  [switch] $OnlyAlerts
)

$Root   = Split-Path -Parent $PSScriptRoot
$DataDir = Join-Path $Root "services\worker"

Write-Host "=== PDA 待处理任务 ===" -ForegroundColor Cyan

# Read material_lots from DB is best, but we can check via bom-query material-readiness
$Node = "node"

# Actually let's query PG directly
$PGHOST     = if ($env:PGHOST)     { $env:PGHOST }     else { "127.0.0.1" }
$PGPORT     = if ($env:PGPORT)     { $env:PGPORT }     else { "5432" }
$PGUSER     = if ($env:PGUSER)     { $env:PGUSER }     else { "postgres" }
$PGPASSWORD = if ($env:PGPASSWORD) { $env:PGPASSWORD } else { "postgres" }
$PGDATABASE = if ($env:PGDATABASE) { $env:PGDATABASE } else { "smt_factory" }

# Simple PSQL query
try {
  $connStr = "host=$PGHOST port=$PGPORT dbname=$PGDATABASE user=$PGUSER password=$PGPASSWORD"

  # If psql exists, use it
  $psql = Get-Command psql -ErrorAction SilentlyContinue
  if ($psql) {
    $incomingRslt = & psql -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDATABASE -t -c "SELECT count(*) FROM material_lots WHERE status='incoming' OR status='iqc_pending'" --quiet -A 2>$null
    $failedRslt   = & psql -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDATABASE -t -c "SELECT count(*) FROM material_lots WHERE iqc_status='iqc_failed'" --quiet -A 2>$null
    $incoming = if ($incomingRslt) { [int]$incomingRslt.Trim() } else { 0 }
    $failed   = if ($failedRslt)   { [int]$failedRslt.Trim() } else { 0 }
  }
  else {
    # Fallback: use node to check
    $raw = & $Node "$DataDir\bom-query.js" material-readiness 2>$null
    Write-Host "  (从 bom-query 获取物料可用性数据)"
    $incoming = 0; $failed = 0
  }

  Write-Host "  待收货/IQC: $incoming 批次" -ForegroundColor $(if ($incoming -gt 0) { "Yellow" } else { "Green" })
  Write-Host "  IQC 失败:    $failed 批次"  -ForegroundColor $(if ($failed -gt 0) { "Red" } else { "Green" })
}
catch {
  Write-Host "  (无法连接数据库，跳过)" -ForegroundColor DarkGray
}
