# Fix Windows locale issues in postgresql.conf
$conf = Get-Content "C:\PostgreSQL\data\postgresql.conf" -Raw
$conf = $conf -replace "dynamic_shared_memory_type\s*=\s*posix", "dynamic_shared_memory_type = windows"
$conf = $conf -replace "lc_monetary\s*=\s*'en_US\.utf8'", "lc_monetary = 'English_United States.1252'"
$conf = $conf -replace "lc_numeric\s*=\s*'en_US\.utf8'", "lc_numeric = 'English_United States.1252'"
$conf = $conf -replace "lc_time\s*=\s*'en_US\.utf8'", "lc_time = 'English_United States.1252'"
$conf | Set-Content "C:\PostgreSQL\data\postgresql.conf"
Write-Host "Locale fixed"

# Grant Everyone full control (for PostgreSQL running as any user)
icacls "C:\PostgreSQL\data" /grant "Everyone:(OI)(CI)F" /T /Q
Write-Host "Permissions set"

# Verify data dir has correct content
Get-ChildItem C:\PostgreSQL\data\ -Name | Select-Object -First 10
