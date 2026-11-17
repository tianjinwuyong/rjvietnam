param([int]$Cycles = 10, [int]$WaitSeconds = 8)
$logFile = "C:\Users\tianj\Desktop\越南工厂瑞晶\smt-factory-system\watchdog_test.log"
$apiPort = 8080
$webPort = 5178

function getPortPid($port) {
    $conn = Get-NetTCPConnection -LocalPort $port | Where-Object { $_.LocalAddress -eq '0.0.0.0' } | Select-Object -First 1
    if ($conn) { return $conn.OwningProcess } else { return $null }
}

function isPortOpen($port) {
    try {
        $tcp = Test-NetConnection -ComputerName localhost -Port $port -WarningAction SilentlyContinue -ErrorAction SilentlyContinue
        return $tcp.TcpTestSucceeded
    } catch { return $false }
}

function log($msg) {
    $ts = Get-Date -Format 'HH:mm:ss'
    $line = "[$ts] $msg"
    Write-Host $line
    "$line" | Out-File -FilePath $logFile -Append -Encoding utf8
}

function killAndWait($pid, $label) {
    if ($pid) {
        try {
            Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
            log "  Killed $label PID=$pid"
        } catch {}
    }
}

# Clear log
"=== Watchdog Restart Test $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ===" | Out-File -FilePath $logFile -Encoding utf8

$success = 0
$fails = 0

for ($i = 1; $i -le $Cycles; $i++) {
    Write-Host ""
    log "=== Cycle $i / $Cycles ==="

    # Get current PIDs
    $apiPidBefore = getPortPid $apiPort
    $vitePidBefore = getPortPid $webPort
    log "  Before: API=$apiPidBefore Vite=$vitePidBefore"

    # Kill both
    killAndWait $apiPidBefore "API"
    killAndWait $vitePidBefore "Vite"

    # Wait for watchdog to restart
    Start-Sleep $WaitSeconds

    # Check if restarted
    $apiOk = isPortOpen $apiPort
    $viteOk = isPortOpen $webPort

    $apiPidAfter = getPortPid $apiPort
    $vitePidAfter = getPortPid $webPort

    if ($apiOk -and $viteOk) {
        $success++
        log "  RESTARTED: API PID=$apiPidAfter Vite PID=$vitePidAfter [OK]"
        Write-Host "  [OK] Cycle $i passed" -ForegroundColor Green
    } else {
        $fails++
        log "  FAILED: API=$apiOk Vite=$viteOk"
        Write-Host "  [FAIL] Cycle $i FAILED" -ForegroundColor Red
        # Stop on first failure for diagnosis
        log "STOPPING on failure"
        break
    }
}

Write-Host ""
log "=== Results: $success / $Cycles passed ==="
if ($fails -eq 0) { Write-Host "ALL TESTS PASSED" -ForegroundColor Green }
else { Write-Host "SOME TESTS FAILED" -ForegroundColor Red }
