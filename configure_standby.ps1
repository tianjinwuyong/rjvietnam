# Configure postgresql.conf for standby
$c = Get-Content "C:\PostgreSQL\data\postgresql.conf" -Raw

# Add hot_standby
if ($c -match "^\s*hot_standby\s*=") {
    $c = $c -replace "(?m)^\s*hot_standby\s*=.*", "hot_standby = on"
} else {
    $c = $c -replace "(?m)(#?hot_standby\s*=\s*on\s*#.* standby #.*)", "hot_standby = on"
    if ($c -notmatch "hot_standby\s*=\s*on") {
        $c = $c -replace "(?m)^(#?hot_standby\s*=\s*).*", "`$1on"
    }
}

# Add primary_conninfo
if ($c -match "^\s*#?primary_conninfo\s*=") {
    $c = $c -replace "(?m)^\s*#?primary_conninfo\s*=.*", "primary_conninfo = 'host=100.116.166.118 port=5432 user=replicator password=Replicator@123'"
} else {
    $c = $c -replace "(?m)^(#?primary_conninfo\s*=\s*'.*')$", "primary_conninfo = 'host=100.116.166.118 port=5432 user=replicator password=Replicator@123'"
    if ($c -notmatch "primary_conninfo\s*=") {
        $c = $c + "`n`nprimary_conninfo = 'host=100.116.166.118 port=5432 user=replicator password=Replicator@123'"
    }
}

$c | Set-Content "C:\PostgreSQL\data\postgresql.conf"
Write-Host "postgresql.conf updated"

# Create standby.signal
"" | Out-File -FilePath "C:\PostgreSQL\data\standby.signal" -Encoding ASCII
Write-Host "standby.signal created"

# Configure pg_hba.conf for replication from 122
$hba = Get-Content "C:\PostgreSQL\data\pg_hba.conf"
$hba += ""
$hba += "# Replication from primary 122"
$hba += "host replication replicator 100.116.166.118/32 scram-sha-256"
$hba += "host all all 100.116.166.118/32 scram-sha-256"
$hba | Set-Content "C:\PostgreSQL\data\pg_hba.conf"
Write-Host "pg_hba.conf updated"

# Grant permissions
icacls "C:\PostgreSQL\data" /grant "Everyone:(OI)(CI)F" /T /Q
Write-Host "Permissions set"
