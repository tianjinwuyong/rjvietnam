# Create PostgreSQL as a Windows service running as NetworkService
$svcName = "PostgreSQL_Standby"

# First check if service exists and remove
$existing = Get-Service -Name $svcName -ErrorAction SilentlyContinue
if ($existing) {
    Stop-Service -Name $svcName -Force -ErrorAction SilentlyContinue
    sc.exe delete $svcName
    Start-Sleep -Seconds 2
}

# Create the service
$pgBin = "C:\PostgreSQL\pgsql\bin\postgres.exe"
$pgData = "C:\PostgreSQL\data"

# Use NetworkService account (no password needed, unprivileged)
sc.exe create $svcName binPath= "\"$pgBin\" `\"-D\" `\"$pgData\"`" obj= "NT AUTHORITY\NetworkService" start= demand
sc.exe config $svcName DisplayName= "PostgreSQL Standby"
Write-Host "Service created"

# Start the service
Start-Service -Name $svcName
Start-Sleep -Seconds 5

# Check status
$status = Get-Service -Name $svcName
Write-Host "Service status: $($status.Status)"

# Verify connection
if ($status.Status -eq 'Running') {
    & 'C:\PostgreSQL\pgsql\bin\psql.exe' -U smt_factory -d postgres -c "SELECT pg_is_in_recovery();"
}
