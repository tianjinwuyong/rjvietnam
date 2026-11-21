# Re-initialize without password prompt (no -W flag)
# First restore the backup
if (Test-Path "C:\PostgreSQL\data_backup") {
    Move-Item -Path "C:\PostgreSQL\data_backup" -Destination "C:\PostgreSQL\data" -Force
    Write-Host "Restored from backup"
}
# Remove old data dir and init fresh without password
Remove-Item -Path "C:\PostgreSQL\data" -Recurse -Force -ErrorAction SilentlyContinue
& 'C:\PostgreSQL\pgsql\bin\initdb.exe' -D C:\PostgreSQL\data --no-locale -E UTF8 -A trust
Write-Host "initdb exit code: $LASTEXITCODE"
