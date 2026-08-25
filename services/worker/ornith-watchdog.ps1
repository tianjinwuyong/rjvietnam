<#
.SYNOPSIS
    Ornith + PowerShell Factory Watchdog
    Ornith analyzes, PowerShell executes.

.DESCRIPTION
    1. Queries PostgreSQL DB directly (no auth needed)
    2. Feeds data to Ornith via opencode run
    3. Parses Ornith's structured output
    4. Executes recommended actions
    5. Sends LINE/console alerts

.PARAMETER Interval
    Seconds between watchdog cycles (default: 60)

.PARAMETER Scope
    'all' | 'iqc-ng' | 'work-orders' | 'wms-health'

.PARAMETER DryRun
    Parse and print actions without executing them

.EXAMPLE
    .\ornith-watchdog.ps1 -Interval 30 -Scope all
#>

param(
    [int]$Interval = 60,
    [ValidateSet('all', 'iqc-ng', 'work-orders', 'wms-health', 'quality')]
    [string]$Scope = 'all',
    [switch]$DryRun
)

$ErrorActionPreference = 'Continue'
$ProjectRoot  = "C:\Users\tianj\Desktop\越南工厂瑞晶\smt-factory-system"
$QueryScript  = "$ProjectRoot\services\worker\watchdog-query.js"
$OpencodeExe = "C:\Users\tianj\AppData\Roaming\npm\node_modules\opencode-ai\bin\opencode.exe"
$OllamaModel = "ollama/hf.co/deepreinforce-ai/Ornith-1.0-9B-GGUF:Q5_K_M"
$ApiBase     = "http://127.0.0.1:8080"
$LogFile     = "$ProjectRoot\services\worker\watchdog.log"

$LAST_STATE_FILE = "$ProjectRoot\services\worker\last-state.json"
$LINE_TOKEN_FILE = "$ProjectRoot\services\worker\section_token.txt"

function Write-Log {
    param([string]$Level, [string]$Msg)
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    "$ts [$Level] $Msg" | Tee-Object -FilePath $LogFile -Append
}

# ── Load previous cycle state ────────────────────────────────────────
function Get-LastState {
    if (Test-Path $LAST_STATE_FILE) {
        Get-Content $LAST_STATE_FILE -Raw | ConvertFrom-Json
    } else { [PSCustomObject]@{} }
}
function Save-LastState {
    param([object]$State)
    $State | ConvertTo-Json -Depth 5 | Set-Content $LAST_STATE_FILE -Encoding UTF8
}

# ── Detect new NG lots (compares with last cycle) ────────────────────
function Find-NewNgLots {
    param([array]$CurrentLots, [object]$LastState)

    if (-not $LastState.iqcNg) { return $CurrentLots }
    $prev = @{}
    $LastState.iqcNg | ForEach-Object { $prev[$_.lot_no] = $_.iqc_status }

    $CurrentLots | Where-Object {
        $_.iqc_status -in @('hold', 'rejected') -and
        (-not $prev.ContainsKey($_.lot_no) -or $prev[$_.lot_no] -eq 'pending')
    }
}

# ── Send LINE notification ───────────────────────────────────────────
function Send-LINENotification {
    param([string]$Message)
    $tokenPath = $LINE_TOKEN_FILE
    if (-not (Test-Path $tokenPath)) {
        Write-Log "WARN" "LINE token file not found: $tokenPath"
        return
    }
    $token = (Get-Content $tokenPath -Raw).Trim()
    if (-not $token) { return }

    $headers = @{ Authorization = "Bearer $token" }
    $body = @{ message = $Message } | ConvertTo-Json
    try {
        Invoke-RestMethod -Uri "https://notify-api.line.me/api/notify" `
            -Method POST -Headers $headers -Body $body `
            -ContentType "application/json" 2>&1 | Out-Null
        Write-Log "INFO" "LINE notification sent"
    } catch {
        Write-Log "ERROR" "LINE notification failed: $_"
    }
}

