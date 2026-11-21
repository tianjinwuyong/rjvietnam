Get-ChildItem "C:\" -Recurse -Filter "7z*.exe" -ErrorAction SilentlyContinue | Select-Object -First 5 FullName
