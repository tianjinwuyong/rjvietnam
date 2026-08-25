<#
.SYNOPSIS
  BOM 自动巡检 — 检查 BOM 健康度、成本、待审批 ECO.
.DESCRIPTION
  Runs bom-query.js (bom-audit, bom-health, eco-list) and reports issues.
.PARAMETER BomId
  Optional BOM ID to check. If omitted, checks all.
.PARAMETER ReportOnly
  If set, only prints the report without alerts.
.EXAMPLE
  .\Invoke-BOMCheck.ps1 -BomId 5
#>

param(
  [int]    $BomId,
  [switch] $ReportOnly
)

$Root   = Split-Path -Parent $PSScriptRoot
$Worker = Join-Path $Root "services\worker"
$Node   = "node"

Write-Host "=== BOM 自动巡检 ===" -ForegroundColor Cyan

# 1) Run audit
Write-Host "[1/3] BOM 审计..." -NoNewline
$auditRaw = & $Node "$Worker\bom-query.js" bom-audit 2>$null
$audit    = $auditRaw | ConvertFrom-Json
$issues   = ($audit.bomAudit.orphanLines.Count  ?? 0) +
            ($audit.bomAudit.phantomBoms.Count   ?? 0) +
            ($audit.bomAudit.duplicates.Count    ?? 0) +
            ($audit.bomAudit.zeroQtyLines.Count  ?? 0)
Write-Host " 发现 $issues 个问题" -ForegroundColor $(if ($issues -gt 0) { "Yellow" } else { "Green" })

# 2) Run health
Write-Host "[2/3] BOM 健康度..." -NoNewline
$healthRaw = & $Node "$Worker\bom-query.js" bom-health 2>$null
$health    = $healthRaw | ConvertFrom-Json
Write-Host " 活跃: $($health.bomHealth.active) / 总计: $($health.bomHealth.total_boms)"

# 3) ECO list
Write-Host "[3/3] 待审批 ECO..." -NoNewline
$ecoRaw = & $Node "$Worker\bom-query.js" eco-list 2>$null
$eco    = $ecoRaw | ConvertFrom-Json
$pendingEcos = $eco.ecoList | Where-Object { $_.status -eq "pending" }
Write-Host " $($pendingEcos.Count) 个待审批"

if ($issues -gt 0 -or $pendingEcos.Count -gt 0) {
  Write-Host ""
  Write-Host "=== 摘要 ===" -ForegroundColor Yellow
  if ($issues -gt 0)   { Write-Host "  ⚠ BOM 审计问题: $issues 项" -ForegroundColor Yellow }
  if ($pendingEcos.Count -gt 0) { Write-Host "  ⚠ 待审批 ECO: $($pendingEcos.Count) 个" -ForegroundColor Yellow }
}
else {
  Write-Host ""
  Write-Host "一切正常，无待处理事项。" -ForegroundColor Green
}
