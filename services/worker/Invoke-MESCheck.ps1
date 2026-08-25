<#
.SYNOPSIS
    MES Patrol Check — scheduled/cron invocation of the MES AI Manager patrol loop.

.DESCRIPTION
    Invokes the MES SOP manager (or directly runs mes-manager.js patrol) for routine
    SMT line health checks. Designed for Windows Task Scheduler or manual admin use.

    Usage modes:
      Invoke-MESCheck.ps1                    — Run full patrol for default line (SMD-01)
      Invoke-MESCheck.ps1 -Line SMD-02       — Run patrol for specific line
      Invoke-MESCheck.ps1 -Mode morning      — Run morning digest + patrol
      Invoke-MESCheck.ps1 -Mode evening      — Run evening summary
      Invoke-MESCheck.ps1 -Mode watch        — Watchdog mode (continuous, for long-lived process)
      Invoke-MESCheck.ps1 -Sop              — Run via SOP engine (mes-sop-manager.js)
      Invoke-MESCheck.ps1 -LogOnly          — Print last N log lines

.PARAMETER Line
    Target SMT line code (default: SMD-01)

.PARAMETER Mode
    Patrol mode: patrol (default), morning, evening, watch

.PARAMETER Sop
    Switch: use SOP engine instead of direct patrol

.PARAMETER LogOnly
    Switch: show last 50 log lines and exit

.PARAMETER LogLines
    Number of log lines to show (default: 50)

.EXAMPLE
    .\Invoke-MESCheck.ps1
    .\Invoke-MESCheck.ps1 -Line SMD-02 -Mode morning
    .\Invoke-MESCheck.ps1 -Sop
#>

param(
    [string]$Line = "SMD-01",
    [ValidateSet("patrol", "morning", "evening", "watch")]
    [string]$Mode = "patrol",
    [switch]$Sop,
    [switch]$LogOnly,
    [int]$LogLines = 50
)

$ProjectRoot = if ($env:PROJECT_ROOT) { $env:PROJECT_ROOT } else { Split-Path -Parent $PSScriptRoot }
$WorkerDir   = Join-Path $ProjectRoot "services\worker"
$NodeExe     = "node"
$Timestamp   = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

# ── Log only mode ────────────────────────────────────────────────────────
if ($LogOnly) {
    $LogFile = Join-Path $WorkerDir "mes-manager.log"
    if (Test-Path $LogFile) {
        Get-Content $LogFile -Tail $LogLines
    } else {
        Write-Host "Log file not found: $LogFile"
    }
    exit 0
}

# ── Log helper ───────────────────────────────────────────────────────────
function Write-Log {
    param([string]$Message)
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $logLine = "$ts [Invoke-MESCheck] $Message"
    Write-Host $logLine
    $LogFile = Join-Path $WorkerDir "mes-manager.log"
    Add-Content -Path $LogFile -Value $logLine
}

# ── Check prerequisites ─────────────────────────────────────────────────
if (-not (Test-Path $WorkerDir)) {
    Write-Error "Worker directory not found: $WorkerDir"
    exit 1
}

# ── Run SOP mode ─────────────────────────────────────────────────────────
if ($Sop) {
    Write-Log "Starting SOP patrol for line $Line (mode: $Mode)"

    $SopFile  = Join-Path $WorkerDir "mes-sop.json"
    $StateFile = Join-Path $WorkerDir "mes-sop-state.json"

    if (-not (Test-Path $SopFile)) {
        Write-Error "SOP file not found: $SopFile"
        exit 1
    }

    # Reset state if starting fresh
    if ($Mode -eq "patrol" -and $args -notcontains "-resume") {
        $FreshState = @{
            current_step_id    = $null
            completed_step_ids = @()
            skipped_step_ids   = @()
            step_results       = @{}
            vars               = @{
                line      = $Line
                mode      = $Mode
                timestamp = (Get-Date -Format "o")
            }
            sop_name    = "MES Patrol SOP v1.0"
            sop_version = "1.0.0"
            updated_at  = (Get-Date -Format "o")
        }
        $FreshState | ConvertTo-Json -Depth 10 | Set-Content -Path $StateFile -Force
        Write-Log "State reset for line $Line"
    }

    # Set line in state
    $StateContent = Get-Content $StateFile -Raw | ConvertFrom-Json
    $StateContent.vars.line = $Line
    $StateContent.vars.mode = $Mode
    $StateContent.vars.timestamp = (Get-Date -Format "o")
    $StateContent | ConvertTo-Json -Depth 10 | Set-Content -Path $StateFile -Force

    # Run SOP
    Set-Location $ProjectRoot
    & $NodeExe "$WorkerDir\mes-sop-manager.js" run --sop $SopFile --state $StateFile --once

    if ($LASTEXITCODE -ne 0) {
        Write-Log "SOP patrol completed with exit code $LASTEXITCODE"
    } else {
        Write-Log "SOP patrol completed successfully"
    }
    exit $LASTEXITCODE
}

# ── Direct patrol mode ───────────────────────────────────────────────────
Write-Log "Starting direct patrol for line $Line (mode: $Mode)"

Set-Location $ProjectRoot

switch ($Mode) {
    "morning" {
        Write-Log "Running morning digest"
        & $NodeExe "$WorkerDir\mes-manager.js" morning-daily --line $Line
    }
    "evening" {
        Write-Log "Running evening summary"
        & $NodeExe "$WorkerDir\mes-manager.js" evening --line $Line
    }
    "watch" {
        Write-Log "Starting watchdog mode (Ctrl+C to stop)"
        & $NodeExe "$WorkerDir\mes-manager.js" watch --line $Line --interval 300
    }
    default {
        Write-Log "Running standard patrol"
        & $NodeExe "$WorkerDir\mes-manager.js" patrol --line $Line
    }
}

if ($LASTEXITCODE -ne 0) {
    Write-Log "Patrol completed with exit code $LASTEXITCODE"
    exit $LASTEXITCODE
}

Write-Log "Patrol completed successfully for line $Line"
