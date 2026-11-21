# Stop PostgreSQL
& 'C:\PostgreSQL\pgsql\bin\pg_ctl.exe' stop -D C:\PostgreSQL\data -m fast -w 2>$null
Start-Sleep -Seconds 3

# Backup existing data (just in case)
if (Test-Path "C:\PostgreSQL\data_backup") {
    Remove-Item -Path "C:\PostgreSQL\data_backup" -Recurse -Force
}
Move-Item -Path "C:\PostgreSQL\data" -Destination "C:\PostgreSQL\data_backup"
Write-Host "Backed up existing data to data_backup"
