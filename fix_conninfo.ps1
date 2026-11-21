# Fix postgresql.conf - uncomment and set primary_conninfo and hot_standby
$conf = Get-Content "C:\PostgreSQL\data\postgresql.conf" -Raw

# Fix primary_conninfo - uncomment and set value
$conf = $conf -replace "(?m)^(\s*#?\s*primary_conninfo\s*=\s*)'.*'", "`$1'host=100.116.166.118 port=5432 user=replicator password=Replicator@123'"
# If still commented, uncomment it
if ($conf -match "^\s*#\s*primary_conninfo\s*=") {
    $conf = $conf -replace "(?m)^\s*#\s*(primary_conninfo\s*=\s*)", "`$1"
}
# Make sure hot_standby is on
$conf = $conf -replace "(?m)^\s*#?\s*hot_standby\s*=\s*off", "hot_standby = on"
if ($conf -notmatch "hot_standby\s*=\s*on") {
    $conf = $conf -replace "(?m)^\s*#\s*(hot_standby\s*=\s*on)", "`$1"
}

$conf | Set-Content "C:\PostgreSQL\data\postgresql.conf"

# Create standby.signal
"standby" | Out-File -FilePath "C:\PostgreSQL\data\standby.signal" -Encoding ASCII

Write-Host "Configured"
Select-String "C:\PostgreSQL\data\postgresql.conf" -Pattern "primary_conninfo|hot_standby" | ForEach-Object { $_.Line }
