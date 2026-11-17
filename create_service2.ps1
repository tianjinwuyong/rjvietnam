$svcName = "PostgreSQL_Standby"

# Remove existing service
$existing = Get-Service -Name $svcName -ErrorAction SilentlyContinue
if ($existing) {
    Stop-Service -Name $svcName -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    sc.exe delete $svcName
    Start-Sleep -Seconds 2
}

# Create service as NetworkService
$pgBin = "C:\PostgreSQL\pgsql\bin\postgres.exe"
$pgData = "C:\PostgreSQL\data"

sc.exe create $svcName binPath= "`"$pgBin`" `"-D`" `""" + $pgData + "`"" obj= "NT AUTHORITY\NetworkService" start= demand
sc.exe config $svcName DisplayName= "PostgreSQL Standby"
Write-Host "Service created"

Start-Service -Name $svcName
Start-Sleep -Seconds 8

$status = Get-Service -Name $svcName
Write-Host "Service status: $($status.Status)"

if ($status.Status -eq 'Running') {
    & 'C:\PostgreSQL\pgsql\bin\psql.exe' -U smt_factory -d postgres -c "SELECT pg_is_in_recovery" | Out-Host
}
