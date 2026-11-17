# Check data dir and processes
Get-ChildItem C:\PostgreSQL\data\ -Name | Select-Object -First 20
Write-Host "---PROCESSES---"
Get-Process | Where-Object { $_.Name -match "postgres" } | Select-Object Name,Id
Write-Host "---PORT 5432---"
netstat -ano | Where-Object { $_ -match ":5432" }
