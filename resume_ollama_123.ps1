# Resume Ollama fix on 192.168.6.123 after host returns online.
# The install script removed /usr/local/lib/ollama and downloaded a partial
# tarball before the host went offline. This script waits for the host,
# re-downloads/resumes the tarball if needed, extracts libs, restarts ollama,
# and verifies llama-server + mem0 health.
#
# Usage: powershell -ExecutionPolicy Bypass -File resume_ollama_123.ps1

$host = "192.168.6.123"
$user = "wy"
$tarUrl = "https://ollama.com/download/ollama-linux-amd64.tar.zst"

Write-Host "=== Resume Ollama fix on $host ==="

# 1. Wait for host to come back (max 30 min)
$deadline = (Get-Date).AddMinutes(30)
while (-not (Test-Connection -ComputerName $host -Count 1 -Quiet)) {
    if ((Get-Date) -gt $deadline) {
        Write-Host "Host still unreachable after 30 min. Aborting. Re-run when $host is online."
        exit 1
    }
    Write-Host ("[{0}] Waiting for {1}..." -f (Get-Date -Format "HH:mm:ss"), $host)
    Start-Sleep -Seconds 30
}
Write-Host "Host is reachable. Waiting for SSH port 22..."
$deadline = (Get-Date).AddMinutes(10)
while (-not (Test-NetConnection -ComputerName $host -Port 22 -InformationLevel Quiet -WarningAction SilentlyContinue)) {
    if ((Get-Date) -gt $deadline) { Write-Host "SSH never opened. Aborting."; exit 1 }
    Start-Sleep -Seconds 15
}
Write-Host "SSH is up."

# 2. Inspect remote state
ssh -o StrictHostKeyChecking=no -o ConnectTimeout=15 "${user}@${host}" "ls -la /tmp/ollama.tar.zst 2>/dev/null; ls /usr/local/lib/ollama/ 2>/dev/null; echo BIN:; /usr/local/bin/ollama --version 2>&1 | head -1"

# 3. If tarball missing/small, download it (background on remote to avoid local timeout)
ssh -o StrictHostKeyChecking=no -o ConnectTimeout=15 "${user}@${host}" "if [ ! -s /tmp/ollama.tar.zst ]; then echo TARBALL_MISSING; nohup bash -c 'curl -fsSL --retry 5 --retry-delay 3 -o /tmp/ollama.tar.zst $tarUrl && echo DONE > /tmp/dl.done' > /tmp/dl.nohup 2>&1 & echo DOWNLOAD_STARTED; else echo TARBALL_PRESENT; fi"

# 4. Wait for download to finish (if started) - poll remotely
$deadline = (Get-Date).AddMinutes(45)
while ($true) {
    $state = ssh -o StrictHostKeyChecking=no -o ConnectTimeout=15 "${user}@${host}" "cat /tmp/dl.done 2>/dev/null || echo IN_PROGRESS; ls -la /tmp/ollama.tar.zst 2>/dev/null | awk '{print \$5}'"
    if ($state -match "DONE") { Write-Host "Tarball download complete."; break }
    if ((Get-Date) -gt $deadline) { Write-Host "Download still running; check /tmp/dl.nohup manually."; break }
    Write-Host ("[{0}] Download in progress..." -f (Get-Date -Format "HH:mm:ss"))
    Start-Sleep -Seconds 60
}

# 5. Extract + restart + verify
ssh -o StrictHostKeyChecking=no -o ConnectTimeout=15 "${user}@${host}" "sudo tar --zstd -xf /tmp/ollama.tar.zst -C /usr/local && sudo systemctl restart ollama && sleep 5 && echo EXTRACT_RESTART_OK"
Start-Sleep -Seconds 15
ssh -o StrictHostKeyChecking=no -o ConnectTimeout=15 "${user}@${host}" "echo '=== llama-server ==='; ls -la /usr/local/lib/ollama/llama-server; echo '=== tags ==='; curl -s http://localhost:11434/api/tags | head -c 300; echo; echo '=== mem0 health ==='; curl -s http://127.0.0.1:9876/health"

Write-Host "=== Done. If llama-server exists and tags respond, run a mem0 search_all test. ==="