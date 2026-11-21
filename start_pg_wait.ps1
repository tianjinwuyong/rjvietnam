& 'C:\PostgreSQL\pgsql\bin\pg_ctl.exe' start -D C:\PostgreSQL\data -l C:\PostgreSQL\pg.log -w
if ($LASTEXITCODE -eq 0) {
    Write-Host "PostgreSQL started successfully"
    Start-Sleep -Seconds 3
    & 'C:\PostgreSQL\pgsql\bin\psql.exe' -U postgres -c "SELECT pg_is_in_recovery();"
} else {
    Write-Host "Failed to start PostgreSQL, exit code: $LASTEXITCODE"
}
