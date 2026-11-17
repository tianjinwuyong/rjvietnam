# Try creating service as NETWORK_SERVICE
$svcName = "PostgreSQL_Standby"

# Stop and delete existing
$existing = Get-Service -Name $svcName -ErrorAction SilentlyContinue
if ($existing) {
    Stop-Service -Name $svcName -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    sc.exe delete $svcName
    Start-Sleep -Seconds 2
}

# Grant NETWORK_SERVICE access to data
icacls "C:\PostgreSQL\data" /grant "NT AUTHORITY\NETWORK SERVICE:(OI)(CI)F" /T /Q
icacls "C:\PostgreSQL\pgsql" /grant "NT AUTHORITY\NETWORK SERVICE:(OI)(CI)RX" /T /Q

# Create service as NETWORK_SERVICE
$binPath = "C:\PostgreSQL\pgsql\start.bat"
sc.exe create $svcName binPath= "`"$binPath`"" obj= "NT AUTHORITY\NETWORK SERVICE" start= demand
sc.exe config $svcName DisplayName= "PostgreSQL Standby"

Write-Host "Service created as NETWORK_SERVICE"
Start-Service -Name $svcName
Start-Sleep -Seconds 10

$status = Get-Service -Name $svcName
Write-Host "Status: $($status.Status)"
