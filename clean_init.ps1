# Completely remove old data and reinitialize
Remove-Item -Path "C:\PostgreSQL\data" -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "Removed old data dir"

# Fresh initdb with no locale
& 'C:\PostgreSQL\pgsql\bin\initdb.exe' -D C:\PostgreSQL\data --no-locale -E UTF8 -A trust
Write-Host "initdb exit code: $LASTEXITCODE"
