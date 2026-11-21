# Fix standby.signal - write "standby" to it
"standby" | Out-File -FilePath "C:\PostgreSQL\data\standby.signal" -Encoding ASCII

# Fix postgresql.conf
$conf = Get-Content "C:\PostgreSQL\data\postgresql.conf" -Raw

# Set primary_conninfo (uncomment and set value)
$conf = $conf -replace "(?m)^.*primary_conninfo\s*=\s*'.*'", "primary_conninfo = 'host=100.116.166.118 port=5432 user=replicator password=Replicator@123'"

# Make sure hot_standby is on
$conf = $conf -replace "(?m)^\s*#\s*(hot_standby\s*=\s*)on", "`$1on"

$conf | Set-Content "C:\PostgreSQL\data\postgresql.conf"

Write-Host "standby.signal: $(Get-Content C:\PostgreSQL\data\standby.signal)"
Write-Host "primary_conninfo: $(Select-String 'primary_conninfo' C:\PostgreSQL\data\postgresql.conf | ForEach-Object { $_.Line })"
Write-Host "hot_standby: $(Select-String 'hot_standby' C:\PostgreSQL\data\postgresql.conf | ForEach-Object { $_.Line })"
