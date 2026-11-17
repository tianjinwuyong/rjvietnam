# Run as Administrator (right-click PowerShell -> "以管理员身份运行")
# Sets up Windows Firewall to allow inbound port 80 for the SMT factory site

$ruleName = "VN-SMT-Factory Web (TCP 80)"
$port = 80

# Remove existing rule if present (idempotent)
Remove-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue

# Add the inbound rule
$rule = New-NetFirewallRule `
  -DisplayName $ruleName `
  -Description "Allow LAN/WiFi devices to visit the Vietnam Ruijing SMT factory web app on port 80" `
  -Direction Inbound `
  -Protocol TCP `
  -LocalPort $port `
  -Action Allow `
  -Profile Any `
  -Enabled True

Write-Host "[OK] Firewall rule added: $($rule.DisplayName)" -ForegroundColor Green
Write-Host "     Status:   Enabled=$($rule.Enabled), Direction=$($rule.Direction), Action=$($rule.Action)" -ForegroundColor Cyan
Write-Host ""
Write-Host "LAN access URLs (devices on the same WiFi can visit these):" -ForegroundColor Yellow
Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.InterfaceAlias -notlike "*Loopback*" -and $_.IPAddress -notlike "169.*" } |
  ForEach-Object { Write-Host "  http://$($_.IPAddress)/" -ForegroundColor White }
Write-Host ""
Write-Host "If devices still cannot connect, also check:" -ForegroundColor Yellow
Write-Host "  1. Router/AP isolation settings (some routers block client-to-client)" -ForegroundColor Gray
Write-Host "  2. Windows Defender Firewall notification settings" -ForegroundColor Gray
Write-Host "  3. Antivirus software that may override Windows Firewall" -ForegroundColor Gray
