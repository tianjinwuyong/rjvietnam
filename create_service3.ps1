$svcName = "PostgreSQL_Standby"

# Remove existing service
$existing = Get-Service -Name $svcName -ErrorAction SilentlyContinue
if ($existing) {
    Stop-Service -Name $svcName -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    sc.exe delete $svcName
    Start-Sleep -Seconds 2
}

$pgBin = "C:\PostgreSQL\pgsql\bin\postgres.exe"
$pgData = "C:\PostgreSQL\data"

$binPath = $pgBin + " -D " + $pgData
sc.exe create $svcName binPath= $binPath obj= "NT AUTHORITY\NetworkService" start= demand
sc.exe config $svcName DisplayName= "PostgreSQL Standby"

Start-Service -Name $svcName
Start-Sleep -Seconds 8

$status = Get-Service -Name $svcName
Write-Host "Service status: $($status.Status)"
