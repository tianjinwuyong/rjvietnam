$conf = Get-Content "C:\PostgreSQL\data\postgresql.conf" -Raw
$conf = $conf -replace "(?m)^.*primary_conninfo.*$", "primary_conninfo = 'host=100.116.166.118 port=5432 user=replicator password=Replicator@123'"
$conf = $conf -replace "(?m)^.*hot_standby\s*=\s*off.*$", "hot_standby = on"
$conf | Set-Content "C:\PostgreSQL\data\postgresql.conf"

# Also update pg_hba to allow replication from 122's Tailscale IP
$hba = Get-Content "C:\PostgreSQL\data\pg_hba.conf"
$hasRule = $hba | Where-Object { $_ -match "100.116.166.118.*replicator" }
if (-not $hasRule) {
    $hba += ""
    $hba += "# Replication from primary 122"
    $hba += "host replication replicator 100.116.166.118/32 scram-sha-256"
    $hba += "host all all 100.116.166.118/32 scram-sha-256"
    $hba | Set-Content "C:\PostgreSQL\data\pg_hba.conf"
}

Write-Host "Done"
Select-String "C:\PostgreSQL\data\postgresql.conf" -Pattern "primary_conninfo|hot_standby" | ForEach-Object { $_.Line }