# ── Format data for Ornith prompt ────────────────────────────────────
function Format-OrnithPrompt {
    param([object]$Data, [string]$Scope, [array]$NewNgLots)

    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

$prompt = @"
工厂运行数据快照 — $timestamp
=============================

你是一家越南SMT电子工厂的AI运营分析师。你需要分析以下数据，发现问题并给出处理建议。

<WORK_ORDERS>
$($Data.workOrders | ConvertTo-Json -Depth 3 -Compress)
</WORK_ORDERS>

<IQC_NG_LOTS>
新发现的NG批次（与上次周期对比）:
$($NewNgLots | ConvertTo-Json -Depth 3 -Compress)

所有IQC批次:
$($Data.iqcNg | ConvertTo-Json -Depth 3 -Compress)
</IQC_NG_LOTS>

<WMS_HEALTH>
$($Data.wmsHealth | ConvertTo-Json -Depth 5 -Compress)
</WMS_HEALTH>

请分析以上数据，用中文回答。

分析要求：
1. 指出当前最紧急的问题（按优先级排序）
2. 分析每个问题的可能原因
3. 给出具体的处理建议
4. 如果有待处理的IQC NG批次（hold/rejected状态），列出需要采取的行动

重要：你的回复必须严格按照以下JSON格式，不要添加任何额外文字（除了JSON本身）：

<ANALYSIS>
{
  "alerts": [
    {
      "severity": "critical|warning|info",
      "area": "iqc|wo|wms|quality",
      "title": "简短标题",
      "detail": "详细描述",
      "action": "具体行动描述"
    }
  ],
  "newNgLots": [
    {
      "lot_no": "批次号",
      "material": "物料名称",
      "supplier": "供应商",
      "status": "hold|rejected",
      "qty": 数量,
      "action": "建议的处理方式"
    }
  ],
  "summary": "一句话总结当前工厂状态"
}
</ANALYSIS>
"@
    return $prompt
}

# ── Call Ornith via opencode run ────────────────────────────────────
function Invoke-OrnithAnalysis {
    param([string]$Prompt)

    $tempFile = [System.IO.Path]::GetTempFileName() + ".txt"
    $Prompt | Out-File -FilePath $tempFile -Encoding UTF8

    $opencodeArgs = @(
        "run",
        "--project", $ProjectRoot,
        "-m", $OllamaModel,
        "--agent", "oracle",
        "--print-logs"
    )

    try {
        $output = & $OpencodeExe $opencodeArgs 2>&1
        $stdout = $output | Where-Object { $_ -is [string] } | Out-String
        Remove-Item $tempFile -Force -EA SilentlyContinue
        return $stdout
    }
    catch {
        Write-Log "ERROR" "opencode run failed: $_"
        Remove-Item $tempFile -Force -EA SilentlyContinue
        return $null
    }
}

# ── Parse Ornith JSON output ─────────────────────────────────────────
function Parse-OrnithOutput {
    param([string]$RawOutput)

    # Try to extract JSON from <ANALYSIS> tags
    if ($RawOutput -match '(?s)<ANALYSIS>\s*(\{.*?\})\s*</ANALYSIS>') {
        try {
            return $matches[1] | ConvertFrom-Json
        } catch {
            Write-Log "WARN" "JSON parse failed: $_"
        }
    }

    # Fallback: look for any JSON object
    $matches2 = [regex]::Matches($RawOutput, '\{[^{}]*"alerts"[^{}]*\}')
    foreach ($m in $matches2) {
        try {
            return $m.Value | ConvertFrom-Json
        } catch { continue }
    }

    Write-Log "WARN" "Could not parse Ornith output as JSON"
    return $null
}

# ── Execute parsed actions ───────────────────────────────────────────
function Invoke-WatchdogAction {
    param(
        [Parameter(Mandatory)]
        [object]$Analysis,
        [switch]$DryRun
    )

    $actionsTaken = @()

    # Alert on new NG lots
    if ($Analysis.newNgLots -and $Analysis.newNgLots.Count -gt 0) {
        foreach ($ng in $Analysis.newNgLots) {
            $msg = "🔴 IQC NG警报 | 批次:$($ng.lot_no) | 物料:$($ng.material) | 供应商:$($ng.supplier) | 状态:$($ng.status) | 数量:$($ng.qty) | 建议:$($ng.action)"
            Write-Log "ALERT" $msg

            if (-not $DryRun) {
                Send-LINENotification $msg
            }
        }
        $actionsTaken += "LINE alerts sent for $($Analysis.newNgLots.Count) NG lots"
    }

    # General alerts
    if ($Analysis.alerts -and $Analysis.alerts.Count -gt 0) {
        foreach ($alert in $Analysis.alerts) {
            $icon = switch ($alert.severity) {
                'critical' { '🔴' }
                'warning'  { '🟡' }
                'info'     { '🔵' }
                default    { '⚪' }
            }
            $msg = "$icon [$($alert.area.ToUpper())] $($alert.title) — $($alert.detail)"
            Write-Log $alert.severity.ToUpper() $msg

            if ($alert.severity -eq 'critical' -and -not $DryRun) {
                Send-LINENotification $msg
            }
        }
    }

    # Summary
    if ($Analysis.summary) {
        Write-Log "INFO" "工厂状态: $($Analysis.summary)"
    }

    return $actionsTaken
}

