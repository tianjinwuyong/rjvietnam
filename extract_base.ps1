Add-Type -AssemblyName System.IO.Compression.FileSystem
Write-Host "Starting extraction of base.tar..."
$tar = [System.IO.Compression.TarFile]::OpenRead("C:\PostgreSQL\data\base.tar")
Write-Host ("Total entries: " + $tar.Entries.Count)
$cnt = 0
$tar.Entries | ForEach-Object {
    $fp = Join-Path "C:\PostgreSQL\data" $_.FullName
    $dir = Split-Path $fp -Parent
    if (!(Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    if (!$_.IsDirectory) { $_.ExtractToFile($fp, $true); $cnt++ }
    if ($cnt % 1000 -eq 0) { Write-Host ("Extracted: " + $cnt) }
}
$tar.Dispose()
Write-Host ("Extraction complete. Files extracted: " + $cnt)
