# Fix permissions first
icacls "C:\PostgreSQL\data" /grant "Everyone:(OI)(CI)F" /T /Q
Start-Sleep -Seconds 2

# Start postgres.exe directly as background process
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = "C:\PostgreSQL\pgsql\bin\postgres.exe"
$psi.Arguments = "-D C:\PostgreSQL\data"
$psi.WorkingDirectory = "C:\PostgreSQL\data"
$psi.UseShellExecute = $false
$psi.RedirectStandardOutput = $false
$psi.RedirectStandardError = $false
$psi.CreateNoWindow = $true

$proc = [System.Diagnostics.Process]::Start($psi)
Write-Host "PostgreSQL PID: $($proc.Id)"
Start-Sleep -Seconds 5

# Check if still running
$check = Get-Process -Id $proc.Id -ErrorAction SilentlyContinue
if ($check) {
    Write-Host "PostgreSQL is running"
    & 'C:\PostgreSQL\pgsql\bin\psql.exe' -U smt_factory -d postgres -c "SELECT pg_is_in_recovery(), now();"
} else {
    Write-Host "Process died"
    if (Test-Path C:\PostgreSQL\data\postmaster.pid) {
        Write-Host "postmaster.pid exists"
    }
}
