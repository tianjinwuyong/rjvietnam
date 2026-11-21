# ============================================================
# VN SMT Factory — Remote Access Setup
# Run with: powershell -ExecutionPolicy Bypass -File setup-remote-access.ps1
# Or right-click → "以管理员身份运行" (Run as Administrator)
# ============================================================

# Self-elevation: if not admin, re-launch as admin
if (-NOT ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host "[ELEVATE] Requesting administrator privileges..." -ForegroundColor Yellow
  $arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
  try {
    Start-Process PowerShell.exe -Verb RunAs -ArgumentList $arguments
  } catch {
    Write-Host "[FAIL] Could not elevate. Please right-click this script and '以管理员身份运行'." -ForegroundColor Red
    pause
    exit 1
  }
  exit 0
}

# Now running as Administrator
$ErrorActionPreference = "Stop"
$port = 80
$ruleName = "VN-SMT-Factory Web (TCP $port)"

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  VN SMT Factory — Remote Access Setup"      -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# 1. Firewall rule
Write-Host "[1/4] Windows Firewall rule for port $port ..." -ForegroundColor Yellow
Remove-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue | Out-Null
$rule = New-NetFirewallRule `
  -DisplayName $ruleName `
  -Description "Allow LAN/WiFi devices to visit the Vietnam Ruijing SMT factory web app" `
  -Direction Inbound `
  -Protocol TCP `
  -LocalPort $port `
  -Action Allow `
  -Profile Any `
  -Enabled True
Write-Host "    [OK] Rule '$ruleName' added (Enabled=$($rule.Enabled), Action=$($rule.Action))" -ForegroundColor Green

# 2. Verify the server is listening
Write-Host ""
Write-Host "[2/4] Checking port $port listener ..." -ForegroundColor Yellow
$listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($listener) {
  Write-Host "    [OK] Something is listening on port $port (PID $($listener.OwningProcess -join ', '))" -ForegroundColor Green
} else {
  Write-Host "    [WARN] Nothing is listening on port $port yet." -ForegroundColor Yellow
  Write-Host "           Start the server first:  cd apps\web && npm run dev -- --port $port --host 0.0.0.0" -ForegroundColor Gray
}

# 3. Show network info
Write-Host ""
Write-Host "[3/4] Network interfaces:" -ForegroundColor Yellow
$ips = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notlike "*Loopback*" -and $_.IPAddress -notlike "169.*" }
$ips | ForEach-Object { Write-Host ("    {0,-14}  {1}" -f $_.InterfaceAlias, $_.IPAddress) }

# 4. Public IP (best-effort)
Write-Host ""
Write-Host "[4/4] Public IP (for internet access):" -ForegroundColor Yellow
try {
  $pubIp = (Invoke-WebRequest -Uri "https://ifconfig.me/ip" -UseBasicParsing -TimeoutSec 5).Content.Trim()
  Write-Host "    Public IP: $pubIp" -ForegroundColor White
  Write-Host "    To accept internet traffic: configure port-forwarding on your router" -ForegroundColor Gray
  Write-Host "    (external port 80 -> 192.168.0.200:80), then visit http://$pubIp/" -ForegroundColor Gray
} catch {
  Write-Host "    Could not determine public IP (offline?)." -ForegroundColor Gray
}

# Summary
Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Setup complete!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Open these URLs from any device on the same WiFi:" -ForegroundColor White
$ips | ForEach-Object { Write-Host "    http://$($_.IPAddress)/" -ForegroundColor Yellow }
Write-Host ""
Write-Host "  If a device still cannot connect, also check:" -ForegroundColor Gray
Write-Host "    - Router/AP 'Client isolation' setting" -ForegroundColor Gray
Write-Host "    - Antivirus software firewall" -ForegroundColor Gray
Write-Host ""
pause
