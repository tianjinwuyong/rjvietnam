$dirs = @("C:\Program Files", "C:\Program Files (x86)", "C:\Windows", "C:\Users\wy", "C:\PostgreSQL", "C:\app")
$found = @()
foreach ($d in $dirs) {
    if (Test-Path $d) {
        Get-ChildItem $d -Recurse -Filter "7z*.exe" -ErrorAction SilentlyContinue | ForEach-Object { $found += $_.FullName }
    }
}
$found | Select-Object -First 10
