# Enable logging_collector in postgresql.conf
$c = Get-Content "C:\PostgreSQL\data\postgresql.conf" -Raw
$c = $c -replace "(?m)^(\s*#?\s*logging_collector\s*=\s*)\S+", "`$1on"
$c | Set-Content "C:\PostgreSQL\data\postgresql.conf"

# Create log directory
New-Item -ItemType Directory -Path "C:\PostgreSQL\data\log" -Force | Out-Null

# Run postgres and capture output
$logFile = "C:\PostgreSQL\postgres_output.log"
$errFile = "C:\PostgreSQL\postgres_err.log"

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = "C:\PostgreSQL\pgsql\bin\postgres.exe"
$psi.Arguments = "-D C:\PostgreSQL\data"
$psi.WorkingDirectory = "C:\PostgreSQL\data"
$psi.UseShellExecute = $false
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.CreateNoWindow = $true
$psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
$psi.StandardErrorEncoding = [System.Text.Encoding]::UTF8

$proc = [System.Diagnostics.Process]::Start($psi)
Write-Host "PID: $($proc.Id)"

# Read output (non-blocking)
Start-Sleep -Seconds 5

$out = ""
$err = ""
if (!$proc.HasExited) {
    $out = $proc.StandardOutput.ReadToEnd()
    $err = $proc.StandardError.ReadToEnd()
    Write-Host "STDOUT: $out"
    Write-Host "STDERR: $err"
    Write-Host "Still running: true"
    & 'C:\PostgreSQL\pgsql\bin\psql.exe' -U smt_factory -d postgres -c "SELECT pg_is_in_recovery();"
} else {
    $exitCode = $proc.ExitCode
    $out = $proc.StandardOutput.ReadToEnd()
    $err = $proc.StandardError.ReadToEnd()
    Write-Host "Process exited with code: $exitCode"
    Write-Host "STDOUT: $out"
    Write-Host "STDERR: $err"
}
