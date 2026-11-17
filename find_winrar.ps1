Get-ChildItem "C:\Program Files\WinRAR" -Recurse -File -ErrorAction SilentlyContinue | Select-Object FullName
