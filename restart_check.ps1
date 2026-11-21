# Restart PostgreSQL via pg_ctl
$env:PGPASSWORD = ""
& 'C:\PostgreSQL\pgsql\bin\pg_ctl.exe' restart -D C:\PostgreSQL\data -m fast -w
Start-Sleep -Seconds 8

# Check status
Write-Host "=== pg_stat_wal_receiver ==="
& 'C:\PostgreSQL\pgsql\bin\psql.exe' -U wy -d postgres -c "SELECT pid, status, conninfo FROM pg_stat_wal_receiver"
Write-Host "=== pg_is_in_recovery ==="
& 'C:\PostgreSQL\pgsql\bin\psql.exe' -U wy -d postgres -c "SELECT pg_is_in_recovery()"
Write-Host "=== Last WAL receive ==="
& 'C:\PostgreSQL\pgsql\bin\psql.exe' -U wy -d postgres -c "SELECT * FROM pg_stat_replication"
