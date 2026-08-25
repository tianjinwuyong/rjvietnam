<#
.SYNOPSIS
    MES Morning Digest — daily morning production summary for management.

.DESCRIPTION
    Runs the MES morning digest routine for all active SMT lines.
    Queries yield, downtime, scrap, OEE from last 24h and dispatches
    a LINE notification summary to the production management group.

    Designed for Windows Task Scheduler — schedule daily at 07:30.

.PARAMETER Line
    Target line (default: SMD-01). Use "ALL" for all active lines.

.PARAMETER Hours
    Lookback window in hours (default: 24).

.PARAMETER OutputFile
    Optional: save digest JSON to file.

.PARAMETER NoLineNotify
    Switch: suppress LINE notification (dry-run mode).

.EXAMPLE
    .\Invoke-MESMorningDigest.ps1
    .\Invoke-MESMorningDigest.ps1 -Line SMD-02 -Hours 12
    .\Invoke-MESMorningDigest.ps1 -Line ALL
    .\Invoke-MESMorningDigest.ps1 -Line SMD-01 -NoLineNotify
#>

param(
    [string]$Line = "SMD-01",
    [int]$Hours = 24,
    [string]$OutputFile = "",
    [switch]$NoLineNotify
)

$ProjectRoot = if ($env:PROJECT_ROOT) { $env:PROJECT_ROOT } else { Split-Path -Parent $PSScriptRoot }
$WorkerDir   = Join-Path $ProjectRoot "services\worker"
$NodeExe     = "node"
$Timestamp   = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

# ── Log helper ───────────────────────────────────────────────────────────
function Write-Log {
    param([string]$Message)
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $logLine = "$ts [MESMorningDigest] $Message"
    Write-Host $logLine
    $LogFile = Join-Path $WorkerDir "mes-manager.log"
    Add-Content -Path $LogFile -Value $logLine
}

# ── Prerequisites ────────────────────────────────────────────────────────
if (-not (Test-Path $WorkerDir)) {
    Write-Error "Worker directory not found: $WorkerDir"
    exit 1
}

Write-Log "=== MES Morning Digest ==="
Write-Log "Target line: $Line | Lookback: ${Hours}h | NoLineNotify: $NoLineNotify"

Set-Location $ProjectRoot

# ── Step 1: Query active lines ──────────────────────────────────────────
Write-Log "Step 1/5: Querying active lines..."
$LinesResult = & $NodeExe "$WorkerDir\mes-query.js" lines --mode digest
if ($LASTEXITCODE -ne 0) {
    Write-Log "Failed to query lines, proceeding with specified line: $Line"
    $ActiveLines = @($Line)
} else {
    try {
        $LinesData = $LinesResult | ConvertFrom-Json
        if ($Line -eq "ALL") {
            $ActiveLines = $LinesData.data | ForEach-Object { $_.line_code }
            if ($ActiveLines.Count -eq 0) {
                Write-Log "No active lines found, using default"
                $ActiveLines = @("SMD-01")
            }
        } else {
            $ActiveLines = @($Line)
        }
    } catch {
        Write-Log "Failed to parse lines (will use default): $_"
        $ActiveLines = @($Line)
    }
}

Write-Log "Active lines: $($ActiveLines -join ', ')"

# ── Step 2: Gather metrics per line ─────────────────────────────────────
$DigestResults = @()

foreach ($CurrentLine in $ActiveLines) {
    Write-Log "Step 2/5: Gathering metrics for $CurrentLine..."

    $LineDigest = @{
        line        = $CurrentLine
        timestamp   = (Get-Date -Format "o")
        yields      = $null
        downtimes   = $null
        scraps      = $null
        oee         = $null
        runs        = $null
        stagnation  = $null
    }

    # Yields
    $YieldRaw = & $NodeExe "$WorkerDir\mes-query.js" yields --line $CurrentLine --hours $Hours 2>&1
    $LineDigest.yields = try { ($YieldRaw | ConvertFrom-Json) } catch { $null }

    # Downtimes
    $DTRaw = & $NodeExe "$WorkerDir\mes-query.js" downtimes --line $CurrentLine --hours $Hours 2>&1
    $LineDigest.downtimes = try { ($DTRaw | ConvertFrom-Json) } catch { $null }

    # Scraps
    $ScrapRaw = & $NodeExe "$WorkerDir\mes-query.js" scraps --line $CurrentLine --hours $Hours 2>&1
    $LineDigest.scraps = try { ($ScrapRaw | ConvertFrom-Json) } catch { $null }

    # OEE
    $OEERaw = & $NodeExe "$WorkerDir\mes-query.js" oee --line $CurrentLine --hours $Hours 2>&1
    $LineDigest.oee = try { ($OEERaw | ConvertFrom-Json) } catch { $null }

    # Active runs
    $RunsRaw = & $NodeExe "$WorkerDir\mes-query.js" runs --line $CurrentLine --mode digest 2>&1
    $LineDigest.runs = try { ($RunsRaw | ConvertFrom-Json) } catch { $null }

    # Stagnation
    $StagRaw = & $NodeExe "$WorkerDir\mes-query.js" stagnation --line $CurrentLine --threshold_minutes 30 2>&1
    $LineDigest.stagnation = try { ($StagRaw | ConvertFrom-Json) } catch { $null }

    $DigestResults += $LineDigest
    Write-Log "Metrics collected for $CurrentLine"
}

