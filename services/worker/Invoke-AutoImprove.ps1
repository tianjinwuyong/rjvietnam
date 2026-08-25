<#
.SYNOPSIS
  BOM 自动改善 — 调用 bom-auto-improvement.js 并输出改善建议.
.DESCRIPTION
  Runs the improvement engine to find cost savings, substitutions, and
  process optimizations across all BOMs.
.PARAMETER Threshold
  Minimum confidence (0-100) for suggestions to report (default: 50).
.PARAMETER BomId
  Optional BOM ID to scope the analysis.
.PARAMETER Apply
  If set, applies the top suggestion automatically (experimental).
.EXAMPLE
  .\Invoke-AutoImprove.ps1
  .\Invoke-AutoImprove.ps1 -Threshold 60 -BomId 5
#>

param(
  [int]    $Threshold = 50,
  [int]    $BomId,
  [switch] $Apply
)

$Root   = Split-Path -Parent $PSScriptRoot
$Worker = Join-Path $Root "services\worker"
$Node   = "node"

Write-Host "=== BOM 自动改善 ===" -ForegroundColor Cyan
Write-Host "最低置信度: $Threshold%"
if ($BomId) { Write-Host "限定 BOM:   $BomId" }
Write-Host ""

# 1) Run improvement engine
Write-Host "[1/3] 运行改善引擎..." -NoNewline
try {
  if ($BomId) {
    $raw = & $Node "$Worker\bom-auto-improvement.js" suggest --bomid $BomId 2>$null
  }
  else {
    $raw = & $Node "$Worker\bom-auto-improvement.js" run 2>$null
  }
  $suggestions = $raw | ConvertFrom-Json
  Write-Host " $($suggestions.Count) 条建议" -ForegroundColor Blue
}
catch {
  Write-Host " 失败: $_" -ForegroundColor Red
  exit 1
}
Write-Host ""

# 2) Filter by threshold & display
Write-Host "[2/3] 筛选并展示..." -NoNewline
$filtered = @()
foreach ($s in $suggestions) {
  $conf = if ($s.confidence -ne $null) { [int]$s.confidence } else { 0 }
  if ($conf -ge $Threshold) {
    $filtered += $s
    Write-Host ""
    Write-Host "  [$($s.type)] $($s.title)" -ForegroundColor $(if ($s.type -eq 'cost_reduce' -or $s.type -eq 'substitute') { "Green" } else { "Blue" })
    Write-Host "    描述: $($s.description)"
    if ($s.potentialSaving -and $s.potentialSaving -gt 0) {
      Write-Host "    节省: ¥$([math]::Round($s.potentialSaving, 2))" -ForegroundColor Green
    }
    Write-Host "    置信度: ${conf}%"
  }
}
Write-Host " (>=$Threshold% 置信度: $($filtered.Count) 条符合)" -ForegroundColor Blue
Write-Host ""

# 3) Apply if requested
if ($Apply -and $filtered.Count -gt 0) {
  Write-Host "[3/3] 自动应用（实验性）..."
  $best = $filtered[0]
  Write-Host "  即将应用: $($best.title)" -ForegroundColor Yellow
  Write-Host "  请手动确认后再执行应用操作。" -ForegroundColor DarkGray
  # Experimental: could create ECO automatically here
}
elseif (-not $Apply) {
  Write-Host "[3/3] 跳过自动应用（未设置 -Apply）" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "改善分析完成。" -ForegroundColor Green
