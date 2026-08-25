$ErrorActionPreference = "SilentlyContinue"
$apiPort = 8080
$webPort = 5178
$checkInterval = 10
$logFile = "$PSScriptRoot\watchdog.log"

function log($msg) {
    $ts = Get-Date -Format 'HH:mm:ss'
    $line = "[$ts] $msg"
    Write-Host $line
    "$line" | Out-File -FilePath $logFile -Append -Encoding utf8
}

function isPortOpen($port) {
    try {
        $tcp = Test-NetConnection -ComputerName localhost -Port $port -WarningAction SilentlyContinue -ErrorAction SilentlyContinue
        return $tcp.TcpTestSucceeded
    } catch { return $false }
}

function startApi() {
    log "API starting on :$apiPort..."
    Start-Process -FilePath "$PSScriptRoot\run-api.bat" -WorkingDirectory $PSScriptRoot -WindowStyle Hidden
}

function startVite() {
    log "Vite starting on :$webPort..."
    Start-Process -FilePath "$PSScriptRoot\run-vite.bat" -WorkingDirectory $PSScriptRoot -WindowStyle Hidden
}

# Check if already running
$apiRunning = isPortOpen $apiPort
$viteRunning = isPortOpen $webPort

log "=== Watchdog started $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ==="
$apiState = if ($apiRunning) { 'already running' } else { 'not running, starting...' }
$viteState = if ($viteRunning) { 'already running' } else { 'not running, starting...' }
log "API : $apiState"
log "Vite: $viteState"
log "Checking every ${checkInterval}s | Log: $logFile"
log ""

if (-not $apiRunning) { startApi }
if (-not $viteRunning) { startVite }

while ($true) {
    Start-Sleep $checkInterval

    $apiOk = isPortOpen $apiPort
    $viteOk = isPortOpen $webPort

    if (-not $apiOk) {
        log "API dead on :$apiPort — restarting..."
        startApi
    }
    if (-not $viteOk) {
        log "Vite dead on :$webPort — restarting..."
        startVite
    }

    if ($apiOk -and $viteOk) {
        # Silent heartbeat — only write to console, not log
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] OK api=:$apiPort vite=:$webPort" -NoNewline
        Write-Host "`r[$(Get-Date -Format 'HH:mm:ss')] OK api=:$apiPort vite=:$webPort" -NoNewline
    }
}
