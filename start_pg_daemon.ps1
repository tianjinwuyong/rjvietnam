# Stop any existing PostgreSQL first
& 'C:\PostgreSQL\pgsql\bin\pg_ctl.exe' stop -D C:\PostgreSQL\data -m fast -w
Start-Sleep -Seconds 3

# Start as proper background process that survives SSH session
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = "C:\PostgreSQL\pgsql\bin\postgres.exe"
$psi.Arguments = "-D C:\PostgreSQL\data"
$psi.WorkingDirectory = "C:\PostgreSQL\data"
$psi.UseShellExecute = $false
$psi.RedirectStandardOutput = $false
$psi.RedirectStandardError = $false
$psi.CreateNoWindow = $true

$proc = [System.Diagnostics.Process]::Start($psi)
Write-Host "PostgreSQL started with PID: $($proc.Id)"
Start-Sleep -Seconds 5

# Verify it's running
$running = Get-Process -Id $proc.Id -ErrorAction SilentlyContinue
if ($running) {
    Write-Host "PostgreSQL is running"
    & 'C:\PostgreSQL\pgsql\bin\psql.exe' -U smt_factory -d postgres -c "SELECT pg_is_in_recovery();"
} else {
    Write-Host "PostgreSQL process not found - may have crashed"
}
