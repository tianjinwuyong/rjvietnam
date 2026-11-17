$svcName = "PostgreSQL_Standby"
$pgData = "C:\PostgreSQL\data"

# Remove existing
$existing = Get-Service -Name $svcName -ErrorAction SilentlyContinue
if ($existing) {
    Stop-Service -Name $svcName -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    sc.exe delete $svcName
    Start-Sleep -Seconds 2
}

# Grant LocalService permissions
icacls $pgData /grant "NT AUTHORITY\LocalService:(OI)(CI)F" /T /Q

# Create service using the bat wrapper
sc.exe create $svcName binPath= "C:\PostgreSQL\pgsql\start.bat" obj= "NT AUTHORITY\LocalService" start= demand
sc.exe config $svcName DisplayName= "PostgreSQL Standby"

Start-Service -Name $svcName
Start-Sleep -Seconds 10

$status = Get-Service -Name $svcName
Write-Host "Service status: $($status.Status)"
