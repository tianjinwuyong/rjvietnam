# Stop PostgreSQL
& 'C:\PostgreSQL\pgsql\bin\pg_ctl.exe' stop -D C:\PostgreSQL\data -m fast -w 2>$null
Start-Sleep -Seconds 3

# Remove old data
Remove-Item -Path C:\PostgreSQL\data -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path C:\PostgreSQL\data | Out-Null

Write-Host "Old data cleared"
Write-Host "System identifier cleared - ready for pg_basebackup"
