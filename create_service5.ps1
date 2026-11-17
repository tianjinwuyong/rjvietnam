$svcName = "PostgreSQL_Standby"
$pgBin = "C:\PostgreSQL\pgsql\bin\postgres.exe"
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

# Create service - use a .bat wrapper
$batContent = "@echo off`n`"$pgBin`" -D `""" + $pgData + "`"""
[System.IO.File]::WriteAllText("C:\PostgreSQL\pgsql\start.bat", $batContent, [System.Text.Encoding]::ASCII)

sc.exe create $svcName binPath= "C:\PostgreSQL\pgsql\start.bat" obj= "NT AUTHORITY\LocalService" start= demand
sc.exe config $svcName DisplayName= "PostgreSQL Standby"

Start-Service -Name $svcName
Start-Sleep -Seconds 10

$status = Get-Service -Name $svcName
Write-Host "Service status: $($status.Status)"
