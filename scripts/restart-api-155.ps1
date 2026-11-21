$ErrorActionPreference = "Stop"
$workspace = "C:\Users\tianj\Desktop\越南工厂瑞晶\smt-factory-system"
$listener = Get-NetTCPConnection -State Listen -LocalPort 8080 | Select-Object -First 1
if ($listener) {
  Stop-Process -Id $listener.OwningProcess -Force
  Start-Sleep -Milliseconds 800
}
Start-Process -FilePath "node" -ArgumentList "services/api/server.js" -WorkingDirectory $workspace -WindowStyle Hidden
