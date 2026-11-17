# Start PostgreSQL fresh
& 'C:\PostgreSQL\pgsql\bin\pg_ctl.exe' start -D C:\PostgreSQL\data -w -l C:\PostgreSQL\pg.log
$exit = $LASTEXITCODE
Write-Host "pg_ctl start exit: $exit"
Start-Sleep -Seconds 8

# Check processes and ports
$proc = Get-Process postgres -ErrorAction SilentlyContinue
if ($proc) { Write-Host "PostgreSQL running: $($proc.Count) processes" }
$listening = netstat -ano | Where-Object { $_ -match ":5432.*LISTENING" }
Write-Host "Port 5432: $listening"

# Query as smt_factory (from the cloned data)
Write-Host "=== pg_is_in_recovery ==="
& 'C:\PostgreSQL\pgsql\bin\psql.exe' -U smt_factory -d postgres -c "SELECT pg_is_in_recovery()"
Write-Host "=== pg_stat_wal_receiver ==="
& 'C:\PostgreSQL\pgsql\bin\psql.exe' -U smt_factory -d postgres -c "SELECT pid, status, conninfo FROM pg_stat_wal_receiver"
