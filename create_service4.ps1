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

# Grant LocalService full control of data directory
icacls $pgData /grant "NT AUTHORITY\LocalService:(OI)(CI)F" /T /Q

$binPath = "`"$pgBin`" `"-D`" `""" + $pgData + "`"""
sc.exe create $svcName binPath= $binPath obj= "NT AUTHORITY\LocalService" start= demand
sc.exe config $svcName DisplayName= "PostgreSQL Standby"

Write-Host "Service created, starting..."
Start-Service -Name $svcName
Start-Sleep -Seconds 10

$status = Get-Service -Name $svcName
Write-Host "Service status: $($status.Status)"
