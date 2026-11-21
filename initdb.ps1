# Initialize data directory with Windows-compatible locale
& 'C:\PostgreSQL\pgsql\bin\initdb.exe' -D C:\PostgreSQL\data -U smt_factory -E UTF8 --no-locale -A scram-sha-256 -W
Write-Host "Exit code: $LASTEXITCODE"
