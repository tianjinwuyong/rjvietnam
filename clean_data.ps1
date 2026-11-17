Remove-Item C:\PostgreSQL\data\* -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path C:\PostgreSQL\data -Force | Out-Null
Write-Host "Data directory cleaned"
