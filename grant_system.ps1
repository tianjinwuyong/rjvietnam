icacls "C:\PostgreSQL\data" /grant "SYSTEM:(OI)(CI)F" /T /Q
Write-Host "SYSTEM permissions granted"