# ── Step 3: Generate digest summary ─────────────────────────────────────
Write-Log "Step 3/5: Generating digest summary..."

$SummaryLines = @()
$SummaryLines += ""
$SummaryLines += "═══ MES Morning Digest ═══"
$SummaryLines += "Date: $(Get-Date -Format 'yyyy-MM-dd')"
$SummaryLines += "Period: last ${Hours}h"
$SummaryLines += ""

foreach ($D in $DigestResults) {
    $SummaryLines += "── $($D.line) ──"

    $YieldText  = if ($D.yields -and $D.yields.data) { "FPY: $($D.yields.data)%" } else { "Yield: N/A" }
    $SummaryLines += "  $YieldText"

    $OEEValue = if ($D.oee -and $D.oee.data) { $D.oee.data } elseif ($D.oee -and $D.oee.oee) { $D.oee.oee } else { $null }
    if ($OEEValue) {
        $OEEFormatted = if ($OEEValue -is [float] -or $OEEValue -is [int]) { "{0:P1}" -f ($OEEValue / 100) } else { $OEEValue }
        $SummaryLines += "  OEE: $OEEFormatted"
    } else {
        $SummaryLines += "  OEE: N/A"
    }

    $DTCount = if ($D.downtimes -and $D.downtimes.data) { $D.downtimes.data.Count } else { 0 }
    $ScrapCount = if ($D.scraps -and $D.scraps.data) { $D.scraps.data.Count } else { 0 }
    $StagCount = if ($D.stagnation -and $D.stagnation.data) { $D.stagnation.data.Count } else { 0 }

    $SummaryLines += "  Downtime events: $DTCount"
    $SummaryLines += "  Scrap requests:  $ScrapCount"
    $SummaryLines += "  Stagnant PCBs:   $StagCount"
    $SummaryLines += ""
}

# Active runs summary
$AllRuns = $DigestResults | Where-Object { $_.runs -and $_.runs.data } | ForEach-Object { $_.runs.data }
if ($AllRuns) {
    $SummaryLines += "Active runs: $($AllRuns.Count)"
} else {
    $SummaryLines += "Active runs: N/A"
}

$SummaryLines += "═══════════════════════════"
$SummaryLines += ""

$DigestText = $SummaryLines -join "`n"

# ── Step 4: Save or output ─────────────────────────────────────────────
Write-Log "Step 4/5: Saving digest..."

$DigestOutput = @{
    generated_at = (Get-Date -Format "o")
    period_hours = $Hours
    lines        = $DigestResults
    summary      = $DigestText
}

if ($OutputFile) {
    $DigestOutput | ConvertTo-Json -Depth 10 | Set-Content -Path $OutputFile -Force
    Write-Log "Digest saved to: $OutputFile"
}

# ── Step 5: LINE notification ──────────────────────────────────────────
Write-Log "Step 5/5: Sending notification..."

if ($NoLineNotify) {
    Write-Host "=== DIGEST (dry-run - no LINE notify) ==="
    Write-Host $DigestText
    Write-Log "Dry-run mode, LINE notification suppressed"
} else {
    Write-Log "Sending LINE notification..."

    # Call mes-execute.js notify-line
    $NotifyResult = & $NodeExe "$WorkerDir\mes-execute.js" notify-line --message $DigestText 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Log "LINE notification sent successfully"
    } else {
        Write-Log "LINE notification failed (exit: $LASTEXITCODE): $NotifyResult"
    }

    # Also output to console for logging
    Write-Host $DigestText
}

Write-Log "=== Morning Digest Complete ==="
