# Grant Full Control to Everyone on entire data directory
icacls "C:\PostgreSQL\data" /grant "Everyone:(OI)(CI)F" /T /Q
Write-Host "icacls done"
Start-Sleep -Seconds 2
# Verify
icacls "C:\PostgreSQL\data\global" | Select-String "Everyone"