# ── Main watchdog loop ───────────────────────────────────────────────
function Start-Watchdog {
    Write-Log "INFO" "Ornith Watchdog started — scope=$Scope interval=${Interval}s dryrun=$DryRun"

    while ($true) {
        $cycleStart = Get-Date

        Write-Log "INFO" "=== Watchdog cycle started ==="

        # 1. Query DB
        Write-Log "INFO" "Querying database..."
        $rawJson = & node $QueryScript $Scope 2>&1
        if ($LASTEXITCODE -ne 0) {
            Write-Log "ERROR" "DB query failed: $rawJson"
            Start-Sleep -Seconds $Interval
            continue
        }

        $data = $rawJson | ConvertFrom-Json
        if ($data.error) {
            Write-Log "ERROR" "DB error: $($data.error)"
            Start-Sleep -Seconds $Interval
            continue
        }

        # 2. Check for new NG lots
        $lastState = Get-LastState
        $newNgLots = @()
        if ($data.iqcNg) {
            $newNgLots = Find-NewNgLots -CurrentLots $data.iqcNg -LastState $lastState
        }

        if ($newNgLots.Count -gt 0) {
            Write-Log "WARN" "NEW NG lots detected: $($newNgLots.lot_no -join ', ')"
        }

        # 3. Build Ornith prompt
        $prompt = Format-OrnithPrompt -Data $data -Scope $Scope -NewNgLots $newNgLots

        # 4. Call Ornith
        Write-Log "INFO" "Sending data to Ornith for analysis..."
        $ornithOutput = Invoke-OrnithAnalysis -Prompt $prompt

        if ($ornithOutput) {
            Write-Log "DEBUG" "Ornith raw output (first 500 chars): $($ornithOutput.Substring(0, [Math::Min(500, $ornithOutput.Length)]))"
        }

        # 5. Parse output
        $analysis = Parse-OrnithOutput $ornithOutput

        if ($analysis) {
            # 6. Execute actions
            $actions = Invoke-WatchdogAction -Analysis $analysis -DryRun:$DryRun
            Write-Log "INFO" "Actions taken: $($actions -join '; ')"

            # 7. Save state for next cycle comparison
            $currentState = [PSCustomObject]@{
                iqcNg      = $data.iqcNg
                workOrders = $data.workOrders
                wmsHealth  = $data.wmsHealth
                analyzedAt = (Get-Date).ToString("o")
            }
            Save-LastState $currentState
        } else {
            Write-Log "WARN" "Could not parse Ornith output — skipping action"
            Write-Log "DEBUG" "Full Ornith output: $ornithOutput"
        }

        $elapsed = (Get-Date) - $cycleStart
        Write-Log "INFO" "Cycle completed in ${elapsed.TotalSeconds:F1}s"

        Start-Sleep -Seconds $Interval
    }
}

# ── One-shot mode (run once, no loop) ───────────────────────────────
function Invoke-OneShot {
    Write-Log "INFO" "One-shot mode — scope=$Scope"

    $rawJson = & node $QueryScript $Scope 2>&1
    if ($LASTEXITCODE -ne 0) { Write-Log "ERROR" "DB query failed"; return }
    $data = $rawJson | ConvertFrom-Json

    $lastState = Get-LastState
    $newNgLots = @()
    if ($data.iqcNg) {
        $newNgLots = Find-NewNgLots -CurrentLots $data.iqcNg -LastState $lastState
    }

    $prompt = Format-OrnithPrompt -Data $data -Scope $Scope -NewNgLots $newNgLots
    $ornithOutput = Invoke-OrnithAnalysis -Prompt $prompt

    if (-not $ornithOutput) {
        Write-Log "ERROR" "No output from Ornith"
        return
    }

    Write-Host "========== ORNITH ANALYSIS =========="
    Write-Host $ornithOutput
    Write-Host "===================================="

    $analysis = Parse-OrnithOutput $ornithOutput
    if ($analysis) {
        Invoke-WatchdogAction -Analysis $analysis -DryRun:$DryRun
    } else {
        Write-Log "WARN" "Could not parse analysis — print raw output above"
    }
}

# Run
if ($DryRun -or [Environment]::GetCommandLineArgs().Contains('-DryRun')) {
    Invoke-OneShot
} else {
    Start-Watchdog
}
